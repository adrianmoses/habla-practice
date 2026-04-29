import json
from datetime import UTC, datetime
from typing import Annotated, Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from habla.analysis.queue import analysis_pending_event
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


class ScenarioRef(BaseModel):
    id: int
    slug: str
    name: str
    icon: str


class SessionListItem(BaseModel):
    id: int
    scenario: ScenarioRef
    ended_at: str
    duration_sec: int | None
    self_assessment: int | None
    analysis_status: str
    deployed_count: int | None
    chunk_count: int


class DeploymentItem(BaseModel):
    chunk_id: int
    deployed: bool
    evidence: str | None


class SessionDetail(BaseModel):
    id: int
    scenario_id: int
    started_at: str
    ended_at: str | None
    duration_sec: int | None
    self_assessment: int | None
    analysis_status: str
    transcript: list[dict[str, Any]]
    deployments: list[DeploymentItem]


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


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(conn: DbDep, limit: int = 20) -> list[SessionListItem]:
    limit = max(1, min(limit, 100))
    cur = await conn.execute(
        "SELECT s.id, s.ended_at, s.duration_sec, s.self_assessment, s.analysis_status, "
        "       sc.id AS scenario_id, sc.slug, sc.name, sc.icon, "
        "       d.deployed_count, "
        "       COALESCE(cc.chunk_count, 0) AS chunk_count "
        "FROM sessions s "
        "JOIN scenarios sc ON s.scenario_id = sc.id "
        "LEFT JOIN ("
        "  SELECT session_id, SUM(deployed) AS deployed_count "
        "  FROM chunk_deployments GROUP BY session_id"
        ") d ON d.session_id = s.id "
        "LEFT JOIN ("
        "  SELECT scenario_id, COUNT(*) AS chunk_count "
        "  FROM scenario_chunks GROUP BY scenario_id"
        ") cc ON cc.scenario_id = s.scenario_id "
        "WHERE s.ended_at IS NOT NULL "
        "ORDER BY s.ended_at DESC "
        "LIMIT ?",
        (limit,),
    )
    rows = await cur.fetchall()
    return [
        SessionListItem(
            id=r["id"],
            scenario=ScenarioRef(
                id=r["scenario_id"], slug=r["slug"], name=r["name"], icon=r["icon"]
            ),
            ended_at=r["ended_at"],
            duration_sec=r["duration_sec"],
            self_assessment=r["self_assessment"],
            analysis_status=r["analysis_status"],
            deployed_count=r["deployed_count"],
            chunk_count=r["chunk_count"],
        )
        for r in rows
    ]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, conn: DbDep) -> SessionDetail:
    cur = await conn.execute(
        "SELECT id, scenario_id, started_at, ended_at, duration_sec, self_assessment, "
        "       analysis_status, transcript "
        "FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, f"Session {session_id} not found")

    transcript = json.loads(row["transcript"]) if row["transcript"] else []

    cur = await conn.execute(
        "SELECT chunk_id, deployed, evidence FROM chunk_deployments "
        "WHERE session_id = ? ORDER BY chunk_id",
        (session_id,),
    )
    dep_rows = await cur.fetchall()
    deployments = [
        DeploymentItem(
            chunk_id=dr["chunk_id"], deployed=bool(dr["deployed"]), evidence=dr["evidence"]
        )
        for dr in dep_rows
    ]

    return SessionDetail(
        id=row["id"],
        scenario_id=row["scenario_id"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        duration_sec=row["duration_sec"],
        self_assessment=row["self_assessment"],
        analysis_status=row["analysis_status"],
        transcript=transcript,
        deployments=deployments,
    )


@router.post("/sessions/{session_id}/assess", status_code=204)
async def assess_session(session_id: int, payload: SessionAssess, conn: DbDep) -> Response:
    cur = await conn.execute(
        "UPDATE sessions SET self_assessment = ? WHERE id = ?",
        (payload.self_assessment, session_id),
    )
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Session {session_id} not found")
    analysis_pending_event.set()
    return Response(status_code=204)
