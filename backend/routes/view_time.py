import re
from datetime import date, datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from db import ensure_schema, get_pool

# Daily per-account view-time budget — see public/static/js/viewTime.js for
# the client-side heartbeat loop and db.py's view_time_rows for the schema.
# Unlike every other *_sync.py route in this package, this isn't an E2E-
# encrypted content sync: there's no ciphertext here, just a per-day integer
# second count, kept server-side (rather than only in localStorage) so the
# limit survives clearing site data or switching devices on the same account.
view_time_bp = Blueprint("view_time", __name__)

VIEW_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# A heartbeat's own interval is much shorter than this (see
# HEARTBEAT_INTERVAL_MS in viewTime.js) — the generous ceiling just absorbs a
# throttled/backgrounded timer firing late, not a deliberately inflated claim.
MAX_HEARTBEAT_SECONDS = 120
# Sanity ceiling on the accumulated per-day total, well above the actual
# daily limit — keeps a buggy/malicious client from growing the column
# without bound rather than reflecting any real allowance.
MAX_DAILY_SECONDS = 24 * 60 * 60
# How far a client-supplied view_date may drift from the server's own UTC
# date — wide enough to cover every real timezone's local-midnight offset
# from UTC (at most a day either side), with a little slack for clock skew.
MAX_DATE_DRIFT_DAYS = 2


@view_time_bp.errorhandler(RuntimeError)
def _handle_db_not_configured(err):
    return jsonify(error=str(err)), 500


def _parse_view_date(value):
    if not isinstance(value, str) or not VIEW_DATE_RE.match(value):
        return None
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
    today = datetime.now(timezone.utc).date()
    if abs((parsed - today).days) > MAX_DATE_DRIFT_DAYS:
        return None
    return parsed


def _status_payload(seconds_viewed):
    seconds_viewed = seconds_viewed or 0
    return {
        "secondsViewed": seconds_viewed,
        "limitSeconds": Config.DAILY_VIEW_LIMIT_SECONDS,
        "limitReached": seconds_viewed >= Config.DAILY_VIEW_LIMIT_SECONDS,
    }


@view_time_bp.get("/api/view-time/status")
@limiter.limit(lambda: Config.RATE_LIMIT_VIEW_TIME)
@require_account_id
def get_view_time_status():
    ensure_schema()
    view_date = _parse_view_date(request.args.get("viewDate", ""))
    if view_date is None:
        return jsonify(error="invalid or out-of-range viewDate"), 400

    pool = get_pool()
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT seconds_viewed FROM view_time_rows WHERE account_id = %s AND view_date = %s",
            (g.account_id, view_date),
        )
        row = cur.fetchone()

    return jsonify(**_status_payload(row[0] if row else 0))


@view_time_bp.post("/api/view-time/heartbeat")
@limiter.limit(lambda: Config.RATE_LIMIT_VIEW_TIME)
@require_account_id
def post_view_time_heartbeat():
    ensure_schema()
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="body must be a JSON object"), 400

    view_date = _parse_view_date(payload.get("viewDate", ""))
    if view_date is None:
        return jsonify(error="invalid or out-of-range viewDate"), 400

    seconds = payload.get("seconds")
    if not isinstance(seconds, int) or isinstance(seconds, bool) or not (1 <= seconds <= MAX_HEARTBEAT_SECONDS):
        return jsonify(error=f"seconds must be an integer between 1 and {MAX_HEARTBEAT_SECONDS}"), 400

    pool = get_pool()
    with pool.connection() as conn:
        with conn.transaction():
            cur = conn.execute(
                """
                INSERT INTO view_time_rows (account_id, view_date, seconds_viewed, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (account_id, view_date) DO UPDATE
                SET seconds_viewed = LEAST(view_time_rows.seconds_viewed + EXCLUDED.seconds_viewed, %s),
                    updated_at = now()
                RETURNING seconds_viewed
                """,
                (g.account_id, view_date, seconds, MAX_DAILY_SECONDS),
            )
            seconds_viewed = cur.fetchone()[0]

    return jsonify(**_status_payload(seconds_viewed))
