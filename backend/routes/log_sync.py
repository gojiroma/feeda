import re
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from db import ensure_schema, get_pool

# Same row-per-account-scoped-key sync protocol as routes/sync.py, but for
# the reading-activity log (open events + their comments) instead of feed
# subscriptions. Kept as a separate table/endpoint rather than folded into
# feed_rows: a log entry isn't a feed, and log_id is a random per-event UUID
# rather than a content-derived hash, so sharing feed_rows would mean two
# incompatible id schemes in one column.
log_sync_bp = Blueprint("log_sync", __name__)

LOG_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Larger than feed_rows' cap: a log row's ciphertext also carries its
# accumulated comment thread, which grows over the entry's lifetime.
MAX_CIPHERTEXT_LEN = 32768
MAX_BATCH_SIZE = 500


@log_sync_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    return jsonify(error=str(err)), 500


def _parse_iso8601(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@log_sync_bp.get("/api/log-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def get_log_sync():
    ensure_schema()
    since = _parse_iso8601(request.args.get("since", ""))

    pool = get_pool()
    with pool.connection() as conn:
        if since is not None:
            cur = conn.execute(
                """
                SELECT log_id, ciphertext, client_updated_at, updated_at
                FROM log_rows
                WHERE account_id = %s AND updated_at > %s
                ORDER BY updated_at ASC
                """,
                (g.account_id, since),
            )
        else:
            cur = conn.execute(
                """
                SELECT log_id, ciphertext, client_updated_at, updated_at
                FROM log_rows
                WHERE account_id = %s
                ORDER BY updated_at ASC
                """,
                (g.account_id,),
            )
        rows = cur.fetchall()

    return jsonify(
        rows=[
            {
                "logId": log_id,
                "ciphertext": ciphertext,
                "clientUpdatedAt": client_updated_at.isoformat(),
                "updatedAt": updated_at.isoformat(),
            }
            for log_id, ciphertext, client_updated_at, updated_at in rows
        ],
        serverTime=datetime.now(timezone.utc).isoformat(),
    )


def _validate_row(row):
    if not isinstance(row, dict):
        return None
    log_id = row.get("logId", "")
    ciphertext = row.get("ciphertext", "")
    client_updated_at = _parse_iso8601(row.get("clientUpdatedAt", ""))

    if not LOG_ID_RE.match(log_id):
        return None
    if not isinstance(ciphertext, str) or not ciphertext or len(ciphertext) > MAX_CIPHERTEXT_LEN:
        return None
    if client_updated_at is None:
        return None
    return log_id, ciphertext, client_updated_at


@log_sync_bp.put("/api/log-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def put_log_sync():
    ensure_schema()
    payload = request.get_json(silent=True)
    if not isinstance(payload, list):
        return jsonify(error="body must be a JSON array of rows"), 400
    if len(payload) > MAX_BATCH_SIZE:
        return jsonify(error=f"too many rows (max {MAX_BATCH_SIZE})"), 400

    validated = []
    for raw_row in payload:
        row = _validate_row(raw_row)
        if row is None:
            return jsonify(error="invalid row", row=raw_row), 400
        validated.append(row)

    applied = []
    skipped = []
    pool = get_pool()
    with pool.connection() as conn:
        with conn.transaction():
            for log_id, ciphertext, client_updated_at in validated:
                cur = conn.execute(
                    """
                    INSERT INTO log_rows (account_id, log_id, ciphertext, client_updated_at, updated_at)
                    VALUES (%s, %s, %s, %s, now())
                    ON CONFLICT (account_id, log_id) DO UPDATE
                    SET ciphertext = EXCLUDED.ciphertext,
                        client_updated_at = EXCLUDED.client_updated_at,
                        updated_at = now()
                    WHERE EXCLUDED.client_updated_at > log_rows.client_updated_at
                    RETURNING log_id
                    """,
                    (g.account_id, log_id, ciphertext, client_updated_at),
                )
                if cur.fetchone() is not None:
                    applied.append(log_id)
                else:
                    skipped.append(log_id)

    return jsonify(applied=applied, skipped=skipped)
