import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4


PBKDF2_ITERATIONS = 600_000


class TokenError(ValueError):
    pass


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _b64decode(salt), int(iterations))
        return hmac.compare_digest(_b64encode(digest), expected)
    except (TypeError, ValueError):
        return False


def _jwt_secret() -> bytes:
    return os.getenv("JWT_SECRET", "airpulse-local-jwt-change-me").encode("utf-8")


def create_token(user_id: str, role: str, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(timezone.utc)
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user_id,
        "role": role,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
        "jti": str(uuid4()),
    }
    encoded_header = _b64encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    encoded_payload = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = _b64encode(hmac.new(_jwt_secret(), signing_input, hashlib.sha256).digest())
    return f"{encoded_header}.{encoded_payload}.{signature}"


def decode_token(token: str, expected_type: str) -> dict:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        expected_signature = _b64encode(hmac.new(_jwt_secret(), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(encoded_signature, expected_signature):
            raise TokenError("Неверная подпись токена")
        header = json.loads(_b64decode(encoded_header))
        payload = json.loads(_b64decode(encoded_payload))
        if header.get("alg") != "HS256" or payload.get("type") != expected_type:
            raise TokenError("Неверный тип токена")
        if int(payload.get("exp", 0)) <= int(datetime.now(timezone.utc).timestamp()):
            raise TokenError("Срок действия токена истёк")
        if not payload.get("sub"):
            raise TokenError("В токене нет пользователя")
        return payload
    except TokenError:
        raise
    except Exception as exc:
        raise TokenError("Некорректный токен") from exc


def create_token_pair(user_id: str, role: str) -> dict:
    access_minutes = max(5, int(os.getenv("JWT_ACCESS_MINUTES", "30")))
    refresh_days = max(1, int(os.getenv("JWT_REFRESH_DAYS", "7")))
    return {
        "accessToken": create_token(user_id, role, "access", timedelta(minutes=access_minutes)),
        "refreshToken": create_token(user_id, role, "refresh", timedelta(days=refresh_days)),
        "tokenType": "bearer",
        "expiresIn": access_minutes * 60,
    }
