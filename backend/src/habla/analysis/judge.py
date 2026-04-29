"""LLM-as-judge: score a session's transcript against its scenario chunks.

One Anthropic Sonnet call per session via tool-use structured output.
Idempotent: re-running on the same session_id overwrites prior verdicts via
the `chunk_deployments` PRIMARY KEY (session_id, chunk_id).

The judge prompt artefact lives at `docs/prompts/judge-system.md` and is read
fresh on every call so iteration is edit-then-restart with no rebuild.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, cast

from anthropic import APIError, AsyncAnthropic
from anthropic.types import ToolParam, ToolUseBlock

from habla.config import settings
from habla.db.schema import SessionStatus
from habla.routes.scenarios import ScenarioOut, load_scenario
from habla.util import iso_now, load_prompt_body

if TYPE_CHECKING:
    import aiosqlite

log = logging.getLogger(__name__)

JUDGE_MODEL = "claude-sonnet-4-6"
JUDGE_MAX_TOKENS = 2048
EVIDENCE_MAX_LEN = 500

_PROMPT_PATH = Path(__file__).resolve().parents[3].parent / "docs" / "prompts" / "judge-system.md"


SUBMIT_TOOL: ToolParam = {
    "name": "submit_judgement",
    "description": (
        "Submit a verdict for each scenario chunk: whether the student deployed it "
        "in their own speech and, if so, the verbatim transcript span that proves it."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "chunk_id": {"type": "integer"},
                        "deployed": {"type": "boolean"},
                        "evidence": {
                            "type": "string",
                            "description": (
                                "Verbatim student-turn span proving deployment "
                                "(<=120 chars). Empty string when deployed=false."
                            ),
                        },
                    },
                    "required": ["chunk_id", "deployed", "evidence"],
                },
            },
        },
        "required": ["verdicts"],
    },
}


class JudgeError(Exception):
    """Transient failure: Anthropic API error, malformed structured output, or
    unexpected DB state. The worker retries up to MAX_RETRIES."""


async def judge_session(conn: aiosqlite.Connection, session_id: int) -> None:
    """Score a single session and persist verdicts.

    On success: writes one chunk_deployments row per scenario chunk and sets
    sessions.analysis_status='judged' + last_judged_at.
    On failure: raises JudgeError (caller bumps retry_count).
    """
    cur = await conn.execute(
        "SELECT scenario_id, transcript FROM sessions WHERE id = ?", (session_id,)
    )
    row = await cur.fetchone()
    if row is None:
        raise JudgeError(f"session {session_id} not found")

    scenario = await load_scenario(conn, row["scenario_id"])
    transcript = json.loads(row["transcript"]) if row["transcript"] else []

    has_user_turn = any(
        t.get("role") == "user" and (t.get("text") or "").strip() for t in transcript
    )
    if not has_user_turn:
        verdicts = [
            {"chunk_id": c.id, "deployed": False, "evidence": None} for c in scenario.chunks
        ]
    else:
        raw_verdicts = await _call_anthropic(scenario, transcript)
        verdicts = _validate_verdicts(raw_verdicts, scenario)

    await _persist(conn, session_id, verdicts)


async def _call_anthropic(scenario: ScenarioOut, transcript: list[dict]) -> list[dict]:
    if not settings.anthropic_api_key:
        raise JudgeError("ANTHROPIC_API_KEY not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    system_prompt = load_prompt_body(_PROMPT_PATH)

    user_payload = {
        "scenario": {
            "name": scenario.name,
            "chunks": [
                {"id": c.id, "text_es": c.text_es, "gloss_es": c.gloss_es} for c in scenario.chunks
            ],
        },
        "transcript": transcript,
    }

    try:
        resp = await client.messages.create(
            model=JUDGE_MODEL,
            max_tokens=JUDGE_MAX_TOKENS,
            system=system_prompt,
            tools=[SUBMIT_TOOL],
            tool_choice={"type": "tool", "name": "submit_judgement"},
            messages=[{"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}],
        )
    except APIError as e:
        raise JudgeError(f"anthropic api error: {e}") from e

    for block in resp.content:
        if isinstance(block, ToolUseBlock) and block.name == "submit_judgement":
            verdicts = block.input.get("verdicts", []) if block.input else []
            return cast(list[dict], verdicts)
    raise JudgeError("no submit_judgement tool_use block in response")


def _validate_verdicts(verdicts: list[dict], scenario: ScenarioOut) -> list[dict]:
    by_id = {c.id: c for c in scenario.chunks}
    seen: set[int] = set()
    cleaned: list[dict] = []
    for v in verdicts:
        cid = v.get("chunk_id")
        if not isinstance(cid, int) or cid not in by_id or cid in seen:
            log.warning("dropping invalid/duplicate verdict for chunk_id=%r", cid)
            continue
        seen.add(cid)
        evidence_raw = (v.get("evidence") or "").strip()
        evidence = evidence_raw[:EVIDENCE_MAX_LEN] if evidence_raw else None
        cleaned.append(
            {"chunk_id": cid, "deployed": bool(v.get("deployed", False)), "evidence": evidence}
        )
    for cid in by_id:
        if cid not in seen:
            log.warning("model omitted chunk_id=%d, defaulting to deployed=False", cid)
            cleaned.append({"chunk_id": cid, "deployed": False, "evidence": None})
    return cleaned


async def _persist(conn: aiosqlite.Connection, session_id: int, verdicts: list[dict]) -> None:
    for v in verdicts:
        await conn.execute(
            "INSERT OR REPLACE INTO chunk_deployments (session_id, chunk_id, deployed, evidence) "
            "VALUES (?, ?, ?, ?)",
            (session_id, v["chunk_id"], 1 if v["deployed"] else 0, v["evidence"]),
        )
    await conn.execute(
        "UPDATE sessions SET analysis_status = ?, last_judged_at = ? WHERE id = ?",
        (SessionStatus.JUDGED, iso_now(), session_id),
    )
    await conn.commit()
