from psycopg_pool import ConnectionPool

from config import Config

# Both the pool and the schema are created lazily, on first real use inside
# a request — never at module import time. Vercel imports this module (via
# api/index.py) during cold start before any request exists; if that import
# raises (e.g. because the DB URL isn't configured yet, or the DB is
# briefly unreachable), the whole function fails to load and *every*
# route 500s, including ones that don't touch the database at all.
_pool = None
_schema_ready = False

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

CREATE TABLE IF NOT EXISTS log_rows (
  account_id        TEXT NOT NULL,
  log_id            TEXT NOT NULL,
  ciphertext        TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, log_id)
);
CREATE INDEX IF NOT EXISTS idx_log_rows_account_updated
  ON log_rows (account_id, updated_at);

CREATE TABLE IF NOT EXISTS search_history_rows (
  account_id        TEXT NOT NULL,
  search_id         TEXT NOT NULL,
  ciphertext        TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, search_id)
);
CREATE INDEX IF NOT EXISTS idx_search_history_rows_account_updated
  ON search_history_rows (account_id, updated_at);

CREATE TABLE IF NOT EXISTS ng_word_rows (
  account_id        TEXT NOT NULL,
  ng_word_id        TEXT NOT NULL,
  ciphertext        TEXT NOT NULL,
  client_updated_at TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ng_word_id)
);
CREATE INDEX IF NOT EXISTS idx_ng_word_rows_account_updated
  ON ng_word_rows (account_id, updated_at);

-- Short-lived relay for the seed hand-off feature (QR code / 6-digit code —
-- see routes/pair.py). Rows are keyed by the code itself, not an account_id:
-- this table exists precisely to hand a seed to a device that doesn't have
-- an account yet, so there's nothing to scope it to. consumed_at marks a
-- code as already used (fetched once); expires_at bounds how long an unused
-- code stays valid. Both a consumed and an expired row are inert but kept
-- around briefly rather than deleted immediately, mainly so the sharing
-- side's status poll can still tell "used" apart from "never existed".
CREATE TABLE IF NOT EXISTS pairing_rows (
  code        TEXT PRIMARY KEY,
  ciphertext  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pairing_rows_expires ON pairing_rows (expires_at);
"""


def get_pool():
    global _pool
    if _pool is None:
        database_url = Config.require_database_url()
        _pool = ConnectionPool(conninfo=database_url, min_size=1, max_size=5)
    return _pool


def ensure_schema():
    global _schema_ready
    if _schema_ready:
        return
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute(SCHEMA)
    _schema_ready = True
