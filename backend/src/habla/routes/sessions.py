from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from habla.config import settings
from habla.db.connection import get_db
from habla.db.schema import SessionStatus
from habla.util import iso_now

router = APIRouter()

DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]


class SessionStart(BaseModel):
    scenario_id: int
    duration_sec: int = Field(ge=60, le=1800)


class SessionStartOut(BaseModel):
    session_id: int
    ws_url: str


class SessionAssess(BaseModel):
    self_assessment: int = Field(ge=0, le=3)


@router.post("/sessions/start", status_code=201, response_model=SessionStartOut)
async def start_session(payload: SessionStart, conn: DbDep) -> SessionStartOut:
    missing = settings.voice_stack_missing()
    if missing:
        raise HTTPException(503, f"voice pipeline not configured: missing {', '.join(missing)}")

    cur = await conn.execute("SELECT 1 FROM scenarios WHERE id = ?", (payload.scenario_id,))
    if await cur.fetchone() is None:
        raise HTTPException(404, f"Scenario {payload.scenario_id} not found")

    cur = await conn.execute(
        "SELECT id FROM sessions WHERE analysis_status = ? LIMIT 1",
        (SessionStatus.ACTIVE,),
    )
    if (existing := await cur.fetchone()) is not None:
        raise HTTPException(409, f"session {existing['id']} is already active")

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
