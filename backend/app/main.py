from fastapi import FastAPI, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db import SessionDep

app = FastAPI(title="VietStrain API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")


@app.get("/api/health")
def health(response: Response, session: SessionDep) -> dict[str, str]:
    """Báo API còn sống và có nối được cơ sở dữ liệu hay không."""
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": "down"}
    return {"status": "ok", "db": "ok"}
