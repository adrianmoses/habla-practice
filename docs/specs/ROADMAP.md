# Roadmap

<!-- status: approved -->
| Field | Value |
|---|---|
| status | approved |
| created | 2026-04-18 |
| updated | 2026-04-18 (full Python rewrite + Pipecat voice pipeline) |

## Phases

The refactor ships in six ordered phases. Each phase aims to leave `main` in a working state — even if visibly incomplete — so interim deploys don't regress the product.

### Phase 1 — Python skeleton, data model, clean break

The whole Node backend is removed in this phase. By the end, the app boots on a Python service with the new schema and seeded scenarios, served behind the existing (legacy) frontend stub.

**Deliverables**
- `backend/` becomes a Python project: `pyproject.toml` managed by `uv`, `src/habla/` package layout, `ruff` + `pyright` configured, `pytest` + `pytest-asyncio` set up (no tests yet — harness only).
- FastAPI `main.py` with lifespan: opens `aiosqlite` connection, runs `db.schema.create_all()`, starts the analysis worker coroutine, mounts routes, mounts `StaticFiles` for `frontend/dist` with SPA fallback.
- New schema (per `ARCHITECTURE.md`): `scenarios`, `chunks`, `scenario_chunks`, `sessions`, `chunk_deployments`, `scenario_srs`. Migration = drop the old DB and re-create on first run (clean break — no Node-era data preserved).
- Delete the entire `backend/` Node project (`backend/package.json`, `backend/src/**`, `data/recordings/`, `habla_practice.jsx` legacy root file).
- Update root `package.json`: `npm run dev` becomes `concurrently "uv run --directory backend uvicorn habla.main:app --reload --port 3000" "cd frontend && npm run dev"`. `npm run start` and `npm run build` updated to match.
- Rewrite `Dockerfile`: multi-stage, Node 20-slim builds the frontend, `python:3.12-slim` runs `uvicorn`. Frontend `dist/` copied into the Python stage. Smart-turn model NOT pulled in this phase (Phase 3) but reserve the cache directory.
- Rewrite `.github/workflows/ci.yml`: `uv sync` + `uv run ruff check` + `uv run pyright` + `cd frontend && npm ci && npm run build`.
- Author `docs/prompts/madrid-chunk-seed.md` — the prompt used to generate Madrid-flavoured chunks (tone, register, anti-patterns to avoid). Use it once to fill the seed.
- Seed: 4 starter scenarios (Bar de barrio ☕, Mercado / tienda 🏪, Casero / vecinos 🏠, Metro / transporte 🚇) with ~6 target chunks each.
- CRUD routes: `routes/scenarios.py`, `routes/chunks.py`. The `scenario_chunks` join is managed as part of the scenario payload (POST/PUT accept `chunk_ids: int[]`).

**Exit criteria**
- A fresh checkout: `npm ci`, `cd frontend && npm ci`, `cd backend && uv sync`, `npm run dev` → both servers up, `curl localhost:3000/api/scenarios` returns the four seeded scenarios.
- `npm run build && docker build .` succeeds.
- The legacy frontend (the existing 1,200-line `App.jsx`) still renders against stub data — broken UI is fine, build passing is what matters. It gets replaced in Phase 2.

### Phase 2 — New UI shell (no voice yet)

**Deliverables**
- Port design tokens from `docs/artifacts/habla-practice.html` into `frontend/src/styles/tokens.css` (DM Sans + DM Mono, dark palette, green accent `#1D9E75`, radii, spacing).
- Replace `App.jsx` with the new three-tab shell: `sesión` / `frases` / `historial`. Streak pill in the top bar (placeholder until Phase 4).
- `views/SesionHome.jsx`: stats row (placeholders), scenario cards with confidence bar + due-state pill (placeholders for SRS until Phase 6), chunk preview pills for the selected scenario, duration picker, `empezar sesión` button (still disabled — routes to a stub `LiveSession` that just runs the timer).
- `views/Frases.jsx`: chunk list with rep-count circle (placeholder zeros), Spanish-only gloss, tag filter pills, "+ nueva frase" add flow.
- `views/Historial.jsx`: weekly dot grid + recent sessions list (empty state OK).
- Scenario creation UI ("+ nuevo escenario"): name + emoji + chunk multi-select.
- Delete every legacy view (`Practicar`, `Explorar`, `Progreso`).

**Exit criteria**
- App looks like `docs/artifacts/habla-screenshot.png`. Navigation works. CRUD on scenarios + chunks works end-to-end against the Phase 1 backend. No voice agent yet.

