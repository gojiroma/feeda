import os

from dotenv import load_dotenv

# Resolve relative to this file so config loads correctly regardless of the
# process's current working directory (e.g. running `python backend/app.py`
# from the repo root instead of from inside backend/).
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


class Config:
    # NEON_DATABASE_URL is the name we document, but Vercel's native Neon
    # integration (Storage tab) injects DATABASE_URL/POSTGRES_URL instead —
    # accept any of them so it works either way without extra setup.
    NEON_DATABASE_URL = (
        os.environ.get("NEON_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("POSTGRES_URL")
        or ""
    )
    ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:8000")
    # Kept comfortably under common serverless platform function-execution
    # limits (e.g. Vercel's default is 10s) so a slow origin gets our own
    # clean JSON 502 instead of the platform killing the process first and
    # returning a bare, bodyless 502 of its own.
    PROXY_TIMEOUT_SECONDS = float(os.environ.get("PROXY_TIMEOUT_SECONDS", "8"))
    PROXY_MAX_BYTES = int(os.environ.get("PROXY_MAX_BYTES", str(5 * 1024 * 1024)))
    RATE_LIMIT_SYNC = os.environ.get("RATE_LIMIT_SYNC", "60 per minute")
    RATE_LIMIT_PROXY = os.environ.get("RATE_LIMIT_PROXY", "120 per minute")

    @classmethod
    def require_database_url(cls):
        if not cls.NEON_DATABASE_URL:
            raise RuntimeError("NEON_DATABASE_URL (or DATABASE_URL / POSTGRES_URL) is not set")
        return cls.NEON_DATABASE_URL
