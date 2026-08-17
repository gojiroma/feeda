import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL", "")
    ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:8000")
    PROXY_TIMEOUT_SECONDS = float(os.environ.get("PROXY_TIMEOUT_SECONDS", "10"))
    PROXY_MAX_BYTES = int(os.environ.get("PROXY_MAX_BYTES", str(5 * 1024 * 1024)))
    RATE_LIMIT_SYNC = os.environ.get("RATE_LIMIT_SYNC", "60 per minute")
    RATE_LIMIT_PROXY = os.environ.get("RATE_LIMIT_PROXY", "120 per minute")

    @classmethod
    def validate(cls):
        if not cls.NEON_DATABASE_URL:
            raise RuntimeError("NEON_DATABASE_URL is not set")
