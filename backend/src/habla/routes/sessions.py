from datetime import UTC, datetime
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from habla.config import settings
from habla.db.connection import get_db
from habla.db.schema import SessionStatus
from habla.util import iso_now

router = APIRouter()

DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]

# Grace window between `/sessions/start` returning and the browser opening the WS.
# Within this window a DB `active` row with no matching WS is treated as live
# (the connection is in flight). After this window, it's stale — sweep and proceed.
START_WS_GRACE_SECS = 30


class SessionStart(BaseModel):
    scenario_id: int
    duration_sec: int = Field(ge=60, le=1800)


class SessionStartOut(BaseModel):
    session_id: int
    ws_url: str


class SessionAssess(BaseModel):
    self_assessment: int = Field(ge=0, le=3)


async def _reconcile_active(conn: aiosqlite.Connection, active_ws: dict) -> int | None:
    """Return the session_id that should block a new start, or None if clear.

    `active_ws` (in-memory WS registry) is the source of truth for "live right now".
    DB `active` status is intent. If they disagree and the DB row is older than the
    grace window, the row is stale — mark it failed and allow the new session."""
    cur = await conn.execute(
        "SELECT id, started_at FROM sessions WHERE analysis_status = ? LIMIT 1",
        (SessionStatus.ACTIVE,),
    )
    row = await cur.fetchone()
    if row is None:
        return None

    if row["id"] in active_ws:
        return row["id"]

    started = datetime.fromisoformat(row["started_at"])
    if started.tzinfo is None:
        # SQLite's `datetime('now')` default gives naive UTC.
        started = started.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - started).total_seconds()
    if age < START_WS_GRACE_SECS:
        return row["id"]

    await conn.execute(
        "UPDATE sessions SET analysis_status = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?",
        (SessionStatus.FAILED, iso_now(), row["id"]),
    )
    await conn.commit()
    return None


@router.post("/sessions/start", status_code=201, response_model=SessionStartOut)
async def start_session(request: Request, payload: SessionStart, conn: DbDep) -> SessionStartOut:
    missing = settings.voice_stack_missing()
    if missing:
        raise HTTPException(503, f"voice pipeline not configured: missing {', '.join(missing)}")

    cur = await conn.execute("SELECT 1 FROM scenarios WHERE id = ?", (payload.scenario_id,))
    if await cur.fetchone() is None:
        raise HTTPException(404, f"Scenario {payload.scenario_id} not found")

    blocker = await _reconcile_active(conn, request.app.state.active_ws)
    if blocker is not None:
        raise HTTPException(409, f"session {blocker} is already active")

    cur = await conn.execute(
        """
        INSERT INTO sessions (scenario_id, started_at, duration_sec, analysis_status)
        VALUES (?, ?, ?, ?)
        """,
        (payload.scenario_id, iso_now(), payload.duration_sec, SessionStatus.ACTIVE),
    )
    session_id = cur.lastrowid
    assert session_id is not None
    await conn.commit()

    return SessionStartOut(session_id=session_id, ws_url=f"/ws/session/{session_id}")


@router.post("/sessions/{session_id}/assess", status_code=204)
async def assess_session(session_id: int, payload: SessionAssess, conn: DbDep) -> Response:
    cur = await conn.execute(
        "UPDATE sessions SET self_assessment = ? WHERE id = ?",
        (payload.self_assessment, session_id),
    )
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Session {session_id} not found")
    return Response(status_code=204)
