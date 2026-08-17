from psycopg_pool import ConnectionPool

from config import Config

_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = ConnectionPool(conninfo=Config.NEON_DATABASE_URL, min_size=1, max_size=5)
    return _pool


SCHEMA = """
CREATE TABLE IF NOT EXISTS feed_rows (
  account_id        TEXT NOT NULL,
  feed_id           TEXT NOT NULL,
  ciphertext        TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, feed_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_rows_account_updated
  ON feed_rows (account_id, updated_at);
"""


def init_db():
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute(SCHEMA)
