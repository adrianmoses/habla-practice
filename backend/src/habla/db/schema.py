from enum import StrEnum

import aiosqlite


class SessionStatus(StrEnum):
    ACTIVE = "active"
    PENDING = "pending"
    JUDGED = "judged"
    COMPLETE = "complete"
    FAILED = "failed"


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS scenarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text_es    TEXT NOT NULL,
  gloss_es   TEXT,
  tags       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_chunks (
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  chunk_id    INTEGER NOT NULL REFERENCES chunks(id)    ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id     INTEGER NOT NULL REFERENCES scenarios(id),
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,
  duration_sec    INTEGER,
  self_assessment INTEGER,
  transcript      TEXT,
  analysis_status TEXT NOT NULL DEFAULT 'active',
  last_judged_at  TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunk_deployments (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_id   INTEGER NOT NULL REFERENCES chunks(id),
  deployed   INTEGER NOT NULL,
  evidence   TEXT,
  PRIMARY KEY (session_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS scenario_srs (
  scenario_id      INTEGER PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  ease_factor      REAL    NOT NULL DEFAULT 2.5,
  due_at           TEXT,
  last_reviewed_at TEXT,
  last_quality     INTEGER
);
"""

INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS idx_scenario_chunks_scenario
  ON scenario_chunks(scenario_id, position);
CREATE INDEX IF NOT EXISTS idx_chunk_deployments_chunk
  ON chunk_deployments(chunk_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions(analysis_status, ended_at);
"""


async def create_all(conn: aiosqlite.Connection) -> None:
    await conn.executescript(SCHEMA_SQL + INDEXES_SQL)
    await conn.commit()
