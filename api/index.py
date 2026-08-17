import os
import sys

BACKEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))

from app import create_app  # noqa: E402

app = create_app()