### Phase 3 — Pipecat voice pipeline end-to-end

**Deliverables**
- Add Pipecat + extras to `pyproject.toml`: `pipecat-ai[cartesia,anthropic,groq,silero,smart-turn]` (exact extras pinned to what Pipecat publishes).
- Bake the smart-turn model into the Docker image at build time (`RUN python -c "from pipecat... import download_model; download_model()"` or equivalent — refine during implementation).
- `agent/prompt.py`: builds the agent system prompt from a scenario (persona + brief Madrid-register guidance + target chunks listed as "try to elicit these naturally if the conversation allows" — never as commands).
- `agent/pipeline.py`: Pipecat pipeline factory — Silero VAD + smart-turn → Groq Whisper STT (streaming) → Anthropic Claude Haiku (streaming, prompt caching enabled on the scenario prompt) → Cartesia Sonic TTS over WebSocket. Custom frame processor captures every finalized user transcript + every assistant completion into a `turns` list with timestamps.
- `routes/sessions.py`: `POST /api/sessions/start` creates the session row, returns `{session_id, ws_url}`. `POST /api/sessions/:id/assess` accepts the self-assessment.
- `routes/ws.py`: `WS /ws/session/{id}` accepts the connection, validates the session is `active` and not already connected, instantiates a Pipecat pipeline, runs until the timer expires or the WS closes, persists `turns` to `sessions.transcript`, sets `analysis_status='pending'`.
- Frontend `lib/voice.js`: Pipecat browser client wrapper — `getUserMedia`, WS handshake, push mic frames in, play agent frames out, expose state events (`connecting`, `listening`, `speaking`, `thinking`, `error`, `closed`).
- Frontend `views/LiveSession.jsx`: full-screen agent orb + pulsing rings, voice-activity bars, status label cycling, timer, chunk pills (always visible, never highlighted during the session), `terminar` / `pausa` footer.
- Frontend `views/PostSession.jsx`: self-assessment picker (difícil / regular / bien / fluido), list of scenario chunks with `⏳ pendiente`, async-notice banner.
- Basic error handling: WS drop mid-session persists what we have (partial `turns`), marks session `failed`.

**Exit criteria**
- Learner can pick a scenario, hold a 5-minute Spanish conversation with the agent, see the post-session screen, and find the session persisted with a non-empty `transcript` JSON.
- Time-to-first-agent-audio measured per turn is in the ~500–700ms range (per `ARCHITECTURE.md` budget). Wall-clock measure on a real Fly machine, not just localhost.
- Chunks are still `pendiente` — judging hasn't been wired yet.

### Phase 4 — Streak & dashboard stats

