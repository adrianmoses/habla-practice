"""Streak derivation + endpoint contract tests.

`compute_streak` is a pure function over a set of dates; exercise the edge
cases there. The endpoint test spins up a minimal FastAPI app with an
in-memory aiosqlite DB, seeds a handful of rows, and asserts the response
shape. It does NOT go through the full `habla.main` lifespan — pipecat imports
aren't needed and loading them would slow every test run.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta

import aiosqlite
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from habla.db.schema import SessionStatus, create_all
from habla.routes.streak import MADRID_TZ, compute_streak
from habla.routes.streak import router as streak_router

# ---------- compute_streak unit tests ------------------------------------------------


TODAY = date(2026, 4, 20)  # a known Monday for deterministic weekday math


def test_compute_streak_empty() -> None:
    assert compute_streak(set(), TODAY) == (0, None)


def test_compute_streak_single_today() -> None:
    assert compute_streak({TODAY}, TODAY) == (1, TODAY)


def test_compute_streak_single_yesterday() -> None:
    y = TODAY - timedelta(days=1)
    assert compute_streak({y}, TODAY) == (1, y)


def test_compute_streak_single_day_before_yesterday_is_broken() -> None:
    dby = TODAY - timedelta(days=2)
    streak, last = compute_streak({dby}, TODAY)
    assert streak == 0
    assert last == dby


def test_compute_streak_three_consecutive_ending_today() -> None:
    days = {TODAY - timedelta(days=i) for i in range(3)}
    assert compute_streak(days, TODAY) == (3, TODAY)


def test_compute_streak_three_consecutive_ending_yesterday() -> None:
    y = TODAY - timedelta(days=1)
    days = {y - timedelta(days=i) for i in range(3)}
    assert compute_streak(days, TODAY) == (3, y)


def test_compute_streak_ten_day_run_ending_two_days_ago_is_broken() -> None:
    end = TODAY - timedelta(days=2)
    days = {end - timedelta(days=i) for i in range(10)}
    streak, last = compute_streak(days, TODAY)
    assert streak == 0
    assert last == end


def test_compute_streak_most_recent_run_wins() -> None:
    # 5-day run with a 2-day gap, then 3 consecutive ending today.
    old_run = {TODAY - timedelta(days=i) for i in range(6, 11)}
    recent_run = {TODAY - timedelta(days=i) for i in range(3)}
    days = old_run | recent_run
    assert compute_streak(days, TODAY) == (3, TODAY)


def test_compute_streak_same_day_dedupes_via_set() -> None:
    # This mirrors what the endpoint does: session_dates is a set, so
    # multiple ended_at on the same day collapse to one.
    y = TODAY - timedelta(days=1)
    assert compute_streak({TODAY, y}, TODAY) == (2, TODAY)


# ---------- endpoint integration test ------------------------------------------------


@asynccontextmanager
async def _test_app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await create_all(conn)
    app.state.db = conn
    try:
        yield
    finally:
        await conn.close()


def _madrid_iso(d: date, hour: int = 12) -> str:
    """Return a UTC ISO string that decodes to `d` in Madrid local time."""
    madrid_dt = datetime(d.year, d.month, d.day, hour, tzinfo=MADRID_TZ)
    return madrid_dt.astimezone(UTC).isoformat()


async def _seed_scenario(conn: aiosqlite.Connection) -> int:
    cur = await conn.execute(
        "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)",
        ("bar", "Bar de barrio", "☕"),
    )
    await conn.commit()
    assert cur.lastrowid is not None
    return cur.lastrowid


async def _seed_session(
    conn: aiosqlite.Connection,
    scenario_id: int,
    ended: date | None,
    *,
    transcript: str = '[{"role":"user","text":"hola"}]',
    status: SessionStatus = SessionStatus.PENDING,
) -> None:
    ended_at = _madrid_iso(ended) if ended is not None else None
    await conn.execute(
        "INSERT INTO sessions (scenario_id, started_at, ended_at, duration_sec, "
        "transcript, analysis_status) VALUES (?, ?, ?, ?, ?, ?)",
        (scenario_id, ended_at or _madrid_iso(TODAY), ended_at, 300, transcript, status),
    )
    await conn.commit()


@pytest.fixture
def today_madrid() -> date:
    return datetime.now(MADRID_TZ).date()


async def test_get_streak_empty_db() -> None:
    app = FastAPI(lifespan=_test_app_lifespan)
    app.include_router(streak_router, prefix="/api")

    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        app.router.lifespan_context(app),
    ):
        resp = await client.get("/api/streak")

    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "current_streak": 0,
        "last_session_date": None,
        "sessions_this_week": 0,
        "weekly_grid": [0, 0, 0, 0, 0, 0, 0],
        "total_reps": 0,
        "due_today_count": 0,
    }


async def test_get_streak_counts_real_sessions(today_madrid: date) -> None:
    """Seed three sessions ending today/yesterday/dby and confirm the shape."""
    app = FastAPI(lifespan=_test_app_lifespan)
    app.include_router(streak_router, prefix="/api")

    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        app.router.lifespan_context(app),
    ):
        conn: aiosqlite.Connection = app.state.db
        scenario_id = await _seed_scenario(conn)
        for offset in (0, 1, 2):
            await _seed_session(conn, scenario_id, today_madrid - timedelta(days=offset))
        # Empty-transcript row must not count toward streak or grid.
        await _seed_session(
            conn, scenario_id, today_madrid, transcript="[]", status=SessionStatus.FAILED
        )
        resp = await client.get("/api/streak")

    assert resp.status_code == 200
    body = resp.json()
    assert body["current_streak"] == 3
    assert body["last_session_date"] == today_madrid.isoformat()
    # 3 real rows fell inside the current week (the empty-transcript row is excluded).
    # Depending on which weekday `today` is, some may spill to the previous week;
    # verify the grid sums to the subset that's in this week.
    assert sum(body["weekly_grid"]) == body["sessions_this_week"]
    assert body["total_reps"] == 0
    assert body["due_today_count"] == 0
