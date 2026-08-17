import re
from functools import wraps

from flask import g, jsonify, request

ACCOUNT_ID_RE = re.compile(r"^[0-9a-f]{64}$")


def require_account_id(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify(error="missing bearer token"), 401
        account_id = auth_header[len("Bearer "):].strip().lower()
        if not ACCOUNT_ID_RE.match(account_id):
            return jsonify(error="malformed account id"), 401
        g.account_id = account_id
        return fn(*args, **kwargs)

    return wrapper
