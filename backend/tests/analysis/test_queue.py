"""Worker smoke tests.

Exercise `_drain_once` and `_claim_next` directly; never start the long-running
event loop. `judge_session` is patched so each tick is deterministic.
"""

from __future__ import annotations

from unittest.mock import patch

import aiosqlite

from habla.analysis import queue as queue_mod
from habla.analysis.judge import JudgeError
from habla.db.schema import SessionStatus


async def _seed_scenario(conn: aiosqlite.Connection) -> int:
    cur = await conn.execute(
        "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)", ("s", "S", "🟢")
    )
    sid = cur.lastrowid
    assert sid is not None
    await conn.commit()
    return sid


async def _seed_session(
    conn: aiosqlite.Connection,
    scenario_id: int,
    *,
    self_assessment: int | None = 2,
    status: str = SessionStatus.PENDING,
    retry_count: int = 0,
    ended_at: str = "2026-04-28T10:00:00+00:00",
) -> int:
    cur = await conn.execute(
        "INSERT INTO sessions (scenario_id, started_at, ended_at, self_assessment, "
        "                      transcript, analysis_status, retry_count) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (scenario_id, ended_at, ended_at, self_assessment, "[]", status, retry_count),
    )
    await conn.commit()
    sid = cur.lastrowid
    assert sid is not None
    return sid


async def test_claim_next_empty(db: aiosqlite.Connection) -> None:
    assert await queue_mod._claim_next(db) is None


async def test_claim_next_skips_unassessed(db: aiosqlite.Connection) -> None:
    scenario_id = await _seed_scenario(db)
    await _seed_session(db, scenario_id, self_assessment=None)
    assert await queue_mod._claim_next(db) is None


async def test_claim_next_skips_non_pending(db: aiosqlite.Connection) -> None:
    scenario_id = await _seed_scenario(db)
    await _seed_session(db, scenario_id, status=SessionStatus.JUDGED)
    await _seed_session(db, scenario_id, status=SessionStatus.ACTIVE)
    await _seed_session(db, scenario_id, status=SessionStatus.FAILED)
    assert await queue_mod._claim_next(db) is None


async def test_claim_next_skips_retry_exhausted(db: aiosqlite.Connection) -> None:
    scenario_id = await _seed_scenario(db)
    await _seed_session(db, scenario_id, retry_count=queue_mod.MAX_RETRIES)
    assert await queue_mod._claim_next(db) is None


async def test_claim_next_returns_eligible(db: aiosqlite.Connection) -> None:
    scenario_id = await _seed_scenario(db)
    sid = await _seed_session(db, scenario_id)
    assert await queue_mod._claim_next(db) == sid


async def test_drain_marks_judged_on_success(db: aiosqlite.Connection) -> None:
    scenario_id = await _seed_scenario(db)
    sid = await _seed_session(db, scenario_id)

    async def fake_judge(c: aiosqlite.Connection, session_id: int) -> None:
        await c.execute(
            "UPDATE sessions SET analysis_status = ? WHERE id = ?",
            (SessionStatus.JUDGED, session_id),
        )
        await c.commit()

    with patch("habla.analysis.queue.judge_session", side_effect=fake_judge):
        processed = await queue_mod._drain_once(db)

    assert processed == 1
    cur = await db.execute("SELECT analysis_status FROM sessions WHERE id = ?", (sid,))
    row = await cur.fetchone()
    assert row is not None
    assert row["analysis_status"] == SessionStatus.JUDGED


async def test_drain_marks_failed_after_max_retries(db: aiosqlite.Connection) -> None:
    """A persistently-failing row is retried within a single drain call until
    retry_count hits MAX_RETRIES, then marked FAILED."""
    scenario_id = await _seed_scenario(db)
    sid = await _seed_session(db, scenario_id)

    async def fake_judge_failure(*_args, **_kwargs) -> None:
        raise JudgeError("boom")

    async def no_sleep(_secs: float) -> None:
        return None

    with (
        patch("habla.analysis.queue.judge_session", side_effect=fake_judge_failure),
        patch("habla.analysis.queue.asyncio.sleep", side_effect=no_sleep),
    ):
        await queue_mod._drain_once(db)

    cur = await db.execute("SELECT analysis_status, retry_count FROM sessions WHERE id = ?", (sid,))
    row = await cur.fetchone()
    assert row is not None
    assert row["analysis_status"] == SessionStatus.FAILED
    assert row["retry_count"] == queue_mod.MAX_RETRIES


async def test_drain_recovers_after_transient_failure(db: aiosqlite.Connection) -> None:
    """Two failures then a success: row reaches JUDGED, retry_count=2."""
    scenario_id = await _seed_scenario(db)
    sid = await _seed_session(db, scenario_id)

    call_count = {"n": 0}

    async def fake_judge(c: aiosqlite.Connection, session_id: int) -> None:
        call_count["n"] += 1
        if call_count["n"] <= 2:
            raise JudgeError("transient")
        await c.execute(
            "UPDATE sessions SET analysis_status = ? WHERE id = ?",
            (SessionStatus.JUDGED, session_id),
        )
        await c.commit()

    async def no_sleep(_secs: float) -> None:
        return None

    with (
        patch("habla.analysis.queue.judge_session", side_effect=fake_judge),
        patch("habla.analysis.queue.asyncio.sleep", side_effect=no_sleep),
    ):
        await queue_mod._drain_once(db)

    cur = await db.execute("SELECT analysis_status, retry_count FROM sessions WHERE id = ?", (sid,))
    row = await cur.fetchone()
    assert row is not None
    assert row["analysis_status"] == SessionStatus.JUDGED
    assert row["retry_count"] == 2
