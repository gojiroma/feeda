import logging
import time
from urllib.parse import urljoin

from flask import Blueprint, Response, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from ssrf_guard import SSRFError, safe_get

proxy_bp = Blueprint("proxy", __name__)
logger = logging.getLogger(__name__)

MAX_REDIRECTS = 5
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
PROXY_USER_AGENT = "feeda-rss-proxy/1.0"


@proxy_bp.get("/api/fetch-feed")
@limiter.limit(lambda: Config.RATE_LIMIT_PROXY)
@require_account_id
def fetch_feed():
    target_url = request.headers.get("X-Feed-Url", "").strip()
    if not target_url:
        return jsonify(error="X-Feed-Url header is required"), 400

    origin_headers = {"User-Agent": PROXY_USER_AGENT, "Accept-Encoding": "gzip"}
    if if_none_match := request.headers.get("X-Feed-If-None-Match"):
        origin_headers["If-None-Match"] = if_none_match
    if if_modified_since := request.headers.get("X-Feed-If-Modified-Since"):
        origin_headers["If-Modified-Since"] = if_modified_since

    url = target_url
    # One deadline shared across every redirect hop, instead of handing each
    # hop its own fresh PROXY_TIMEOUT_SECONDS budget: a slow-but-technically-
    # responding origin could otherwise burn up to MAX_REDIRECTS times that
    # before we ourselves gave up, well past the serverless platform's own
    # function execution limit — which kills the process with a bare,
    # bodyless 502 instead of the informative JSON error below.
    deadline = time.monotonic() + Config.PROXY_TIMEOUT_SECONDS
    try:
        for _ in range(MAX_REDIRECTS):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return jsonify(error="feed fetch timed out"), 502
            resp = safe_get(url, headers=origin_headers, timeout=remaining, stream=True)
            if resp.status_code in REDIRECT_STATUSES and resp.headers.get("Location"):
                next_url = urljoin(url, resp.headers["Location"])
                resp.close()
                url = next_url
                continue
            break
        else:
            return jsonify(error="too many redirects"), 502
    except SSRFError as exc:
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        # Log with the real hostname (not the full URL/query) for
        # debuggability, without putting the whole feed URL in logs.
        logger.exception("fetch-feed connect failed for host=%s", request.headers.get("X-Feed-Url", "")[:200])
        return jsonify(error=f"failed to fetch feed: {type(exc).__name__}: {exc}"), 502

    try:
        with resp:
            if resp.status_code == 304:
                return Response(status=304)

            if resp.status_code >= 400:
                return jsonify(error=f"origin returned {resp.status_code}"), 502

            body = bytearray()
            for chunk in resp.iter_content(chunk_size=65536):
                body.extend(chunk)
                if len(body) > Config.PROXY_MAX_BYTES:
                    return jsonify(error="feed too large"), 502

            headers = {}
            content_type = resp.headers.get("Content-Type")
            if content_type:
                headers["Content-Type"] = content_type
            if etag := resp.headers.get("ETag"):
                headers["ETag"] = etag
            if last_modified := resp.headers.get("Last-Modified"):
                headers["Last-Modified"] = last_modified

            return Response(bytes(body), status=200, headers=headers)
    except Exception as exc:
        logger.exception("fetch-feed body read failed for host=%s", target_url[:200])
        return jsonify(error=f"failed to read feed body: {type(exc).__name__}: {exc}"), 502
