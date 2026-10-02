from fastapi import APIRouter

from .. import dto

router = APIRouter(tags=["health"])


@router.get("/health", response_model=dto.Health)
def health() -> dto.Health:
    return dto.Health(status="ok")
