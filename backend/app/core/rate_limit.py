"""Request rate limiting for the API.

Sign-in itself goes browser -> Supabase Auth, so it is protected by Supabase's own
limits plus CAPTCHA. This module protects the endpoints that cost money or send
messages from ChanaX's identity: send-code, email, WhatsApp, invitations, GST
lookups and the public analytics/share endpoints.

The API runs as a single uvicorn process, so counters are kept in memory. If it is
ever run with several workers, move the counters to Redis; the rules stay the same.
"""

import hashlib
import json
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from starlette.types import ASGIApp, Receive, Scope, Send


@dataclass(frozen=True)
class Rule:
    name: str
    method: str  # "*" matches any method
    pattern: str  # regular expression matched against the whole path
    limit: int
    window: int  # seconds
    by: str  # "ip" or "identity" (the bearer token, falling back to the IP)

    def matches(self, method: str, path: str) -> bool:
        return (
            self.method in ("*", method)
            and re.fullmatch(self.pattern, path) is not None
        )


def build_rules(prefix: str) -> list[Rule]:
    p = re.escape(prefix)
    return [
        # Message-sending and code endpoints: strict.
        Rule("send-code-ip", "POST", rf"{p}/account/phone/send-code", 5, 600, "ip"),
        Rule(
            "send-code-user",
            "POST",
            rf"{p}/account/phone/send-code",
            5,
            600,
            "identity",
        ),
        Rule("verify-code", "POST", rf"{p}/account/phone/verify", 10, 600, "identity"),
        Rule("welcome", "POST", rf"{p}/account/welcome", 5, 600, "identity"),
        Rule(
            "send-document",
            "POST",
            rf"{p}/documents/(document-email|document-whatsapp|employee-letter-email|payslip-email)",
            10,
            60,
            "identity",
        ),
        Rule(
            "send-document-ip",
            "POST",
            rf"{p}/documents/(document-email|document-whatsapp|employee-letter-email|payslip-email)",
            30,
            60,
            "ip",
        ),
        Rule(
            "invitations",
            "POST",
            rf"{p}/(team/invitations|ca-partners/client-invitations)",
            10,
            600,
            "identity",
        ),
        Rule("gst-lookup", "GET", rf"{p}/gst/verify", 20, 60, "identity"),
        Rule("expense-bill-upload", "POST", rf"{p}/expense-bills", 20, 60, "identity"),
        Rule("billing", "POST", rf"{p}/billing/(orders|verify)", 20, 60, "identity"),
        # Public endpoints with no login: limit by IP.
        Rule("analytics", "POST", rf"{p}/analytics/.*", 30, 60, "ip"),
        Rule("shared-document", "GET", rf"{p}/documents/shared/.*", 60, 60, "ip"),
        # Everything else: a generous ceiling that normal use never reaches.
        Rule("general", "*", r"/api/.*", 300, 60, "ip"),
    ]


# Called by Supabase, Razorpay or our own worker, from shared addresses.
def exempt_patterns(prefix: str) -> list[str]:
    p = re.escape(prefix)
    return [
        rf"{p}/account/sms-hook",
        rf"{p}/billing/webhook",
        rf"{p}/maintenance/.*",
        r"/health",
    ]


class RateLimiter:
    def __init__(self, rules: list[Rule], exempt: list[str]) -> None:
        self.rules = rules
        self.exempt = [re.compile(item) for item in exempt]
        self.hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._last_sweep = time.monotonic()

    def reset(self) -> None:
        self.hits.clear()

    def check(
        self, method: str, path: str, ip: str, authorization: str
    ) -> tuple[str, int] | None:
        """Return (rule name, seconds to wait) when the request must be refused."""
        if method == "OPTIONS" or any(item.fullmatch(path) for item in self.exempt):
            return None
        now = time.monotonic()
        self._sweep(now)
        identity = (
            "t:" + hashlib.sha256(authorization.encode()).hexdigest()[:32]
            if authorization
            else "i:" + ip
        )
        # Count against every matching rule; refuse if any is over its limit.
        blocked: tuple[str, int] | None = None
        for rule in self.rules:
            if not rule.matches(method, path):
                continue
            key = (rule.name, ip if rule.by == "ip" else identity)
            window = self.hits[key]
            while window and now - window[0] >= rule.window:
                window.popleft()
            if len(window) >= rule.limit:
                wait = max(1, int(rule.window - (now - window[0])) + 1)
                if blocked is None or wait > blocked[1]:
                    blocked = (rule.name, wait)
                continue
            window.append(now)
        return blocked

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        longest = max((rule.window for rule in self.rules), default=60)
        for key in [k for k, v in self.hits.items() if not v or now - v[-1] >= longest]:
            del self.hits[key]


def client_ip(scope: Scope, headers: dict[bytes, bytes]) -> str:
    # nginx sets X-Real-IP itself, and the API port is bound to 127.0.0.1, so only
    # nginx can reach it. Fall back to the socket address for direct/local calls.
    real = headers.get(b"x-real-ip", b"").decode("latin-1").strip()
    if real:
        return real
    client = scope.get("client")
    return client[0] if client else "unknown"


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp, limiter: RateLimiter) -> None:
        self.app = app
        self.limiter = limiter

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        refused = self.limiter.check(
            scope["method"],
            scope["path"],
            client_ip(scope, headers),
            headers.get(b"authorization", b"").decode("latin-1"),
        )
        if refused is None:
            await self.app(scope, receive, send)
            return
        _, wait = refused
        body = json.dumps(
            {"detail": "Too many requests. Please wait a moment and try again."}
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 429,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"retry-after", str(wait).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
