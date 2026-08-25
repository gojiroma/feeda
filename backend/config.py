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
    # Seed hand-off (QR code / 6-digit code) — see routes/pair.py. The read
    # limit is intentionally the tightest of the three: it's the one an
    # attacker would hammer to brute-force a 6-digit code (1,000,000
    # possibilities) within PAIR_TTL_SECONDS. This doesn't make brute-forcing
    # impossible on its own — a short TTL and single-use consumption are
    # doing most of the real work — but it keeps a single client from just
    # trying every code in a tight loop.
    RATE_LIMIT_PAIR_WRITE = os.environ.get("RATE_LIMIT_PAIR_WRITE", "20 per minute")
    RATE_LIMIT_PAIR_READ = os.environ.get("RATE_LIMIT_PAIR_READ", "10 per minute")
    RATE_LIMIT_PAIR_STATUS = os.environ.get("RATE_LIMIT_PAIR_STATUS", "60 per minute")
    PAIR_TTL_SECONDS = int(os.environ.get("PAIR_TTL_SECONDS", "180"))
    # One-time share-link relay (URL-based "let someone else temporarily use
    # my reader" hand-off — see routes/share_link.py). The id is a ~128-bit
    # random string the client generates, not something worth brute-forcing
    # a rate limit against the way the 6-digit pairing code is, so these
    # limits exist mainly to keep a buggy client from hammering the endpoint
    # rather than as the main access control (single-use consumption is).
    RATE_LIMIT_SHARE_LINK_WRITE = os.environ.get("RATE_LIMIT_SHARE_LINK_WRITE", "20 per minute")
    RATE_LIMIT_SHARE_LINK_READ = os.environ.get("RATE_LIMIT_SHARE_LINK_READ", "30 per minute")
    # Longer than PAIR_TTL_SECONDS: a pairing code is meant to be typed into
    # another device within a couple minutes of appearing on screen, while a
    # share link is meant to be sent elsewhere (chat, email) and opened
    # later.
    SHARE_LINK_TTL_SECONDS = int(os.environ.get("SHARE_LINK_TTL_SECONDS", "1800"))

    @classmethod
    def require_database_url(cls):
        if not cls.NEON_DATABASE_URL:
            raise RuntimeError("NEON_DATABASE_URL (or DATABASE_URL / POSTGRES_URL) is not set")
        return cls.NEON_DATABASE_URL
