import logging
from html import escape
from urllib.parse import urlparse

from app.core.config import Settings
from app.services.email_sender import (
    EmailConfigurationError,
    _send_with_resend_api,
)
from app.services.supabase_gateway import SupabaseGateway

logger = logging.getLogger(__name__)


def welcome_content(name: str, account_type: str, base_url: str) -> tuple[str, str]:
    base = base_url.rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise EmailConfigurationError("The welcome email link is not configured.")
    name = " ".join(name.split()).strip() or "there"
    if account_type == "ca":
        intro = "Welcome to your free ChanaX CA partner portal."
        guidance = (
            "Invite your clients or request access to their company workspaces. "
            "Each company approves your access and owns its subscription, "
            "credits and business data."
        )
        action, path = "Open your CA portal", "/ca"
    elif account_type == "employee":
        intro = "Welcome to ChanaX. Your team’s workspace is ready for you."
        guidance = (
            "Open the workspace your company has invited you to. "
            "Your available pages are controlled by the company owner."
        )
        action, path = "Open your workspace", "/workspace"
    else:
        intro = "Welcome to ChanaX. Your business, organised in one workspace."
        guidance = (
            "Complete your company setup, add your customers and employees, "
            "and start creating quotations, invoices and payslips. "
            "If you are a CA or accounting firm, select the free CA partner "
            "account during setup to manage approved client workspaces."
        )
        action, path = "Complete your setup", "/setup"
    url = f"{base}{path}"
    text = (
        f"Hi {name},\n\n{intro}\n\n{guidance}\n\n{action}: {url}\n\n"
        "Need help? Contact contact@azorix.com.\n\nRegards,\nThe ChanaX team"
    )
    html = (
        '<!doctype html><html><body style="margin:0;background:#f5f5f5;'
        'font-family:Arial,sans-serif;color:#18181b">'
        '<div style="max-width:560px;margin:32px auto;background:#fff;'
        'padding:32px;border-radius:16px">'
        '<h1 style="margin-top:0">Welcome to ChanaX</h1>'
        f"<p>Hi {escape(name)},</p><p>{escape(intro)}</p>"
        f'<p style="line-height:1.7">{escape(guidance)}</p>'
        f'<p style="margin:28px 0"><a href="{escape(url, quote=True)}" '
        'style="display:inline-block;background:#18181b;color:#fff;'
        'padding:14px 22px;border-radius:8px;text-decoration:none">'
        f"{escape(action)}</a></p>"
        '<p>Need help? <a href="mailto:contact@azorix.com">contact@azorix.com</a>'
        "</p><p>Regards,<br>The ChanaX team</p></div></body></html>"
    )
    return text, html


async def deliver_welcome(settings: Settings, user_id: str) -> None:
    """Best-effort background send; never raise into signup/login."""
    if not settings.smtp_is_configured:
        logger.warning("Welcome email sending is not configured")
        return
    if settings.smtp_host.strip().lower() != "smtp.resend.com":
        logger.warning("Welcome email requires the existing Resend configuration")
        return
    gateway = SupabaseGateway(settings)
    claim = None
    accepted = False
    try:
        claim = await gateway.service_rpc(
            "chanax_claim_welcome_email", {"target_user_id": user_id}
        )
        if not claim:
            return
        text, html = welcome_content(
            str(claim["name"] or ""),
            str(claim["account_type"] or ""),
            settings.frontend_url,
        )
        await _send_with_resend_api(
            settings,
            to_email=str(claim["email"]),
            subject="Welcome to ChanaX",
            message=text,
            html=html,
            idempotency_key=f"chanax-welcome/{user_id}",
        )
        accepted = True
    except Exception:
        # Do not log recipients, provider payloads, credentials or access tokens.
        logger.warning("Welcome email attempt could not be completed")
    finally:
        if isinstance(claim, dict) and claim.get("lease_token"):
            try:
                await gateway.service_rpc(
                    "chanax_finish_welcome_email",
                    {
                        "target_user_id": user_id,
                        "target_lease_token": claim["lease_token"],
                        "delivered": accepted,
                    },
                )
            except Exception:
                logger.warning("Welcome email delivery state could not be saved")
