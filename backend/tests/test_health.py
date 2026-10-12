from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_session
from app.main import app


def test_health_reports_ok_when_database_answers():
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_health_reports_degraded_when_database_is_unreachable():
    class UnreachableDatabase:
        def execute(self, *_args, **_kwargs):
            raise OperationalError("SELECT 1", {}, ConnectionRefusedError())

    app.dependency_overrides[get_session] = lambda: UnreachableDatabase()
    try:
        response = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "down"}
