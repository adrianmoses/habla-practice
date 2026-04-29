---
name: Phase 5 — Async LLM-as-judge & rep counter
description: Bundled spec for ROADMAP features 501–506 — lifespan-managed asyncio worker that picks up pending sessions, calls Anthropic Sonnet to score chunk deployment over the transcript, writes chunk_deployments, surfaces rep counts in /api/chunks, and flips the post-session UI from ⏳ → ✓/✗
type: spec
---

# Spec: Phase 5 — Async LLM-as-judge & rep counter

| Field | Value                                                                                  |
|---|----------------------------------------------------------------------------------------|
| id | phase-5                                                                                |
| status | approved                                                                                  |
| created | 2026-04-28                                                                             |
| roadmap | [ROADMAP.md §Phase 5](../ROADMAP.md#phase-5--llm-as-judge--rep-counter) — features 501–506 |

---

## Why

Phase 3 captures the transcript live and Phase 4 wires the consistency signal — but the *learning* signal is still missing. After every session the post-session screen shows every target chunk as `⏳ pendiente`, and the frases tab shows `0` rep counts on every row, regardless of how many chunks the learner actually deployed. The product's central feedback loop ("did I use the phrases I'm trying to internalise?") doesn't fire yet.

Phase 5 closes that loop. A background worker reads `sessions.transcript` for any session the learner has self-assessed, asks Anthropic Sonnet whether each scenario chunk was deployed (with cited evidence), writes per-chunk verdicts to `chunk_deployments`, and the existing `frases usadas` tile + the new rep counts on the frases tab + the `⏳ → ✓ / ✗` flip on `PostSession` all light up automatically.

This is the first phase that introduces a long-running background coroutine (vs. request-scoped work), the first that exercises Anthropic structured output, and the first to ship pytest fixtures the team will keep reusing — `OVERVIEW.md` already pre-committed to landing the test harness here. The judge prompt (`docs/prompts/judge-system.md`) is a content artefact that will get tuned for months, so getting it under golden-transcript regression coverage from day one is non-negotiable.

Crucially, **SRS is explicitly out of scope** (Phase 6). The terminal status for a successfully judged session in Phase 5 is `analysis_status='judged'`, not `complete`. Phase 6 will add the `judged → complete` transition with the SM-2 step in between, with no frontend or judge changes.

### Consumer Impact

The solo learner, after Phase 5:

- **Sees per-chunk verdicts on the post-session screen.** The `⏳` next to each scenario chunk flips to `✓` (deployed) or `✗` (not deployed) within ~30 s of pressing *guardar sesión*, without leaving the screen. Hovering or tapping the row reveals the transcript span Claude cited as evidence (small caption under the chunk, not a tooltip — touch-friendly).
- **Sees real rep counts on the frases tab.** Each chunk row's circle shows `SUM(deployed)` over its history; the previously-static `0`s start incrementing as sessions finish judging. Sorting by rep count would be a natural next move but isn't in scope.
- **Sees `frases usadas` increase on the home screen.** The Phase 4 stats tile that read `0` until now starts reflecting cumulative deployments without any frontend change — the wiring already exists.
- **Sees per-session deployment ratio in historial.** `X / Y frases desplegadas` appears on each row of the recent-sessions list once judged.
- **Nothing slows down.** Live voice latency is unchanged — judging is offline and never on the critical path. A cold-judge run that takes 30 s, fails, and retries doesn't block a new session.

### Roadmap Fit

- **Depends on Phase 3**: real `sessions.transcript` JSON populated on session end. Phase 3 already writes this on both clean termination (`pending`) and partial WS drop (`failed`). We only judge `pending` rows that have `self_assessment IS NOT NULL` — `failed` sessions are skipped (the transcript may be too thin to score, and the learner never assessed them).
- **Depends on Phase 4** (loosely): the `frases usadas` tile and the historial list already exist as zero-state placeholders. Phase 5's writes flow into them with no frontend coordination.
- **Unblocks Phase 6 (SRS)**: P6 reads `chunk_deployments` to compute the per-session deployment ratio that feeds SM-2 quality. P5 must land the table writes before SRS has anything to score.
- **First test harness in the repo.** `OVERVIEW.md` and the ROADMAP both pre-commit to this. The golden-transcript fixture pattern established here will be reused for SRS unit tests in P6.

---

## What

### Acceptance Criteria

From the consumer's perspective:

- [ ] **Self-assessing a session triggers judging.** After `POST /api/sessions/:id/assess` returns 204, the session row reaches `analysis_status='judged'` (or `failed` after retry exhaustion) within ~30 s under normal Anthropic latency.
- [ ] **Each scenario chunk gets a `chunk_deployments` row per session.** For a session against scenario `S` with `N` chunks, `SELECT COUNT(*) FROM chunk_deployments WHERE session_id = ?` returns exactly `N` after judging completes. Every chunk has a verdict — no nulls, no missing rows.
- [ ] **Verdicts include cited evidence when deployed.** `chunk_deployments.evidence` is a non-empty transcript span (typically the user turn fragment that demonstrates the chunk) when `deployed=1`. May be NULL when `deployed=0`.
- [ ] **PostSession flips ⏳ → ✓ / ✗ in place.** On the post-session screen, after the user submits the self-assessment, each chunk row's status indicator transitions from `⏳` to `✓` (deployed) or `✗` (not deployed) without reloading the page. Polling backs off after the terminal state is reached.
- [ ] **Cited evidence is visible from the post-session row.** Tapping or hovering a deployed chunk reveals the cited evidence span under the row.
- [ ] **`GET /api/chunks` returns real `rep_count` values.** `rep_count` per chunk equals `SUM(deployed)` aggregated over `chunk_deployments`. Re-fetching after a judging completes shows the count incremented for every deployed chunk in the just-judged session.
- [ ] **`GET /api/sessions/:id` exposes deployments + analysis state.** Returns `{id, scenario_id, started_at, ended_at, duration_sec, self_assessment, analysis_status, transcript, deployments: [{chunk_id, deployed, evidence}]}`. Used by the frontend poll on `PostSession`.
- [ ] **`GET /api/sessions` (list) reflects per-session deployment ratios.** Each item gains `{deployed_count, chunk_count}` (or `null/null` for not-yet-judged rows). Historial renders `X / Y frases` per row.
- [ ] **Worker is restart-durable.** On app boot, any session sitting at `analysis_status='pending'` with `self_assessment IS NOT NULL` is automatically picked back up. Killing the process mid-judge and restarting it re-judges the row from scratch (idempotent re-run by deleting any existing `chunk_deployments` rows for that session before writing the new set).
- [ ] **Worker tolerates and bounds Anthropic failures.** A transient API error (timeout, 5xx, malformed structured output) bumps `sessions.retry_count`, sleeps a backoff, and re-attempts. After 3 failed attempts the row is set to `analysis_status='failed'` and the worker moves on. Failure does not crash the app.
- [ ] **Worker doesn't block live sessions.** Pipecat WS handler latency budget (Phase 3) is unchanged. The worker holds no DB write transaction during the Anthropic call (it opens a write txn only when persisting verdicts).
- [ ] **Empty / single-turn transcript handled gracefully.** A session whose transcript has zero user turns is judged as "no chunks deployed" (all `deployed=0`, no Anthropic call needed) and reaches `judged` state.
- [ ] **`docs/prompts/judge-system.md` exists and is loaded by `analysis/judge.py`.** Edit-then-restart picks up the new prompt; no rebuild required.
- [ ] **Pytest harness lands.** `cd backend && uv run pytest` passes, including: golden-transcript judge tests (Anthropic SDK mocked), queue-worker smoke test (insert pending row, run one tick, assert transitions), and the new endpoint contract tests.
- [ ] **All gates pass.** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `cd backend && uv run pytest`, and `docker build .`.

### Non-Goals

- **No SRS.** The SM-2 update is Phase 6. P5 stops at `analysis_status='judged'`; P6 adds the `judged → complete` transition. `scenario_srs` rows are not touched.
- **No `analysis_status='complete'` writes from this phase.** That state is reserved for "judged + SRS-applied" and is wired in Phase 6.
- **No real-time streak / dashboard impact.** P4 streaks already include any session with a real transcript; rep-count tile (`frases usadas`) updates passively as deployments accumulate, with no special signalling.
- **No SSE / WebSocket push of judging completion.** `PostSession` polls `GET /api/sessions/:id` every ~3 s until the status is terminal. SSE is a follow-up if the polling becomes objectionable; it isn't here (single user, polling stops within ~30 s).
- **No mid-session feedback.** Judging stays post-session per `OVERVIEW.md`'s "no real-time chunk detection" non-goal. The agent must remain low-latency and the live UI undecorated.
- **No re-judging of historical sessions.** This phase only judges sessions that newly transition to `pending` + assessed. Re-judging a previously-`judged` row when the prompt changes is a future tool (likely a CLI script under `backend/scripts/`).
- **No queue UI / worker-status surfacing.** The learner doesn't see "1 session pending judgement". The pending → judged transition is implicit. Logging covers ops visibility.
- **No Anthropic spend caps in code.** Per `ARCHITECTURE.md` cost-shape note. Single user × ≤5 sessions/day × one Sonnet call each is bounded enough to defer.
- **No prompt-caching on the judge call.** The judge prompt is short and varies per session (transcript JSON in the user turn), so caching wins are minimal. Revisit if multi-session re-judging is added.
- **No tracking of "near miss" partial credit.** A chunk is binary `deployed=0|1`. The judge prompt can describe what counts as "close enough" (paraphrase, conjugation variant, register match), but the verdict surfaced to the learner is binary. Numeric quality (for SM-2) is computed from the deployment ratio, not per-chunk fractional credit.
- **No multi-judge consensus / self-consistency sampling.** One Sonnet call per session. If the prompt proves noisy in practice, that's a v2 concern.
- **No frontend tests.** Vitest still deferred per `OVERVIEW.md`. PostSession's status flip is verified manually and via the endpoint shape under pytest.
- **No new env vars.** `ANTHROPIC_API_KEY` already required.

### Open Questions

- **How fast should `PostSession` poll?** Default: every 3 s, with a hard ceiling of 60 s (after which the UI shows "el análisis está tardando — puedes salir, lo verás en historial cuando termine" and stops polling). 3 s is a sweet spot — fast enough that a typical 5–15 s judge run feels near-instant; slow enough that wall-clock GET load is trivial. Tunable via a `POLL_INTERVAL_MS` constant in `PostSession.jsx`.
- **What model exactly?** `claude-sonnet-4-6` (the latest Sonnet at the time of writing). Sonnet over Opus because it's the cheapest model that gives reliable structured output on this task; Opus would be ~5× the cost for negligible accuracy gain on a binary classification per chunk. Fall back to a hardcoded model id, not `claude-sonnet-latest`-style aliases — pinned model gives deterministic prompt regression behaviour.
- **What's the structured-output mechanism?** Anthropic tool-use with a single `submit_judgement` tool whose input schema is the verdict array. Forces JSON correctness via the SDK's `tool_choice={"type": "tool", "name": "submit_judgement"}` so we don't have to parse free-form JSON. Schema:
  ```json
  {
    "type": "object",
    "properties": {
      "verdicts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "chunk_id": {"type": "integer"},
            "deployed": {"type": "boolean"},
            "evidence": {"type": "string", "description": "transcript span if deployed; empty string if not"}
          },
          "required": ["chunk_id", "deployed", "evidence"]
        }
      }
    },
    "required": ["verdicts"]
  }
  ```
  An empty string is preferred over null in the schema so the SDK's structured-output validator stays simple; the route layer maps `""` → `None` before writing.
- **What if Claude returns a verdict for a chunk that isn't in the scenario, or skips a chunk?** Defensive validation in the route layer:
  - Build a lookup `{chunk_id: chunk}` from the scenario.
  - Drop any verdict whose `chunk_id` isn't in the lookup (log a warning).
  - For any scenario chunk missing from the response, insert `{deployed: 0, evidence: NULL}` as a safe default rather than failing the whole judge.
  - This keeps "every chunk gets a row" as a strict invariant regardless of model misbehaviour.
- **Worker: pure poll, or poll + nudge?** Default: **poll + nudge.** A module-level `asyncio.Event` (`analysis_pending_event`) wakes the worker; the assess route sets it after `UPDATE sessions SET self_assessment = ?`. Worker awaits the event with a 30 s timeout — if the timeout fires, it does an unconditional sweep (durability against missed nudges across restarts or in-process bugs). Pure poll-every-2s would also work; the nudge buys ~2 s perceived latency with ~10 LOC overhead.
- **Should `failed` overload session-level and judge-level failures?** Yes, with an audit trail. The `SessionStatus` enum already has `FAILED` (used by Phase 3 for WS drops). Phase 5 reuses it for "exhausted judge retries" — distinguishable in the DB by `(transcript IS NOT NULL AND retry_count >= 3)`. Add a `last_error` text column? **No** — keep schema unchanged this phase; rely on `retry_count` + structured logs for ops. If we later want a UI surface for "failed to judge", revisit.
- **Idempotency on retry: how do we avoid duplicate `chunk_deployments` rows?** `chunk_deployments` PRIMARY KEY is `(session_id, chunk_id)`. Persistence path uses `INSERT OR REPLACE INTO chunk_deployments (...)`. Retries cleanly overwrite. No explicit `DELETE` step needed.
- **Concurrency: can two workers run?** No — there is exactly one worker per app process, and the app is a single Fly machine. The worker processes serially (one session at a time); Anthropic spends are tiny so there's no throughput pressure that would justify a worker pool. If two FastAPI processes ever coexist, both would race on the same `pending` rows; we'd need `SELECT ... FOR UPDATE`-equivalent (SQLite has no row locks — would need an `UPDATE ... WHERE analysis_status='pending' RETURNING id` claim). Out of scope.
- **`GET /api/sessions/:id` shape — flat or nested?** Flat top-level fields plus a `deployments: [...]` nested list. Mirrors the shape of `GET /api/scenarios` (flat fields plus `chunks: [...]`). Frontend `PostSession.jsx` zips this against `scenario.chunks` to render rows.
- **Should we surface the *cited evidence* as a transcript-aligned highlight?** Phase 5 surfaces it as plain text under the chunk row. Aligning it to the transcript view (a future "transcript drawer") is interesting but not in scope. The judge prompt instructs Claude to copy the user-turn span verbatim, so a future align step has something stable to work from.
- **Should we let the learner override a verdict?** No. Single source of truth = the judge. Override would mean introducing an "edited" state and complicating SRS quality computation. If verdicts feel wrong in practice, that's a prompt problem, not a UI problem.
- **What if `self_assessment` is never submitted (learner closes the tab on PostSession)?** The session sits at `analysis_status='pending'` indefinitely with `self_assessment IS NULL`, and the worker skips it. This is fine — judging is gated on intent (the learner pressed "guardar"). A garbage-collection sweep for orphaned `pending` sessions older than a few days is a nice-to-have but not in scope.

---

## How

### Approach

Phase 5 is four slices: **(A) backend `analysis/` module + worker**, **(B) judge prompt + Anthropic call**, **(C) endpoint surface (`GET /api/sessions/:id`, list deployment counts, chunks `rep_count`)**, **(D) frontend polling on `PostSession`**. Plus the test harness expansion.

#### Slice A — Worker, lifespan, durability

**`backend/src/habla/analysis/queue.py`** — new.

```python
import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import aiosqlite

log = logging.getLogger(__name__)

# Module-level event so the assess route can nudge the worker without
# importing the worker task itself. Set every time a session reaches
# `analysis_status='pending' AND self_assessment IS NOT NULL`.
analysis_pending_event = asyncio.Event()

POLL_TIMEOUT_SEC = 30      # idle sweep cadence (durability fallback)
RETRY_BACKOFF_SEC = 5      # short — Anthropic transient errors clear fast
MAX_RETRIES = 3


async def run_worker(conn: "aiosqlite.Connection") -> None:
    """Lifespan-managed worker.

    Loop:
      1. Wait on analysis_pending_event with POLL_TIMEOUT_SEC fallback.
      2. Drain: SELECT next pending+assessed session ordered by ended_at.
      3. Process via judge.judge_session(...). On failure, bump retry_count
         and either re-queue or mark failed. On success, set analysis_status='judged'.
      4. Loop until no more rows; clear event; back to (1).
    """
    log.info("analysis worker started")
    while True:
        try:
            await asyncio.wait_for(analysis_pending_event.wait(), timeout=POLL_TIMEOUT_SEC)
        except TimeoutError:
            pass  # idle sweep
        analysis_pending_event.clear()

        while True:
            session_id = await _claim_next(conn)
            if session_id is None:
                break
            await _process_one(conn, session_id)


async def _claim_next(conn: "aiosqlite.Connection") -> int | None:
    """Return the next session id needing judgement, or None if none.

    Single-process app, no row-level locks; this is a plain SELECT. If we
    ever run multiple processes, replace with an UPDATE ... RETURNING claim.
    """
    cur = await conn.execute(
        "SELECT id FROM sessions "
        "WHERE analysis_status = 'pending' "
        "  AND self_assessment IS NOT NULL "
        "  AND retry_count < ? "
        "ORDER BY ended_at "
        "LIMIT 1",
        (MAX_RETRIES,),
    )
    row = await cur.fetchone()
    return row["id"] if row else None


async def _process_one(conn: "aiosqlite.Connection", session_id: int) -> None:
    from habla.analysis.judge import judge_session, JudgeError

    try:
        await judge_session(conn, session_id)
        # success path: judge_session sets analysis_status='judged' itself.
    except JudgeError as e:
        # bump retry_count; mark failed if exhausted
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
                "UPDATE sessions SET analysis_status = 'failed' WHERE id = ?", (session_id,)
            )
            await conn.commit()
        else:
            await asyncio.sleep(RETRY_BACKOFF_SEC * retries)  # linear backoff
```

**Lifespan wiring in `main.py`:**

```python
async def lifespan(app):
    # ... existing DB / model loading ...
    worker_task = asyncio.create_task(
        run_worker(app.state.db), name="analysis-worker"
    )
    app.state.analysis_worker = worker_task
    # On boot, nudge the worker to sweep any rows left in `pending` by a prior crash.
    analysis_pending_event.set()
    try:
        yield
    finally:
        worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker_task
        await close_db(conn)
```

**Nudge from the assess route** (`routes/sessions.py`, modify `assess_session`):

```python
@router.post("/sessions/{session_id}/assess", status_code=204)
async def assess_session(...):
    cur = await conn.execute(
        "UPDATE sessions SET self_assessment = ? WHERE id = ?",
        (payload.self_assessment, session_id),
    )
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, ...)
    analysis_pending_event.set()  # nudge the worker
    return Response(status_code=204)
```

#### Slice B — Judge prompt + Anthropic call

**`docs/prompts/judge-system.md`** — new content artefact. Structure:

- Role framing: "You are a Spanish-language teacher reviewing a student's role-play conversation. Your job is to determine whether the student deployed each target phrase from the scenario in their own speech."
- What counts as deployed: same phrase verbatim **or** a recognisable conjugation/agreement variant **or** a paraphrase that preserves the register and pragmatic intent. Use of the chunk only by the agent does not count — the *student* must say it.
- What does not count: passive understanding (the agent said it, the student responded "vale"), translation by the student, English approximations, partial fragments that don't carry the chunk's meaning.
- Output format: structured tool call with one verdict per scenario chunk, citing the user-turn span verbatim when `deployed=true`. Empty `evidence` when `deployed=false`. Evidence must be ≤120 characters of contiguous transcript text.
- Edge cases: empty transcript → all false. Transcript only contains agent turns → all false. Multiple deployments of the same chunk → cite the first.

**`backend/src/habla/analysis/judge.py`** — new.

```python
import json
import logging
from pathlib import Path

import aiosqlite
from anthropic import AsyncAnthropic, APIError

from habla.config import settings
from habla.db.schema import SessionStatus
from habla.routes.scenarios import load_scenario
from habla.util import iso_now

log = logging.getLogger(__name__)

JUDGE_MODEL = "claude-sonnet-4-6"
JUDGE_MAX_TOKENS = 2048

REPO_ROOT = Path(__file__).resolve().parents[3]
JUDGE_PROMPT_PATH = REPO_ROOT / "docs" / "prompts" / "judge-system.md"


class JudgeError(Exception):
    """Raised on transient Anthropic / parsing failures the worker can retry on."""


SUBMIT_TOOL = {
    "name": "submit_judgement",
    "description": "Submit a verdict for each scenario chunk.",
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
                        "evidence": {"type": "string"},
                    },
                    "required": ["chunk_id", "deployed", "evidence"],
                },
            },
        },
        "required": ["verdicts"],
    },
}


async def judge_session(conn: aiosqlite.Connection, session_id: int) -> None:
    """Score a single session and persist verdicts. Sets analysis_status='judged'.

    Idempotent: re-running on the same session_id overwrites prior verdicts.
    """
    cur = await conn.execute(
        "SELECT scenario_id, transcript FROM sessions WHERE id = ?", (session_id,)
    )
    row = await cur.fetchone()
    if row is None:
        raise JudgeError(f"session {session_id} not found")

    scenario = await load_scenario(conn, row["scenario_id"])
    transcript = json.loads(row["transcript"] or "[]")

    # Cheap-path: no user turns → all false, skip the API call.
    has_user_turn = any(t.get("role") == "user" and t.get("text") for t in transcript)
    if not has_user_turn:
        verdicts = [
            {"chunk_id": c.id, "deployed": False, "evidence": ""}
            for c in scenario.chunks
        ]
    else:
        verdicts = await _call_anthropic(scenario, transcript)
        verdicts = _validate_verdicts(verdicts, scenario)

    await _persist(conn, session_id, verdicts)


async def _call_anthropic(scenario, transcript) -> list[dict]:
    if not settings.anthropic_api_key:
        raise JudgeError("ANTHROPIC_API_KEY missing")
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    system_prompt = JUDGE_PROMPT_PATH.read_text(encoding="utf-8")

    user_payload = {
        "scenario": {
            "name": scenario.name,
            "chunks": [
                {"id": c.id, "text_es": c.text_es, "gloss_es": c.gloss_es}
                for c in scenario.chunks
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
        if block.type == "tool_use" and block.name == "submit_judgement":
            return block.input.get("verdicts", [])
    raise JudgeError("no submit_judgement tool_use in response")


def _validate_verdicts(verdicts: list[dict], scenario) -> list[dict]:
    by_id = {c.id: c for c in scenario.chunks}
    seen: set[int] = set()
    cleaned: list[dict] = []
    for v in verdicts:
        cid = v.get("chunk_id")
        if cid not in by_id or cid in seen:
            log.warning("dropping invalid/duplicate verdict for chunk_id=%s", cid)
            continue
        seen.add(cid)
        cleaned.append(
            {
                "chunk_id": cid,
                "deployed": bool(v.get("deployed", False)),
                "evidence": (v.get("evidence") or "").strip()[:500] or None,
            }
        )
    # Fill in any chunks the model skipped.
    for cid in by_id:
        if cid not in seen:
            log.warning("model skipped chunk_id=%d, defaulting to deployed=False", cid)
            cleaned.append({"chunk_id": cid, "deployed": False, "evidence": None})
    return cleaned


async def _persist(conn, session_id, verdicts):
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
```

#### Slice C — Endpoint surface

**`backend/src/habla/routes/sessions.py`** — additions:

1. `GET /api/sessions/{id}` — new route returning session detail + deployments. Used by `PostSession` polling.
2. `GET /api/sessions` — extend response: each row gains `{deployed_count: int|None, chunk_count: int}`. `deployed_count` is `NULL` until the session reaches `judged`/`failed`.

```python
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
    transcript: list[dict]
    deployments: list[DeploymentItem]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: int, conn: DbDep) -> SessionDetail: ...
```

**`backend/src/habla/routes/chunks.py`** — modify `list_chunks` to surface real `rep_count`:

```python
cur = await conn.execute(
    "SELECT c.id, c.text_es, c.gloss_es, c.tags, c.created_at, "
    "       COALESCE(SUM(d.deployed), 0) AS rep_count "
    "FROM chunks c "
    "LEFT JOIN chunk_deployments d ON d.chunk_id = c.id "
    "GROUP BY c.id "
    "ORDER BY c.id"
)
```

`_load_chunk` (used by POST/PUT) similarly switches to a left-join + group-by. New chunks naturally get `rep_count = 0`.

#### Slice D — Frontend polling on PostSession

**`frontend/src/lib/api.js`** — append:

```js
export function getSession(id) {
  return request(`/api/sessions/${id}`);
}
```

**`frontend/src/views/PostSession.jsx`** — after `handleSave` succeeds, start polling `getSession(sessionId)` every 3 s. Each tick:

- If `analysis_status` is `'judged'` (or `'complete'` for forward-compat with P6), stop polling and store the deployments → flip the `⏳` icon to `✓`/`✗` based on the matching `deployments[i].deployed`. Show evidence below the row.
- If `'failed'`, stop polling and show all chunks with a neutral indicator (`—`) plus a small "no se pudo analizar" caption.
- Cap at 60 s wall-clock (~20 polls). After cap, show "el análisis está tardando — lo verás en historial cuando termine" and stop polling. The user can navigate away; future visits to historial will show the result.

State machine:

```
idle → submitted → polling → terminal(judged|failed|timeout)
```

`useEffect` cleanup cancels in-flight polls on unmount.

**`frontend/src/views/Historial.jsx`** — minor extension: render `X / Y frases` when `deployed_count != null`, else continue showing `— frases` placeholder.

#### File layout summary

Net-new + modified:

```
backend/src/habla/
├── main.py                          ← MOD: start/cancel analysis worker in lifespan
├── analysis/
│   ├── __init__.py                  ← MOD: re-export queue / judge
│   ├── queue.py                     ← NEW: worker + analysis_pending_event
│   └── judge.py                     ← NEW: Anthropic call + persistence
└── routes/
    ├── sessions.py                  ← MOD: add GET /api/sessions/{id}, deployment counts
    │                                       in list, nudge event in assess
    └── chunks.py                    ← MOD: real rep_count via SUM(deployed)

backend/tests/
├── analysis/
│   ├── __init__.py                  ← NEW
│   ├── fixtures/
│   │   ├── bar_transcript.json      ← NEW: fixed transcript JSON
│   │   ├── bar_scenario.json        ← NEW: fixed scenario chunks
│   │   └── bar_anthropic_resp.json  ← NEW: recorded Anthropic tool_use response
│   ├── test_judge.py                ← NEW: golden-transcript tests with mocked client
│   └── test_queue.py                ← NEW: worker smoke test (one tick, transitions)
└── routes/
    └── test_sessions_detail.py      ← NEW: GET /api/sessions/{id} contract

docs/prompts/
└── judge-system.md                  ← NEW: judge prompt artefact

frontend/src/
├── lib/
│   └── api.js                       ← MOD: getSession
└── views/
    ├── PostSession.jsx              ← MOD: poll + flip ⏳ → ✓/✗
    └── Historial.jsx                ← MOD: render deployment ratio when present
```

No schema changes (P1 already added every column needed: `analysis_status`, `last_judged_at`, `retry_count`, `chunk_deployments`). No new env vars. No Dockerfile changes. No new top-level dependencies — `anthropic>=0.45` is already pinned.

### Confidence

**Level:** Medium

**Rationale:**

- The mechanics are well-understood (asyncio task in lifespan, Anthropic tool-use SDK, INSERT OR REPLACE for idempotency) and each piece has clear precedent in the repo (Phase 4 endpoint patterns, Phase 3 lifespan model loading, Phase 1 routes/scenarios). Schema is unchanged — every column the worker writes already exists.
- The two genuine unknowns are (1) **judge prompt quality** — there's no way to know if the prompt produces stable verdicts on Madrid-flavoured chunks without running it on real transcripts — and (2) **structured-output reliability** at the SDK level: the tool-choice forces a tool_use block, but the model can still produce verdicts for nonexistent chunks or skip chunks. The defensive validator handles both, but a noisy validator log is the kind of thing that suggests the prompt needs tuning — unknown until first contact with real data.
- The retry / failure-state design choices (3 attempts, linear backoff, reuse of `FAILED` for both WS-drop and judge-exhaustion) are reasonable but might want adjustment after operational experience. Easy to revisit; nothing is locked in by schema.
- The test harness expansion is the largest *amount* of new code by line count, but it's mechanical: pytest-asyncio fixtures around an in-memory DB and a mocked Anthropic client. The pattern is in `tests/routes/test_streak.py` already.

**Validate before proceeding:**

- **Sanity-run the judge prompt on one real transcript before locking the prompt artefact.** Pull a transcript JSON from a Phase 3 session, format it as the user payload, and call Sonnet through the SDK with a draft `judge-system.md`. Eyeball the verdicts vs. an obvious mental ground truth. If 1–2 chunks come back miscategorised, that's expected pre-tuning; if everything is wrong, the prompt structure needs a rethink before implementation continues. This is a 30-minute spike.
- **Confirm Anthropic SDK tool-choice forces a `tool_use` block on the current SDK version.** Quick test: call `messages.create(...)` with `tool_choice={"type": "tool", "name": "..."}` and inspect `resp.content` — should always include a `tool_use` block. If the SDK version behaves differently (older versions sometimes returned `text` blocks alongside), the validator handles it but the prompt may need slight rephrasing.

### Key Decisions

- **Worker is in-process, single-threaded, single-instance.** No Celery, no Redis queue, no cross-process coordination. The single Fly machine + single user assumption holds. If we ever scale out, the claim step changes (UPDATE … RETURNING with a status guard) and nothing else.
- **Nudge + 30 s sweep, not pure poll.** The nudge is a small responsiveness win (~2 s perceived latency vs. ~5 s polling). The 30 s sweep is the durability backstop — survives missed nudges and crash-restart cycles.
- **`analysis_status='judged'` is the terminal state for P5.** P6 will add `judged → complete` via SRS. Frontend treats both `judged` and `complete` as "show the verdicts" so P6 lands without UI changes.
- **Reuse `SessionStatus.FAILED` for judge exhaustion.** Distinguish via `(transcript IS NOT NULL AND retry_count >= 3)` if needed. Schema unchanged; no `last_error` column; rely on logs.
- **Tool-use structured output, pinned model.** `claude-sonnet-4-6` exact id, `tool_choice={"type": "tool", "name": "submit_judgement"}`. Predictable cost + deterministic prompt regression behaviour.
- **Empty-transcript shortcut: skip the API call.** Save ~$0.001 per empty session and ~3 s of latency. Pure win.
- **`INSERT OR REPLACE` for idempotency.** No DELETE-then-INSERT dance. Retries cleanly overwrite verdicts. Composite PK already enforces one row per `(session_id, chunk_id)`.
- **Defensive validator fills missing/invalid verdicts.** Strict invariant: every scenario chunk has exactly one `chunk_deployments` row per session, no exceptions. Model misbehaviour logs but doesn't fail the session.
- **PostSession polls; no SSE.** 3 s interval, 60 s ceiling. SSE is a follow-up if polling proves objectionable. Single-user app, won't.
- **`rep_count` derived live, not materialised.** SUM(deployed) GROUP BY chunk_id. Adequate at expected volume; index `idx_chunk_deployments_chunk` already exists for it (P1 indexes).
- **Judge prompt lives at `docs/prompts/judge-system.md`, loaded on every call.** Edit-then-restart works; no rebuild. Cheaper iteration than baking it into Python source.
- **Test fixtures under `backend/tests/analysis/fixtures/`.** Recorded Anthropic responses are JSON; loaded via the test by patching `AsyncAnthropic.messages.create` to return a fake `Message` object. No live API calls in CI.

### Testing Approach

This phase introduces the first proper test suite in the repo — required by ROADMAP feature 506 and pre-committed in `OVERVIEW.md`.

**Automated (lands this phase):**

- `backend/tests/analysis/test_judge.py` — golden-transcript tests:
  - **Happy path**: transcript with the user clearly using 4 of 6 chunks → mocked Anthropic returns verdicts for all 6 → assert `chunk_deployments` rows match expected, `analysis_status` is `'judged'`, `last_judged_at` set.
  - **Empty transcript**: `transcript = '[]'` → no Anthropic call (assert mock not called) → all 6 chunks get `deployed=0` rows → `'judged'`.
  - **Single user turn, zero deployments**: transcript with only "hola" → mocked verdicts all false → 6 rows with `deployed=0`, `evidence=NULL`.
  - **Validator drops bogus chunk_id**: mocked response includes a verdict for `chunk_id=9999` → that verdict is dropped (warning logged), real chunks still get rows.
  - **Validator fills missing chunk_id**: mocked response omits one chunk → that chunk gets `deployed=0` row added (warning logged).
  - **Idempotency**: run `judge_session` twice on the same session_id → final state matches second run (INSERT OR REPLACE).
- `backend/tests/analysis/test_queue.py` — worker smoke tests:
  - Insert a row at `analysis_status='pending'` with `self_assessment=2` → manually call one iteration of the worker's claim+process step (refactored into a tickable helper for testability) → assert state transitioned to `'judged'`.
  - Force `judge_session` to raise `JudgeError` 3 times → after the 3rd call, row is at `'failed'`, `retry_count=3`.
  - Row with `self_assessment=NULL` is not claimed.
  - Row with `analysis_status='active'` is not claimed.
- `backend/tests/routes/test_sessions_detail.py`:
  - `GET /api/sessions/{id}` returns the expected nested shape (transcript JSON deserialised, deployments list).
  - 404 on missing id.
  - List endpoint includes `deployed_count`/`chunk_count` (null when not yet judged, populated after).
- `backend/tests/routes/test_chunks_repcount.py` (or extend existing):
  - Insert deployments for two sessions; assert `GET /api/chunks` returns `rep_count` = sum of `deployed=1` rows per chunk.

**Mocking strategy**: patch `habla.analysis.judge.AsyncAnthropic` with a stub that returns a pre-recorded `Message` object whose `.content` includes a `tool_use` block with the fixture verdicts. Keeps the test deterministic and CI offline.

**Gates (must pass before merge):**

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `cd backend && uv run pytest`
- `docker build .`

**Manual verification (captured in decision record):**

1. **Cold judge run.** Run a real Phase 3 session through the voice pipeline → `guardar sesión` on PostSession → within ~30 s the chunks flip from `⏳` to `✓`/`✗`. Verify in DB: `SELECT * FROM chunk_deployments WHERE session_id = LAST;`.
2. **Rep-count surfaces.** After step 1, refresh frases tab → at least one chunk's count went from 0 to 1.
3. **Stats tile updates.** Home screen `frases usadas` is non-zero post-judge.
4. **Historial shows ratio.** Recently-completed session shows `X / Y frases` instead of `— frases`.
5. **Restart durability.** Run a session, hit `guardar sesión`, immediately `Ctrl-C` the backend, start it again → on boot the worker sweeps and judges the row.
6. **Anthropic outage simulation.** Temporarily set `ANTHROPIC_API_KEY` to garbage, run a session, hit `guardar sesión` → after 3 retries the row reaches `'failed'` and PostSession shows the failure caption. Restore key, restart → no auto-retry of failed row (intentional; re-judge requires a script).
7. **Empty transcript.** Force a WS drop before any user turn finalises (`failed` session, `transcript='[]'`) → not picked up because `failed` ≠ `pending`. Then *manually* set the row to `pending` + assess it (or run a synthetic test session with all-silence) → all chunks judged `deployed=0`, no Anthropic spend (verify by setting an invalid key + asserting it still completes).
8. **Concurrent session safety.** Start a fresh voice session while a prior session is mid-judge → live latency is unchanged; both sessions ultimately reach `'judged'`.
9. **Polling timeout UX.** Slow down the judge artificially (`asyncio.sleep(70)` in `judge_session` before the persist call, just for one run) → PostSession shows the "tardando" caption after 60 s and stops polling. Navigating to historial after the judge eventually finishes shows the ratio.
10. **Prompt-file edit picks up on restart.** Edit `docs/prompts/judge-system.md`, restart backend, run a session → judge call uses the new prompt (verify by adding a distinctive instruction and observing its effect on a borderline-deployment case).

**Decision-record artefacts:**

- A short note documenting the judge prompt's first stable revision and any observed failure modes (over-strict / over-lenient / hallucinated evidence).
- Anthropic spend per session observed during manual verification (rough $/session figure for future cost-cap discussions).

---

## Completion Criteria

- [ ] All required sections populated.
- [ ] Open questions resolved or explicitly deferred with defaults stated.
- [ ] 30-minute prompt spike completed (per Validate-before-proceeding) before locking the judge prompt artefact.
- [ ] Status flipped from `draft` → `approved` after human review.
- [ ] `ROADMAP.md` features 501–506 status flipped from `planned` → `in-progress`.
