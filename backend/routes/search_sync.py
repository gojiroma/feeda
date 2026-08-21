import re
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from db import ensure_schema, get_pool

# Same row-per-account-scoped-key sync protocol as routes/sync.py, applied to
# the search-history dropdown (see searchBar.js) instead of feed
# subscriptions. search_id is a content-derived hash (deriveSearchId in
# crypto.js, seed + normalized query text) rather than a random id, so the
# same query searched again on any device resolves to the same row instead
# of piling up duplicates server-side.
search_sync_bp = Blueprint("search_sync", __name__)

SEARCH_ID_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CIPHERTEXT_LEN = 8192
MAX_BATCH_SIZE = 500


@search_sync_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    return jsonify(error=str(err)), 500


def _parse_iso8601(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@search_sync_bp.get("/api/search-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def get_search_sync():
    ensure_schema()
    since = _parse_iso8601(request.args.get("since", ""))

    pool = get_pool()
    with pool.connection() as conn:
        if since is not None:
            cur = conn.execute(
                """
                SELECT search_id, ciphertext, client_updated_at, updated_at
                FROM search_history_rows
                WHERE account_id = %s AND updated_at > %s
                ORDER BY updated_at ASC
                """,
                (g.account_id, since),
            )
        else:
            cur = conn.execute(
                """
                SELECT search_id, ciphertext, client_updated_at, updated_at
                FROM search_history_rows
                WHERE account_id = %s
                ORDER BY updated_at ASC
                """,
                (g.account_id,),
            )
        rows = cur.fetchall()

    return jsonify(
        rows=[
            {
                "searchId": search_id,
                "ciphertext": ciphertext,
                "clientUpdatedAt": client_updated_at.isoformat(),
                "updatedAt": updated_at.isoformat(),
            }
            for search_id, ciphertext, client_updated_at, updated_at in rows
        ],
        serverTime=datetime.now(timezone.utc).isoformat(),
    )


def _validate_row(row):
    if not isinstance(row, dict):
        return None
    search_id = row.get("searchId", "")
    ciphertext = row.get("ciphertext", "")
    client_updated_at = _parse_iso8601(row.get("clientUpdatedAt", ""))

    if not SEARCH_ID_RE.match(search_id):
        return None
    if not isinstance(ciphertext, str) or not ciphertext or len(ciphertext) > MAX_CIPHERTEXT_LEN:
        return None
    if client_updated_at is None:
        return None
    return search_id, ciphertext, client_updated_at


@search_sync_bp.put("/api/search-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def put_search_sync():
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
            for search_id, ciphertext, client_updated_at in validated:
                cur = conn.execute(
                    """
                    INSERT INTO search_history_rows (account_id, search_id, ciphertext, client_updated_at, updated_at)
                    VALUES (%s, %s, %s, %s, now())
                    ON CONFLICT (account_id, search_id) DO UPDATE
                    SET ciphertext = EXCLUDED.ciphertext,
                        client_updated_at = EXCLUDED.client_updated_at,
                        updated_at = now()
                    WHERE EXCLUDED.client_updated_at > search_history_rows.client_updated_at
                    RETURNING search_id
                    """,
                    (g.account_id, search_id, ciphertext, client_updated_at),
                )
                if cur.fetchone() is not None:
                    applied.append(search_id)
                else:
                    skipped.append(search_id)

    return jsonify(applied=applied, skipped=skipped)
