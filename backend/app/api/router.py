from fastapi import APIRouter

from app.api.routes import gst

api_router = APIRouter()
api_router.include_router(gst.router, prefix="/gst", tags=["GST"])
