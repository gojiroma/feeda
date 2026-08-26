import re
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from app import limiter
from config import Config
from db import ensure_schema, get_pool

share_link_bp = Blueprint("share_link", __name__)

# 16 random bytes, base64url-encoded without padding — matches
# shareLink.js's randomUrlSafeString(16), so this is what the client always
# sends as <id>. Not a secret in itself (see db.py's share_link_rows
# comment): the actual decryption key never reaches the server at all.
ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
MAX_CIPHERTEXT_LEN = 4096


@share_link_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    # Same reasoning as sync.py's handler: raised by db.get_pool() when the
    # database env var isn't set, kept at request time so a misconfigured
    # deploy only breaks the routes that actually touch the database.
    return jsonify(error=str(err)), 500


def _cleanup_stale(conn):
    # Same opportunistic housekeeping as pair.py's _cleanup_stale — this
    # table is low-volume and short-lived by nature.
    conn.execute("DELETE FROM share_link_rows WHERE expires_at < now() - interval '1 hour'")


# No require_account_id on either route here, same reasoning as pair.py: the
# whole point of a share link is to hand full access to a browser tab that
# doesn't have (and never receives) the seed-derived Bearer token, so there's
# nothing to authenticate against yet. The random id's entropy, its TTL, and
# single-use consumption are the only access control.


@share_link_bp.put("/api/share-link/<id>")
@limiter.limit(lambda: Config.RATE_LIMIT_SHARE_LINK_WRITE)
def put_share_link(id):
    if not ID_RE.match(id):
        return jsonify(error="invalid id"), 400

    payload = request.get_json(silent=True)
    ciphertext = payload.get("ciphertext", "") if isinstance(payload, dict) else ""
    if not isinstance(ciphertext, str) or not ciphertext or len(ciphertext) > MAX_CIPHERTEXT_LEN:
        return jsonify(error="invalid ciphertext"), 400

    ensure_schema()
    pool = get_pool()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=Config.SHARE_LINK_TTL_SECONDS)
    with pool.connection() as conn:
        _cleanup_stale(conn)
        cur = conn.execute(
            """
            INSERT INTO share_link_rows (id, ciphertext, expires_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE
              SET ciphertext = EXCLUDED.ciphertext,
                  created_at = now(),
                  expires_at = EXCLUDED.expires_at,
                  consumed_at = NULL
            WHERE share_link_rows.expires_at < now() OR share_link_rows.consumed_at IS NOT NULL
            RETURNING id
            """,
            (id, ciphertext, expires_at),
        )
        applied = cur.fetchone() is not None

    if not applied:
        return jsonify(error="id in use"), 409

    return jsonify(expiresAt=expires_at.isoformat())


@share_link_bp.delete("/api/share-link/<id>")
@limiter.limit(lambda: Config.RATE_LIMIT_SHARE_LINK_WRITE)
def delete_share_link(id):
    # Lets the sharing device invalidate a link it just generated (see
    # setupShareLinkUI in shareLinkModal.js — called right before PUTting a
    # replacement, so only the most recently generated link is ever valid)
    # without waiting out its own TTL. Same "no ownership check beyond
    # knowing the id" reasoning as every other route here, and same
    # "already gone is still a success" idempotency as pair.py's own delete
    # route — the caller's goal ("this link no longer works") already holds
    # either way.
    if not ID_RE.match(id):
        return jsonify(error="invalid id"), 400

    ensure_schema()
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute("DELETE FROM share_link_rows WHERE id = %s", (id,))

    return "", 204


@share_link_bp.get("/api/share-link/<id>")
@limiter.limit(lambda: Config.RATE_LIMIT_SHARE_LINK_READ)
def get_share_link(id):
    if not ID_RE.match(id):
        return jsonify(error="invalid id"), 400

    ensure_schema()
    pool = get_pool()
    with pool.connection() as conn:
        with conn.transaction():
            cur = conn.execute(
                "SELECT ciphertext, expires_at, consumed_at FROM share_link_rows WHERE id = %s FOR UPDATE",
                (id,),
            )
            row = cur.fetchone()
            if row is None or row[1] < datetime.now(timezone.utc):
                return jsonify(error="not found or expired"), 404

            ciphertext, _expires_at, consumed_at = row
            if consumed_at is not None:
                return jsonify(error="already used"), 410

            conn.execute("UPDATE share_link_rows SET consumed_at = now() WHERE id = %s", (id,))

    return jsonify(ciphertext=ciphertext)