**Deliverables**
- `routes/streak.py` → `GET /api/streak`: returns `{current_streak, last_session_date, sessions_this_week, weekly_grid: {L,M,X,J,V,S,D}, total_reps, due_today_count}`.
- Streak computed server-side on session end (when `analysis_status` first reaches `ended`, not when judging completes — streak shouldn't depend on the judge).
  - +1 on next-day use, reset on gap, same-day no-op for streak counter but counts in `sessions_this_week`.
- Home screen stats row wired up: `esta semana`, `frases usadas` (from `chunk_deployments` even if zero so far), `pendientes hoy` (from `scenario_srs.due_at`).
- Header streak pill wired up.
- Historial weekly grid wired up.

**Exit criteria**
- After each saved session, the home screen counters and weekly grid update without manual refresh.
- The 12-day streak state shown in `docs/artifacts/habla-screenshot.png` is reproducible end-to-end with seeded session history.

### Phase 5 — LLM-as-judge & rep counter

**Deliverables**
- `analysis/queue.py`: asyncio worker started in the FastAPI lifespan. Loop: `SELECT` pending sessions where `self_assessment IS NOT NULL`, process serially, sleep on empty queue. Durable across restarts: on boot, requeue any `pending` rows.
- `analysis/judge.py`: build prompt from `docs/prompts/judge-system.md` + transcript JSON + scenario chunks. Anthropic Sonnet/Opus call with structured output (JSON schema for `[{chunk_id, deployed, evidence}]`). Write `chunk_deployments` rows. Set `analysis_status='judged'`.
- `routes/chunks.py`: rep counter via `SUM(deployed)` aggregate exposed in `GET /api/chunks` payload.
- `PostSession.jsx`: poll `GET /api/sessions/:id` (or subscribe via SSE on a follow-up) for analysis completion; flip `⏳` → `✓` / `✗` per chunk and surface cited evidence on hover.
- Historial list shows `X / Y frases desplegadas` per completed session.
- **First tests in the repo**:
  - `pytest` harness with golden-transcript fixtures: a fixed `transcript.json` + `scenario.json` → expected deployment verdicts. Lets us iterate on the judge prompt without burning Anthropic spend on every change (mock the API call against a recorded response).
  - Smoke test for the queue worker: insert a row, run one tick, assert state transitions.

**Exit criteria**
- Every completed session reaches `analysis_status='complete'` within ~30s of self-assessment submission.
- Judge output is inspectable in the DB (`SELECT * FROM chunk_deployments WHERE session_id = ?`).
- Frases tab rep counts increment after sessions deploy chunks.

### Phase 6 — SRS

**Deliverables**
- `analysis/srs.py`: SM-2 implementation operating on `scenario_srs`. Quality (0–5) computed from `(deployed_count / chunk_count) * 5` blended with `self_assessment` (0–3 mapped to 1–5). Exact weighting in code, unit-tested.
- Triggered at the end of the analysis pipeline, after `judged` → before `complete`.
- `due_at` surfaced in `GET /api/scenarios` as a `due_label` string (`repasa hoy` / `en N días` / `atrasado`) and a `confidence` percentage for the card's progress bar.
- Scenario cards reorder with due-today scenarios at the top.
- Historial list computes and shows confidence delta (`+4%` / `−2%`) per session by diffing SRS state before vs. after the SRS update for that session.

**Exit criteria**
- Due scenarios surface correctly day-to-day. The empty-state "nothing due" message reachable.
- The learner has a coherent signal for "what should I practice today."

## Features

| ID  | Feature                                                                          | Phase | Status     |
|-----|----------------------------------------------------------------------------------|-------|------------|
| 101 | Python project skeleton (FastAPI + uv + ruff + pyright + pytest)                 | P1    | implemented |
| 102 | New schema: scenarios / chunks / scenario_chunks / sessions / deployments / scenario_srs | P1 | implemented |
| 103 | Clean-break migration: drop legacy DB, delete Node backend, purge `data/recordings/` | P1 | implemented |
| 104 | Multi-stage Dockerfile (Node builds frontend → Python runs backend)              | P1    | implemented |
| 105 | CI overhaul: `uv sync` + `ruff` + `pyright` + frontend build                     | P1    | implemented |
| 106 | Starter seed: 4 scenarios × ~6 Madrid chunks                                     | P1    | implemented |
| 107 | `docs/prompts/madrid-chunk-seed.md` chunk-generation prompt                      | P1    | implemented |
| 108 | CRUD routes: `/api/scenarios`, `/api/chunks` (with m:n link)                     | P1    | implemented |
| 201 | Design tokens ported from `docs/artifacts/habla-practice.html`                   | P2    | implemented |
| 202 | Three-tab shell + streak pill                                                    | P2    | implemented |
| 203 | `SesionHome` view (stats, scenario cards, preview pills, duration)               | P2    | implemented |
| 204 | `Frases` view with rep counter + tag filter                                      | P2    | implemented |
| 205 | `Historial` view (weekly grid + recent sessions list)                            | P2    | implemented |
| 206 | "Nuevo escenario" creation UI                                                    | P2    | implemented |
| 301 | Pipecat installed (smart-turn model bundled with package — no Docker bake needed)| P3    | implemented |
| 302 | `agent/prompt.py` builder + `docs/prompts/agent-system.md`                       | P3    | implemented |
| 303 | `agent/pipeline.py`: Silero VAD + smart-turn → Groq STT → Claude Haiku → Cartesia TTS | P3 | implemented |
| 304 | `WS /ws/session/{id}` endpoint + per-connection pipeline                         | P3    | implemented |
| 305 | `POST /api/sessions/start` + `POST /api/sessions/:id/assess`                     | P3    | implemented |
| 306 | Frontend `lib/voice.js` (Pipecat browser client wrapper)                         | P3    | implemented |
| 307 | `LiveSession` view (orb, timer, chunk pills, terminar — `pausa` dropped)         | P3    | implemented |
| 308 | `PostSession` view (self-assessment POST + async notice + chunk pendiente list)  | P3    | implemented |
| 309 | Latency measurement on real Fly deploy: TTFB ≤ 700ms per turn                    | P3    | in-progress |
| 401 | `GET /api/streak` (current streak, weekly grid, dashboard counters)              | P4    | planned    |
| 402 | Server-side streak computation on session end                                    | P4    | planned    |
| 501 | Analysis queue worker (asyncio, lifespan-managed, restart-durable)               | P5    | planned    |
| 502 | Anthropic LLM-as-judge + `chunk_deployments` writes                              | P5    | planned    |
| 503 | `docs/prompts/judge-system.md`                                                   | P5    | planned    |
| 504 | Per-chunk rep counter surfaced in `/api/chunks`                                  | P5    | planned    |
| 505 | Post-session UI transitions `⏳` → `✓/✗` on completion                           | P5    | planned    |
| 506 | Pytest golden-transcript test set + queue-worker smoke test                      | P5    | planned    |
| 601 | SM-2 implementation on `scenario_srs`                                            | P6    | planned    |
| 602 | Due-state surfacing: `repasa hoy` / `en N días` / confidence bar                 | P6    | planned    |
| 603 | Historial confidence delta per session                                           | P6    | planned    |
|     | —                                                                                |       |            |
| 901 | Monologue mode: random topic prompts + self-rating                               | —     | deprecated |
| 902 | Cartesia TTS via the old per-phrase preview button (Cartesia returns in P3 inside Pipecat) | — | deprecated |
| 903 | In-browser MediaRecorder + `data/recordings/` flat audio storage                 | —     | deprecated |
| 904 | localStorage-based session log + streak                                          | —     | deprecated |
| 905 | `Explorar` view with topic/chunk CRUD                                            | —     | deprecated |
| 906 | Topics table + topic prompts                                                     | —     | deprecated |
| 907 | English glosses on chunks                                                        | —     | deprecated |
| 908 | Hono / Node backend (`backend/` Node project, `better-sqlite3`, `dotenv`)        | —     | deprecated |
| 909 | OpenAI Realtime path (considered, dropped in favour of Pipecat pipeline)         | —     | deprecated |

Fly.io deployment + GitHub Actions deploy carry forward unchanged from the previous roadmap and are not re-listed.

## Status Values

- `planned` — not yet started
- `in-progress` — spec written, implementation underway
- `implemented` — decision record complete
- `deprecated` — removed from product

## Revision History

| Date       | Change                                                                                           |
|------------|--------------------------------------------------------------------------------------------------|
| 2026-04-18 | Initial roadmap inferred by `ss-audit` skill.                                                    |
| 2026-04-18 | Pivot: scenario-based voice-agent role-play with OpenAI Realtime + Whisper + Anthropic judge + SM-2 SRS. Monologue flow deprecated. Six-phase refactor plan added. |
| 2026-04-18 | Architecture pivot: full Python rewrite on FastAPI + Pipecat (smart-turn VAD, Groq Whisper STT, Claude Haiku agent, Cartesia streaming TTS). Hono/Node backend deprecated entirely. Audio storage and post-session Whisper pass dropped — Pipecat emits structured turn-by-turn transcripts live. Phase 1 expanded to include the Python skeleton + Node teardown; Phase 5 simplified (judge only, no transcribe). |
| 2026-04-18 | Phase 1 implemented on branch `feat/phase-1-python-migration`. Decision record: [`phase-1-python-migration/decision.md`](./phase-1-python-migration/decision.md). |
| 2026-04-18 | Phase 2 spec drafted: [`phase-2-ui-shell/spec.md`](./phase-2-ui-shell/spec.md). Features 201–206 moved from `planned` → `in-progress`. |
| 2026-04-18 | Phase 2 implemented on branch `feat/phase-2-ui-shell`. Decision record: [`phase-2-ui-shell/decision.md`](./phase-2-ui-shell/decision.md). Features 201–206 `in-progress` → `implemented`. |
| 2026-04-19 | Phase 3 spec drafted: [`phase-3-pipecat-pipeline/spec.md`](./phase-3-pipecat-pipeline/spec.md). Features 301–309 moved from `planned` → `in-progress`. |
| 2026-04-19 | Phase 3 implemented on branch `feat/phase-3-pipecat-pipeline`. Decision record: [`phase-3-pipecat-pipeline/decision.md`](./phase-3-pipecat-pipeline/decision.md). Features 301–308 `in-progress` → `implemented`. Feature 309 (TTFB measurement on Fly) stays `in-progress` — deferred to first deploy. Backend now runs in Linux Docker (Pipecat can't install on Intel Mac host); `npm run dev:backend` = `docker compose up backend`. |
