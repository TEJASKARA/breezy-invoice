from fastapi import APIRouter

from app.api.routes import gst, maintenance, team

api_router = APIRouter()
api_router.include_router(gst.router, prefix="/gst", tags=["GST"])
api_router.include_router(team.router, prefix="/team", tags=["Team"])
api_router.include_router(
    maintenance.router, prefix="/maintenance", tags=["Maintenance"]
)
