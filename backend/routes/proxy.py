from urllib.parse import urljoin

from flask import Blueprint, Response, jsonify, request

from app import limiter
from auth import require_account_id
from config import Config
from ssrf_guard import SSRFError, safe_get

proxy_bp = Blueprint("proxy", __name__)

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
    try:
        for _ in range(MAX_REDIRECTS):
            resp = safe_get(url, headers=origin_headers, timeout=Config.PROXY_TIMEOUT_SECONDS, stream=True)
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
    except Exception:
        return jsonify(error="failed to fetch feed"), 502

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
