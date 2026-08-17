import logging

from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import Config
from db import init_db

limiter = Limiter(key_func=get_remote_address)


def create_app():
    app = Flask(__name__)
    Config.validate()

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

    init_db()

    from routes.sync import sync_bp
    from routes.proxy import proxy_bp

    app.register_blueprint(sync_bp)
    app.register_blueprint(proxy_bp)

    @app.get("/api/healthz")
    def healthz():
        return {"status": "ok"}

    return app


if __name__ == "__main__":
    create_app().run(debug=True, port=5000)
