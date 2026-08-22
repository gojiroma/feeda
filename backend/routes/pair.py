import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from app import limiter
from config import Config
from db import ensure_schema, get_pool

pair_bp = Blueprint("pair", __name__)

CODE_RE = re.compile(r"^[0-9]{6}$")
MAX_CIPHERTEXT_LEN = 4096


@pair_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    # Same reasoning as sync.py's handler: raised by db.get_pool() when the
    # database env var isn't set, kept at request time so a misconfigured
    # deploy only breaks the routes that actually touch the database.
    return jsonify(error=str(err)), 500


def _cleanup_stale(conn):
    # Opportunistic housekeeping riding along on every write — this table is
    # low-volume and short-lived by nature, so there's no need for a
    # separate scheduled job just to keep it from growing unbounded.
    conn.execute("DELETE FROM pairing_rows WHERE expires_at < now() - interval '1 hour'")


# No require_account_id on any route in this file. That decorator checks a
# Bearer token *derived from* a seed the caller already has — but this
# endpoint exists specifically to hand a seed to a device that doesn't have
# one yet (or is switching accounts), so there's nothing to authenticate
# against yet. The 6-digit code itself, its short TTL, and single-use
# consumption are the only access control here — see the RATE_LIMIT_PAIR_*
# comment in config.py for the accepted risk that implies.


@pair_bp.put("/api/pair/<code>")
@limiter.limit(lambda: Config.RATE_LIMIT_PAIR_WRITE)
def put_pair(code):
    if not CODE_RE.match(code):
        return jsonify(error="code must be 6 digits"), 400

    payload = request.get_json(silent=True)
    ciphertext = payload.get("ciphertext", "") if isinstance(payload, dict) else ""
    if not isinstance(ciphertext, str) or not ciphertext or len(ciphertext) > MAX_CIPHERTEXT_LEN:
        return jsonify(error="invalid ciphertext"), 400

    ensure_schema()
    pool = get_pool()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=Config.PAIR_TTL_SECONDS)
    with pool.connection() as conn:
        _cleanup_stale(conn)
        # A code the client picked collides with a *currently active*
        # pairing only if that row exists, isn't expired yet, and hasn't
        # been consumed — in every other case it's safe (and expected) to
        # reuse the slot. The WHERE clause makes ON CONFLICT DO UPDATE act
        # as DO NOTHING for a genuinely-active collision, and RETURNING
        # tells the caller which case it was.
        cur = conn.execute(
            """
            INSERT INTO pairing_rows (code, ciphertext, expires_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (code) DO UPDATE
              SET ciphertext = EXCLUDED.ciphertext,
                  created_at = now(),
                  expires_at = EXCLUDED.expires_at,
                  consumed_at = NULL
            WHERE pairing_rows.expires_at < now() OR pairing_rows.consumed_at IS NOT NULL
            RETURNING code
            """,
            (code, ciphertext, expires_at),
        )
        applied = cur.fetchone() is not None

    if not applied:
        return jsonify(error="code in use"), 409

    return jsonify(expiresAt=expires_at.isoformat())


@pair_bp.get("/api/pair/<code>/status")
@limiter.limit(lambda: Config.RATE_LIMIT_PAIR_STATUS)
def get_pair_status(code):
    if not CODE_RE.match(code):
        return jsonify(error="code must be 6 digits"), 400

    ensure_schema()
    pool = get_pool()
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT expires_at, consumed_at FROM pairing_rows WHERE code = %s",
            (code,),
        )
        row = cur.fetchone()

    if row is None or row[0] < datetime.now(timezone.utc):
        return jsonify(error="not found"), 404

    expires_at, consumed_at = row
    return jsonify(
        expiresAt=expires_at.isoformat(),
        consumedAt=consumed_at.isoformat() if consumed_at else None,
    )


@pair_bp.get("/api/pair/<code>")
@limiter.limit(lambda: Config.RATE_LIMIT_PAIR_READ)
def get_pair(code):
    if not CODE_RE.match(code):
        return jsonify(error="code must be 6 digits"), 400

    ensure_schema()
    pool = get_pool()
    with pool.connection() as conn:
        with conn.transaction():
            cur = conn.execute(
                "SELECT ciphertext, expires_at, consumed_at FROM pairing_rows WHERE code = %s FOR UPDATE",
                (code,),
            )
            row = cur.fetchone()
            if row is None or row[1] < datetime.now(timezone.utc):
                return jsonify(error="not found or expired"), 404

            ciphertext, _expires_at, consumed_at = row
            if consumed_at is not None:
                return jsonify(error="already used"), 410

            conn.execute("UPDATE pairing_rows SET consumed_at = now() WHERE code = %s", (code,))

    return jsonify(ciphertext=ciphertext)
