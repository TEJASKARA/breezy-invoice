from fastapi import APIRouter

from app.api.routes import (
    account,
    analytics,
    admin,
    billing,
    ca_partners,
    documents,
    gst,
    maintenance,
    team,
)

api_router = APIRouter()
api_router.include_router(account.router, prefix="/account", tags=["Account"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["Analytics"])
api_router.include_router(gst.router, prefix="/gst", tags=["GST"])
api_router.include_router(team.router, prefix="/team", tags=["Team"])
api_router.include_router(
    ca_partners.router, prefix="/ca-partners", tags=["CA partners"]
)
api_router.include_router(documents.router, prefix="/documents", tags=["Documents"])
api_router.include_router(billing.router, prefix="/billing", tags=["Billing"])
api_router.include_router(admin.router, prefix="/admin", tags=["Platform admin"])
api_router.include_router(
    maintenance.router, prefix="/maintenance", tags=["Maintenance"]
)
