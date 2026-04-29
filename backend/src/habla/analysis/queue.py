"""Background analysis worker.

Picks up sessions sitting at `analysis_status='pending'` with a non-NULL
`self_assessment` and runs them through the LLM-as-judge.

Single-process, single-instance. Coordination across processes would require a
SQLite-friendly claim step (UPDATE ... RETURNING with a status guard), which
we don't need at single-user scale.

The route layer nudges the worker via `analysis_pending_event.set()` after a
new session is assessed; the 30s wait_for fallback is the durability backstop
that survives missed nudges and crash-restart cycles.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

from habla.db.schema import SessionStatus

if TYPE_CHECKING:
    import aiosqlite

log = logging.getLogger(__name__)

POLL_TIMEOUT_SEC = 30
RETRY_BACKOFF_SEC = 5
MAX_RETRIES = 3

analysis_pending_event = asyncio.Event()


async def run_worker(conn: aiosqlite.Connection) -> None:
    """Lifespan-managed loop. Cancellation-safe."""
    log.info("analysis worker started")
    while True:
        try:
            await asyncio.wait_for(analysis_pending_event.wait(), timeout=POLL_TIMEOUT_SEC)
        except TimeoutError:
            pass  # idle sweep
        analysis_pending_event.clear()
        await _drain_once(conn)


async def _drain_once(conn: aiosqlite.Connection) -> int:
    """Process every claimable row in turn. Returns the number processed."""
    processed = 0
    while True:
        session_id = await _claim_next(conn)
        if session_id is None:
            return processed
        await _process_one(conn, session_id)
        processed += 1


async def _claim_next(conn: aiosqlite.Connection) -> int | None:
    cur = await conn.execute(
        "SELECT id FROM sessions "
        "WHERE analysis_status = ? "
        "  AND self_assessment IS NOT NULL "
        "  AND retry_count < ? "
        "ORDER BY ended_at "
        "LIMIT 1",
        (SessionStatus.PENDING, MAX_RETRIES),
    )
    row = await cur.fetchone()
    return row["id"] if row else None


async def _process_one(conn: aiosqlite.Connection, session_id: int) -> None:
    # Local import to avoid a circular dependency at module load time
    # (judge -> routes.scenarios -> nothing analysis-related, but the local
    # import keeps the package boundary clean).
    from habla.analysis.judge import judge_session

    try:
        await judge_session(conn, session_id)
        log.info("judged session_id=%d", session_id)
        return
    except asyncio.CancelledError:
        raise
    except Exception as e:
        # Catch broadly: anything other than CancelledError is a transient
        # failure from the worker's perspective. The retry counter caps
        # repeated misbehaviour so a poison row doesn't loop forever.
        cur = await conn.execute(
            "UPDATE sessions SET retry_count = retry_count + 1 WHERE id = ? "
            "RETURNING retry_count",
            (session_id,),
        )
        row = await cur.fetchone()
        await conn.commit()
        retries = row["retry_count"] if row else MAX_RETRIES
        log.warning("judge failed session_id=%d retry=%d: %s", session_id, retries, e)
        if retries >= MAX_RETRIES:
            await conn.execute(
                "UPDATE sessions SET analysis_status = ? WHERE id = ?",
                (SessionStatus.FAILED, session_id),
            )
            await conn.commit()
        else:
            await asyncio.sleep(RETRY_BACKOFF_SEC * retries)
