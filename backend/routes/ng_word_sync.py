import re
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from db import ensure_schema, get_pool

# Same row-per-account-scoped-key sync protocol as routes/search_sync.py,
# applied to the NG-word blocklist (see public/static/js/ngWords.js) instead
# of the search-history dropdown. ng_word_id is a content-derived hash
# (deriveNgWordId in crypto.js, seed + lowercased word) rather than a random
# id, so the same word added again on any device resolves to the same row
# instead of piling up duplicates server-side.
ng_word_sync_bp = Blueprint("ng_word_sync", __name__)

NG_WORD_ID_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CIPHERTEXT_LEN = 4096
MAX_BATCH_SIZE = 500


@ng_word_sync_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    return jsonify(error=str(err)), 500


def _parse_iso8601(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@ng_word_sync_bp.get("/api/ng-word-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def get_ng_word_sync():
    ensure_schema()
    since = _parse_iso8601(request.args.get("since", ""))

    pool = get_pool()
    with pool.connection() as conn:
        if since is not None:
            cur = conn.execute(
                """
                SELECT ng_word_id, ciphertext, client_updated_at, updated_at
                FROM ng_word_rows
                WHERE account_id = %s AND updated_at > %s
                ORDER BY updated_at ASC
                """,
                (g.account_id, since),
            )
        else:
            cur = conn.execute(
                """
                SELECT ng_word_id, ciphertext, client_updated_at, updated_at
                FROM ng_word_rows
                WHERE account_id = %s
                ORDER BY updated_at ASC
                """,
                (g.account_id,),
            )
        rows = cur.fetchall()

    return jsonify(
        rows=[
            {
                "ngWordId": ng_word_id,
                "ciphertext": ciphertext,
                "clientUpdatedAt": client_updated_at.isoformat(),
                "updatedAt": updated_at.isoformat(),
            }
            for ng_word_id, ciphertext, client_updated_at, updated_at in rows
        ],
        serverTime=datetime.now(timezone.utc).isoformat(),
    )


def _validate_row(row):
    if not isinstance(row, dict):
        return None
    ng_word_id = row.get("ngWordId", "")
    ciphertext = row.get("ciphertext", "")
    client_updated_at = _parse_iso8601(row.get("clientUpdatedAt", ""))

    if not NG_WORD_ID_RE.match(ng_word_id):
        return None
    if not isinstance(ciphertext, str) or not ciphertext or len(ciphertext) > MAX_CIPHERTEXT_LEN:
        return None
    if client_updated_at is None:
        return None
    return ng_word_id, ciphertext, client_updated_at


@ng_word_sync_bp.put("/api/ng-word-sync")
@limiter.limit(lambda: Config.RATE_LIMIT_SYNC)
@require_account_id
def put_ng_word_sync():
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
            for ng_word_id, ciphertext, client_updated_at in validated:
                cur = conn.execute(
                    """
                    INSERT INTO ng_word_rows (account_id, ng_word_id, ciphertext, client_updated_at, updated_at)
                    VALUES (%s, %s, %s, %s, now())
                    ON CONFLICT (account_id, ng_word_id) DO UPDATE
                    SET ciphertext = EXCLUDED.ciphertext,
                        client_updated_at = EXCLUDED.client_updated_at,
                        updated_at = now()
                    WHERE EXCLUDED.client_updated_at > ng_word_rows.client_updated_at
                    RETURNING ng_word_id
                    """,
                    (g.account_id, ng_word_id, ciphertext, client_updated_at),
                )
                if cur.fetchone() is not None:
                    applied.append(ng_word_id)
                else:
                    skipped.append(ng_word_id)

    return jsonify(applied=applied, skipped=skipped)
