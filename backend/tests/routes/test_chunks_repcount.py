"""rep_count surfacing in /api/chunks via SUM(deployed)."""

from __future__ import annotations

import aiosqlite

from habla.db.schema import SessionStatus
from habla.routes.chunks import router as chunks_router
from tests.conftest import build_test_app


async def _seed_chunk(conn: aiosqlite.Connection, text_es: str) -> int:
    cur = await conn.execute("INSERT INTO chunks (text_es) VALUES (?)", (text_es,))
    cid = cur.lastrowid
    assert cid is not None
    await conn.commit()
    return cid


async def _seed_scenario_and_session(conn: aiosqlite.Connection) -> tuple[int, int]:
    cur = await conn.execute(
        "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)", ("bar", "Bar", "☕")
    )
    scenario_id = cur.lastrowid
    assert scenario_id is not None
    cur = await conn.execute(
        "INSERT INTO sessions (scenario_id, started_at, ended_at, transcript, analysis_status) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            scenario_id,
            "2026-04-28T10:00:00+00:00",
            "2026-04-28T10:05:00+00:00",
            "[]",
            SessionStatus.JUDGED,
        ),
    )
    session_id = cur.lastrowid
    assert session_id is not None
    await conn.commit()
    return scenario_id, session_id


async def test_rep_count_sums_across_sessions() -> None:
    async with build_test_app(chunks_router) as (app, client):
        conn: aiosqlite.Connection = app.state.db
        a = await _seed_chunk(conn, "Ponme un cortado")
        b = await _seed_chunk(conn, "¿Me cobras?")
        c = await _seed_chunk(conn, "qué frío hace")  # never deployed
        _, s1 = await _seed_scenario_and_session(conn)
        _, s2 = await _seed_scenario_and_session(conn)

        # Session 1: a deployed, b deployed.
        # Session 2: a deployed (again), b NOT deployed.
        # Expected rep_count: a=2, b=1, c=0
        for sid, cid, dep in [(s1, a, 1), (s1, b, 1), (s2, a, 1), (s2, b, 0)]:
            await conn.execute(
                "INSERT INTO chunk_deployments (session_id, chunk_id, deployed) VALUES (?, ?, ?)",
                (sid, cid, dep),
            )
        await conn.commit()

        resp = await client.get("/api/chunks")

    assert resp.status_code == 200
    by_id = {row["id"]: row for row in resp.json()}
    assert by_id[a]["rep_count"] == 2
    assert by_id[b]["rep_count"] == 1
    assert by_id[c]["rep_count"] == 0


async def test_rep_count_zero_on_new_chunk() -> None:
    async with build_test_app(chunks_router) as (_app, client):
        resp = await client.post(
            "/api/chunks", json={"text_es": "buenas", "gloss_es": None, "tags": []}
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["rep_count"] == 0
