"""Dashboard / streak aggregates.

Every field is derived from `sessions`, `chunk_deployments`, and `scenario_srs`
on each request — no persisted streak counter. Volumes are small (single-user,
low thousands of rows lifetime), so full scans are cheap and keep the read path
as the single source of truth.

Streak is intentionally judge-independent: a session counts as practice the
moment it has a real `ended_at` and a non-empty transcript, regardless of where
`analysis_status` has moved. `failed` sessions with partial transcripts still
count — a mid-conversation WS drop shouldn't cost the learner their streak.

All "what day is it" math happens in Europe/Madrid (see spec §Key Decisions).
"""

from datetime import date, datetime, timedelta
from typing import Annotated
from zoneinfo import ZoneInfo

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from habla.db.connection import get_db

MADRID_TZ = ZoneInfo("Europe/Madrid")

router = APIRouter()
DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]


class StreakOut(BaseModel):
    current_streak: int
    last_session_date: str | None  # ISO date in Madrid local time, or None
    sessions_this_week: int  # raw session count, not distinct days
    weekly_grid: list[int]  # length 7, Monday-indexed
    total_reps: int
    due_today_count: int


def compute_streak(session_dates: set[date], today: date) -> tuple[int, date | None]:
    """Return (current_streak, last_session_date).

    Streak is the length of the most recent contiguous run of days ending on
    `today` or `yesterday`. If the most recent session day is older than that,
    the streak is 0 (the run is broken). Same-day duplicates dedupe via the set.
    """
    if not session_dates:
        return (0, None)

    last = max(session_dates)
    if last < today - timedelta(days=1):
        return (0, last)

    count = 0
    cursor = last
    while cursor in session_dates:
        count += 1
        cursor -= timedelta(days=1)
    return (count, last)


def _to_madrid_date(iso: str) -> date:
    """SQLite stores ISO strings (UTC from iso_now()). Convert to Madrid date."""
    dt = datetime.fromisoformat(iso)
    return dt.astimezone(MADRID_TZ).date()


def _week_bounds(today: date) -> tuple[date, date]:
    """Monday-start week bounds as [monday, sunday] inclusive."""
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return (monday, sunday)


@router.get("/streak", response_model=StreakOut)
async def get_streak(conn: DbDep) -> StreakOut:
    # Sessions that count as practice: ended with a non-empty transcript.
    # Excludes `active` (still running) and empty-transcript failures (WS dropped
    # before any turn finalized).
    cur = await conn.execute(
        "SELECT ended_at FROM sessions "
        "WHERE ended_at IS NOT NULL "
        "AND transcript IS NOT NULL "
        "AND transcript != '[]' "
        "AND transcript != ''"
    )
    rows = await cur.fetchall()
    madrid_dates = [_to_madrid_date(r["ended_at"]) for r in rows]
    unique_days = set(madrid_dates)

    now_madrid = datetime.now(MADRID_TZ)
    today = now_madrid.date()
    streak, last_day = compute_streak(unique_days, today)

    monday, sunday = _week_bounds(today)
    weekly_grid = [0] * 7
    sessions_this_week = 0
    for d in madrid_dates:
        if monday <= d <= sunday:
            weekly_grid[d.weekday()] += 1
            sessions_this_week += 1

    cur = await conn.execute("SELECT COALESCE(SUM(deployed), 0) AS n FROM chunk_deployments")
    row = await cur.fetchone()
    total_reps = int(row["n"]) if row is not None else 0

    cur = await conn.execute(
        "SELECT COUNT(*) AS n FROM scenario_srs WHERE due_at IS NOT NULL AND due_at <= ?",
        (now_madrid.isoformat(),),
    )
    row = await cur.fetchone()
    due_today_count = int(row["n"]) if row is not None else 0

    return StreakOut(
        current_streak=streak,
        last_session_date=last_day.isoformat() if last_day is not None else None,
        sessions_this_week=sessions_this_week,
        weekly_grid=weekly_grid,
        total_reps=total_reps,
        due_today_count=due_today_count,
    )
