# Overview

<!-- status: approved -->
| Field | Value |
|---|---|
| status | approved |
| created | 2026-04-18 |
| updated | 2026-04-18 (full Python rewrite + Pipecat voice pipeline) |

## Product Summary <!-- required -->

Habla Practice is a total-immersion language practice tool. The learner selects a scenario (neighborhood bar, market, landlord, metro) and enters a focused role-play session with a voice agent that speaks colloquial Madrid Spanish. A scenario is a template — a persona for the agent and a set of target chunks (phrases) the learner is trying to internalize. During the session the interface reduces to just the agent, a timer, and the scenario's chunks displayed as pills at the bottom of the screen for passive reference.

The voice pipeline runs server-side via Pipecat: the browser opens a WebSocket to the backend and streams mic audio in / agent audio out, while Pipecat orchestrates STT (Groq Whisper) → LLM (Claude Haiku) → TTS (Cartesia) per turn with smart-turn detection and end-to-end streaming. Each turn is captured as structured text as it happens, so the conversation transcript exists as JSON the moment the session ends — no post-session transcription pass needed.

Chunk *deployment* — whether the learner actually used each target phrase — is detected after the session by an LLM-as-judge pass (Anthropic) over the stored transcript. Results feed two things: a per-chunk rep counter, and an SM-2 SRS schedule per scenario that surfaces which scenarios are due today.

Consistency is tracked via a daily streak counter (the only gamified element) and a weekly dot grid of sessions per day.

## Target Consumer <!-- required -->

A solo adult learner of Spanish who already recognises the language passively and wants to *activate* it at a colloquial, Madrid-specific register. Assumes the learner can tolerate real conversational pressure (no translation safety net) and values short, frequent sessions over long study blocks.

Single-user by design: no authentication, no sharing, no classroom mode.

## Job To Be Done <!-- required -->

"Give me a consistent, translation-free way to practice speaking colloquial Madrid Spanish under real conversational pressure, so I actually deploy the expressions I'm trying to learn — not just recognise them."

The product delivers on three core principles:

1. **No English anywhere in the practice environment.** The UI, the agent, the chunks — all Spanish.
2. **Comprehensible input under pressure, not explicit hints.** Chunks are visible but never suggested by the agent.
3. **Measured repetition, not open-ended conversation.** Scenarios are templates with target chunks; the SRS decides what's due.

## Non-Goals <!-- required -->

- **No English in the practice environment.** No translation panel, no hint mode, no gloss reveals during a session. English glosses exist only in the backend seed data and in the `frases` management tab for authoring, never during role-play.
- **No freeform / open-ended conversation.** Every session is anchored to a scenario template.
- **No real-time chunk detection during the session.** Detection is deliberately post-session so the agent stays low-latency and the UI stays distraction-free.
- **No curriculum, no grammar lessons, no levels.** The SRS surfaces what's due; the learner picks what to practice.
- **No monologue mode.** The earlier version's "record yourself answering a prompt" flow is dropped entirely.
- **No multi-user, no auth, no sharing.** Single learner, single device profile.
- **No offline mode.** The voice agent and analysis pipeline require network; degraded mode is not a goal.

## Tech Stack <!-- required -->

**Frontend**:
- React 19 + Vite 6
- Vanilla CSS with design tokens from `docs/artifacts/habla-practice.html` (DM Sans + DM Mono, dark-first palette, green accent `#1D9E75`)
- Pipecat browser client (`@pipecat-ai/client-js` or equivalent) for `getUserMedia` + bidirectional audio streaming over WebSocket

**Backend** (Python 3.12, single service):
- **FastAPI** — HTTP API + WebSocket endpoint, async-native
- **Pipecat** — voice pipeline orchestration with smart-turn detection
- **aiosqlite** — async SQLite access (no ORM); WAL journal mode preserved
- **anthropic** — Python SDK for the LLM-as-judge step
- In-process `asyncio.Queue` + lifespan-managed worker for post-session analysis

**External services** (all wired through Pipecat for the live pipeline):
- **Groq Whisper** — STT (chosen over OpenAI for ~10× speed)
- **Anthropic Claude Haiku** — agent LLM during the session, with prompt caching on the scenario system prompt
- **Anthropic Claude Sonnet/Opus** — LLM-as-judge after the session (separate, slower call)
- **Cartesia Sonic** — streaming TTS over WebSocket, Madrid Spanish voice

**Infrastructure**:
- Fly.io (region `fra`, persistent volume at `/data` for SQLite DB + Pipecat smart-turn model cache)
- Docker multi-stage build: Node stage builds the frontend → Python 3.12-slim stage runs FastAPI and serves `frontend/dist` via `StaticFiles` + SPA fallback
- Smart-turn model pre-baked into the image at build time to avoid cold-start downloads

**Tooling**:
- **uv** — Python dependency + venv management
- **ruff** — Python lint + format
- **pyright** — Python type checking
- **pytest** + **pytest-asyncio** — test runner
- **Prettier 3** — frontend JS/JSX formatting (unchanged)
- **concurrently** at the root `package.json` to spawn `vite` + `uv run uvicorn` together in dev

## Testing Suite <!-- required -->

No test suite exists today. The pivot raises the stakes: the transcript → judge → SRS pipeline is non-trivial and should not be shipped without at least:

- Unit tests for the SM-2 scheduler (`pytest`)
- A golden-transcript test for the Anthropic judge (fixed transcript JSON + scenario chunks → expected deployment verdicts)
- An integration smoke test for `POST /api/sessions/start` → fake Pipecat transcript → judge → `GET /api/scenarios` due-date update

The harness lands in Phase 5 (see `ROADMAP.md`):
- **Backend**: `pytest` + `pytest-asyncio` for the FastAPI + asyncio worker code
- **Frontend**: deferred — Vitest is the obvious default if/when the React surface grows complex enough to warrant tests

CI (`.github/workflows/ci.yml`) will need to be updated alongside the Phase 1 migration: add a `ruff check` + `pyright` step in place of (or alongside) the current `npm run format:check`, and switch the build verification to a multi-stage Docker build so the Python side is exercised. Deployment (`fly-deploy.yml`) continues to run `flyctl deploy` on push to `main`.
