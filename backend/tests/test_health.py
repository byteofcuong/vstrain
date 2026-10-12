from sqlalchemy.exc import OperationalError

from app.db import get_session


def test_health_reports_ok_when_database_answers(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_health_reports_degraded_when_database_is_unreachable(client):
    class UnreachableDatabase:
        def execute(self, *_args, **_kwargs):
            raise OperationalError("SELECT 1", {}, ConnectionRefusedError())

    client.app.dependency_overrides[get_session] = lambda: UnreachableDatabase()

    response = client.get("/api/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "down"}
