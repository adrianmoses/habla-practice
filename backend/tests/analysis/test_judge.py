"""Golden-transcript tests for the LLM-as-judge.

`AsyncAnthropic` is patched so tests are deterministic and offline. The fixture
transcript at `fixtures/bar_transcript.json` is a 10-turn role-play with the
student deploying 4 of the 6 target chunks; the mocked verdicts mirror that.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import aiosqlite
import pytest
from anthropic import APIError

from habla.analysis.judge import JudgeError, judge_session
from habla.db.schema import SessionStatus

FIXTURE_DIR = Path(__file__).parent / "fixtures"


async def _seed_scenario(conn: aiosqlite.Connection) -> tuple[int, list[int]]:
    payload = json.loads((FIXTURE_DIR / "bar_scenario.json").read_text())
    cur = await conn.execute(
        "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)",
        (payload["slug"], payload["name"], payload["icon"]),
    )
    scenario_id = cur.lastrowid
    assert scenario_id is not None
    chunk_ids: list[int] = []
    for pos, c in enumerate(payload["chunks"]):
        cur = await conn.execute(
            "INSERT INTO chunks (text_es, gloss_es, tags) VALUES (?, ?, ?)",
            (c["text_es"], c.get("gloss_es"), c.get("tags")),
        )
        cid = cur.lastrowid
        assert cid is not None
        chunk_ids.append(cid)
        await conn.execute(
            "INSERT INTO scenario_chunks (scenario_id, chunk_id, position) VALUES (?, ?, ?)",
            (scenario_id, cid, pos),
        )
    await conn.commit()
    return scenario_id, chunk_ids


async def _seed_session(
    conn: aiosqlite.Connection, scenario_id: int, transcript: str = "[]"
) -> int:
    cur = await conn.execute(
        "INSERT INTO sessions "
        "(scenario_id, started_at, ended_at, duration_sec, self_assessment, "
        " transcript, analysis_status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            scenario_id,
            "2026-04-28T10:00:00+00:00",
            "2026-04-28T10:05:00+00:00",
            300,
            2,
            transcript,
            SessionStatus.PENDING,
        ),
    )
    await conn.commit()
    sid = cur.lastrowid
    assert sid is not None
    return sid


def _fake_message(verdicts: list[dict]) -> Any:
    """Build a fake Anthropic Message-shaped object with one tool_use block."""
    block = SimpleNamespace(
        type="tool_use", name="submit_judgement", input={"verdicts": verdicts}
    )
    return SimpleNamespace(content=[block])


def _patch_anthropic(
    return_value: Any | None = None,
    side_effect: Callable[..., Awaitable[Any]] | Exception | None = None,
):
    create = AsyncMock()
    if side_effect is not None:
        create.side_effect = side_effect
    else:
        create.return_value = return_value
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    return patch(
        "habla.analysis.judge.AsyncAnthropic", return_value=fake_client
    ), create


def _patch_settings_key():
    return patch("habla.analysis.judge.settings.anthropic_api_key", "test-key")


# ---- happy path --------------------------------------------------------------------


async def test_judge_happy_path(db: aiosqlite.Connection) -> None:
    scenario_id, chunk_ids = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    verdicts = [
        {"chunk_id": chunk_ids[0], "deployed": True, "evidence": "Ponme un cortado"},
        {"chunk_id": chunk_ids[1], "deployed": True, "evidence": "¿Qué me recomiendas"},
        {"chunk_id": chunk_ids[2], "deployed": True, "evidence": "¿Me cobras, por favor?"},
        {"chunk_id": chunk_ids[3], "deployed": False, "evidence": ""},
        {"chunk_id": chunk_ids[4], "deployed": True, "evidence": "qué frío hace"},
        {"chunk_id": chunk_ids[5], "deployed": False, "evidence": ""},
    ]
    patcher, create = _patch_anthropic(return_value=_fake_message(verdicts))
    with _patch_settings_key(), patcher:
        await judge_session(db, session_id)

    create.assert_called_once()

    cur = await db.execute(
        "SELECT chunk_id, deployed, evidence FROM chunk_deployments "
        "WHERE session_id = ? ORDER BY chunk_id",
        (session_id,),
    )
    rows = await cur.fetchall()
    assert len(rows) == 6
    deployed = {r["chunk_id"]: r["deployed"] for r in rows}
    assert sum(deployed.values()) == 4
    evidence = {r["chunk_id"]: r["evidence"] for r in rows}
    assert evidence[chunk_ids[0]] == "Ponme un cortado"
    assert evidence[chunk_ids[3]] is None

    cur = await db.execute(
        "SELECT analysis_status, last_judged_at FROM sessions WHERE id = ?", (session_id,)
    )
    srow = await cur.fetchone()
    assert srow is not None
    assert srow["analysis_status"] == SessionStatus.JUDGED
    assert srow["last_judged_at"] is not None


# ---- empty transcript shortcut -----------------------------------------------------


async def test_judge_empty_transcript_skips_api(db: aiosqlite.Connection) -> None:
    scenario_id, chunk_ids = await _seed_scenario(db)
    session_id = await _seed_session(db, scenario_id, "[]")

    patcher, create = _patch_anthropic(return_value=_fake_message([]))
    with _patch_settings_key(), patcher:
        await judge_session(db, session_id)

    create.assert_not_called()
    cur = await db.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(deployed), 0) AS d "
        "FROM chunk_deployments WHERE session_id = ?",
        (session_id,),
    )
    row = await cur.fetchone()
    assert row is not None
    assert row["c"] == len(chunk_ids)
    assert row["d"] == 0


async def test_judge_only_agent_turns_skips_api(db: aiosqlite.Connection) -> None:
    transcript = json.dumps(
        [{"role": "agent", "text": "Hola, ¿qué te pongo?", "started_at": "x", "ended_at": "y"}]
    )
    scenario_id, chunk_ids = await _seed_scenario(db)
    session_id = await _seed_session(db, scenario_id, transcript)

    patcher, create = _patch_anthropic(return_value=_fake_message([]))
    with _patch_settings_key(), patcher:
        await judge_session(db, session_id)

    create.assert_not_called()
    cur = await db.execute(
        "SELECT COUNT(*) AS c FROM chunk_deployments WHERE session_id = ?", (session_id,)
    )
    row = await cur.fetchone()
    assert row is not None
    assert row["c"] == len(chunk_ids)


# ---- defensive validator -----------------------------------------------------------


async def test_judge_drops_unknown_chunk_id(db: aiosqlite.Connection) -> None:
    scenario_id, chunk_ids = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    verdicts = [{"chunk_id": cid, "deployed": False, "evidence": ""} for cid in chunk_ids]
    verdicts.append({"chunk_id": 9999, "deployed": True, "evidence": "ghost"})

    patcher, _ = _patch_anthropic(return_value=_fake_message(verdicts))
    with _patch_settings_key(), patcher:
        await judge_session(db, session_id)

    cur = await db.execute(
        "SELECT COUNT(*) AS c FROM chunk_deployments WHERE session_id = ?", (session_id,)
    )
    row = await cur.fetchone()
    assert row is not None
    assert row["c"] == len(chunk_ids)


async def test_judge_fills_missing_chunk_id(db: aiosqlite.Connection) -> None:
    scenario_id, chunk_ids = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    verdicts = [
        {"chunk_id": chunk_ids[0], "deployed": True, "evidence": "Ponme un cortado"},
        {"chunk_id": chunk_ids[1], "deployed": True, "evidence": "recomiendas"},
        {"chunk_id": chunk_ids[2], "deployed": False, "evidence": ""},
    ]
    patcher, _ = _patch_anthropic(return_value=_fake_message(verdicts))
    with _patch_settings_key(), patcher:
        await judge_session(db, session_id)

    cur = await db.execute(
        "SELECT chunk_id, deployed FROM chunk_deployments WHERE session_id = ? "
        "ORDER BY chunk_id",
        (session_id,),
    )
    rows = await cur.fetchall()
    assert len(rows) == len(chunk_ids)
    deployed = {r["chunk_id"]: r["deployed"] for r in rows}
    for cid in chunk_ids[3:]:
        assert deployed[cid] == 0


# ---- idempotency -------------------------------------------------------------------


async def test_judge_idempotent_on_rerun(db: aiosqlite.Connection) -> None:
    scenario_id, chunk_ids = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    first = [{"chunk_id": cid, "deployed": True, "evidence": "x"} for cid in chunk_ids]
    second = [{"chunk_id": cid, "deployed": False, "evidence": ""} for cid in chunk_ids]

    patcher_a, _ = _patch_anthropic(return_value=_fake_message(first))
    with _patch_settings_key(), patcher_a:
        await judge_session(db, session_id)
    patcher_b, _ = _patch_anthropic(return_value=_fake_message(second))
    with _patch_settings_key(), patcher_b:
        await judge_session(db, session_id)

    cur = await db.execute(
        "SELECT COUNT(*) AS c, COALESCE(SUM(deployed), 0) AS d "
        "FROM chunk_deployments WHERE session_id = ?",
        (session_id,),
    )
    row = await cur.fetchone()
    assert row is not None
    assert row["c"] == len(chunk_ids)
    assert row["d"] == 0


# ---- failure path ------------------------------------------------------------------


async def test_judge_api_error_raises_judge_error(db: aiosqlite.Connection) -> None:
    scenario_id, _ = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    api_err = APIError("boom", request=None, body=None)  # type: ignore[arg-type]
    patcher, _ = _patch_anthropic(side_effect=api_err)
    with _patch_settings_key(), patcher, pytest.raises(JudgeError):
        await judge_session(db, session_id)

    cur = await db.execute(
        "SELECT COUNT(*) AS c FROM chunk_deployments WHERE session_id = ?", (session_id,)
    )
    row = await cur.fetchone()
    assert row is not None
    assert row["c"] == 0
    cur = await db.execute("SELECT analysis_status FROM sessions WHERE id = ?", (session_id,))
    srow = await cur.fetchone()
    assert srow is not None
    assert srow["analysis_status"] == SessionStatus.PENDING


async def test_judge_missing_tool_use_raises(db: aiosqlite.Connection) -> None:
    scenario_id, _ = await _seed_scenario(db)
    transcript_text = (FIXTURE_DIR / "bar_transcript.json").read_text()
    session_id = await _seed_session(db, scenario_id, transcript_text)

    resp = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="hello", name=None, input=None)]
    )
    patcher, _ = _patch_anthropic(return_value=resp)
    with _patch_settings_key(), patcher, pytest.raises(JudgeError):
        await judge_session(db, session_id)
