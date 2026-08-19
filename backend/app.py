import logging

from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import Config

limiter = Limiter(key_func=get_remote_address)


def create_app():
    # Deliberately does nothing that touches the database or requires
    # NEON_DATABASE_URL to be set. This function runs at import time on
    # every cold start (see api/index.py); if it raised here, a missing/
    # misconfigured env var would take down every route, including ones
    # that don't need the database (like this health check). DB access is
    # deferred to request time in routes/sync.py via db.ensure_schema().
    app = Flask(__name__)

    CORS(
        app,
        origins=[Config.ALLOWED_ORIGIN],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Feed-Url",
            "X-Feed-If-None-Match",
            "X-Feed-If-Modified-Since",
        ],
        expose_headers=["ETag", "Last-Modified"],
    )
    limiter.init_app(app)

    logging.basicConfig(level=logging.INFO)
    # Keep access logs free of full request query strings (feed URLs, tokens).
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

    from routes.sync import sync_bp
    from routes.log_sync import log_sync_bp
    from routes.proxy import proxy_bp

    app.register_blueprint(sync_bp)
    app.register_blueprint(log_sync_bp)
    app.register_blueprint(proxy_bp)

    @app.get("/api/healthz")
    def healthz():
        return {"status": "ok"}

    return app


if __name__ == "__main__":
    create_app().run(debug=True, port=5000)
