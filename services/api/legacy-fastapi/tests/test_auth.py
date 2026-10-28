from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import decode_token, hash_password, verify_password
from app.database import Base
from app.main import app, get_db
from app.models import User


def test_password_hash_and_token_types(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    encoded = hash_password("StrongPass1")

    assert encoded != "StrongPass1"
    assert verify_password("StrongPass1", encoded)
    assert not verify_password("WrongPass1", encoded)


def test_registration_login_and_role_access(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-long-enough-for-tests")
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)

    def test_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        with session_factory() as db:
            db.add(User(
                name="Test Admin",
                email="admin@example.com",
                password_hash=hash_password("AdminPass1"),
                role="ADMIN",
            ))
            db.commit()

        client = TestClient(app)
        registered = client.post("/api/auth/register", json={
            "name": "Ксения Тестова",
            "email": "KSENIA@example.com",
            "password": "ClientPass1",
        })
        assert registered.status_code == 201
        session = registered.json()
        assert session["user"]["email"] == "ksenia@example.com"
        assert session["user"]["role"] == "CLIENT"
        assert decode_token(session["accessToken"], "access")["sub"] == session["user"]["id"]
        assert decode_token(session["refreshToken"], "refresh")["sub"] == session["user"]["id"]

        assert client.get("/api/dashboard").status_code == 401
        client_headers = {"Authorization": f"Bearer {session['accessToken']}"}
        assert client.get("/api/auth/me", headers=client_headers).status_code == 200
        assert client.get("/api/users", headers=client_headers).status_code == 403

        duplicate = client.post("/api/auth/register", json={
            "name": "Duplicate",
            "email": "ksenia@example.com",
            "password": "ClientPass2",
        })
        assert duplicate.status_code == 409

        admin_login = client.post("/api/auth/login", json={
            "email": "admin@example.com",
            "password": "AdminPass1",
        })
        assert admin_login.status_code == 200
        admin_headers = {"Authorization": f"Bearer {admin_login.json()['accessToken']}"}
        promoted = client.patch(
            f"/api/users/{session['user']['id']}/role",
            headers=admin_headers,
            json={"role": "OPERATOR"},
        )
        assert promoted.status_code == 200
        assert promoted.json()["role"] == "OPERATOR"

        refreshed = client.post("/api/auth/refresh", json={"refreshToken": session["refreshToken"]})
        assert refreshed.status_code == 200
        assert refreshed.json()["user"]["role"] == "OPERATOR"
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
