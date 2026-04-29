"""Contract tests for GET /api/sessions/{id} and the deployment counts on the
list endpoint.
"""

from __future__ import annotations

import json

import aiosqlite

from habla.db.schema import SessionStatus
from habla.routes.sessions import router as sessions_router
from tests.conftest import build_test_app


async def _seed_scenario_with_chunks(
    conn: aiosqlite.Connection, n_chunks: int
) -> tuple[int, list[int]]:
    cur = await conn.execute(
        "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)", ("bar", "Bar", "☕")
    )
    sid = cur.lastrowid
    assert sid is not None
    chunk_ids: list[int] = []
    for i in range(n_chunks):
        cur = await conn.execute("INSERT INTO chunks (text_es) VALUES (?)", (f"frase {i}",))
        cid = cur.lastrowid
        assert cid is not None
        chunk_ids.append(cid)
        await conn.execute(
            "INSERT INTO scenario_chunks (scenario_id, chunk_id, position) VALUES (?, ?, ?)",
            (sid, cid, i),
        )
    await conn.commit()
    return sid, chunk_ids


async def _seed_session(
    conn: aiosqlite.Connection,
    scenario_id: int,
    *,
    transcript: str | None = None,
    status: str = SessionStatus.JUDGED,
) -> int:
    cur = await conn.execute(
        "INSERT INTO sessions (scenario_id, started_at, ended_at, duration_sec, "
        "                      self_assessment, transcript, analysis_status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            scenario_id,
            "2026-04-28T10:00:00+00:00",
            "2026-04-28T10:05:00+00:00",
            300,
            2,
            transcript,
            status,
        ),
    )
    await conn.commit()
    sid = cur.lastrowid
    assert sid is not None
    return sid


async def test_get_session_returns_detail_shape() -> None:
    async with build_test_app(sessions_router) as (app, client):
        conn: aiosqlite.Connection = app.state.db
        scenario_id, chunk_ids = await _seed_scenario_with_chunks(conn, 3)
        transcript = json.dumps(
            [{"role": "user", "text": "hola", "started_at": "x", "ended_at": "y"}]
        )
        session_id = await _seed_session(conn, scenario_id, transcript=transcript)
        for cid, dep, ev in [
            (chunk_ids[0], 1, "hola"),
            (chunk_ids[1], 1, "buenas"),
            (chunk_ids[2], 0, None),
        ]:
            await conn.execute(
                "INSERT INTO chunk_deployments (session_id, chunk_id, deployed, evidence) "
                "VALUES (?, ?, ?, ?)",
                (session_id, cid, dep, ev),
            )
        await conn.commit()

        resp = await client.get(f"/api/sessions/{session_id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == session_id
    assert body["scenario_id"] == scenario_id
    assert body["analysis_status"] == SessionStatus.JUDGED
    assert isinstance(body["transcript"], list)
    assert len(body["transcript"]) == 1
    assert body["transcript"][0]["text"] == "hola"
    assert len(body["deployments"]) == 3
    deployed_map = {d["chunk_id"]: d for d in body["deployments"]}
    assert deployed_map[chunk_ids[0]]["deployed"] is True
    assert deployed_map[chunk_ids[0]]["evidence"] == "hola"
    assert deployed_map[chunk_ids[2]]["deployed"] is False
    assert deployed_map[chunk_ids[2]]["evidence"] is None


async def test_get_session_404_on_missing() -> None:
    async with build_test_app(sessions_router) as (_app, client):
        resp = await client.get("/api/sessions/9999")
    assert resp.status_code == 404


async def test_list_sessions_includes_deployment_counts() -> None:
    async with build_test_app(sessions_router) as (app, client):
        conn: aiosqlite.Connection = app.state.db
        scenario_id, chunk_ids = await _seed_scenario_with_chunks(conn, 4)
        s1 = await _seed_session(conn, scenario_id, transcript="[]")
        s2 = await _seed_session(conn, scenario_id, transcript="[]")
        for cid in chunk_ids[:2]:
            await conn.execute(
                "INSERT INTO chunk_deployments (session_id, chunk_id, deployed) VALUES (?, ?, 1)",
                (s1, cid),
            )
        await conn.commit()

        resp = await client.get("/api/sessions")

    assert resp.status_code == 200
    body = resp.json()
    by_id = {item["id"]: item for item in body}
    assert by_id[s1]["deployed_count"] == 2
    assert by_id[s1]["chunk_count"] == 4
    assert by_id[s2]["deployed_count"] is None
    assert by_id[s2]["chunk_count"] == 4
