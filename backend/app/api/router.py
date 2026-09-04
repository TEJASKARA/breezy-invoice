from fastapi import APIRouter

from app.api.routes import billing, documents, gst, maintenance, team

api_router = APIRouter()
api_router.include_router(gst.router, prefix="/gst", tags=["GST"])
api_router.include_router(team.router, prefix="/team", tags=["Team"])
api_router.include_router(documents.router, prefix="/documents", tags=["Documents"])
api_router.include_router(billing.router, prefix="/billing", tags=["Billing"])
api_router.include_router(
    maintenance.router, prefix="/maintenance", tags=["Maintenance"]
)
