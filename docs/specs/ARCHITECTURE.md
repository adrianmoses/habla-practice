# Architecture

<!-- status: approved -->
| Field | Value |
|---|---|
| status | approved |
| created | 2026-04-18 |
| updated | 2026-04-18 (full Python rewrite + Pipecat voice pipeline) |

## System Overview <!-- required -->

Single Python service that does everything. The Hono/Node backend is removed entirely.

- **Frontend**: React 19 + Vite 6 SPA. Built statically and served by FastAPI's `StaticFiles` + SPA fallback in production. In dev, Vite runs separately on port 5173 and proxies `/api/*` and `/ws/*` to the FastAPI dev server on port 3000.
- **Backend** (Python 3.12, FastAPI):
  - HTTP API for scenarios, chunks, sessions, streak, historial.
  - WebSocket endpoint that owns one Pipecat pipeline instance per connection — the live voice conversation.
  - Background worker (an asyncio coroutine started in the FastAPI lifespan) that picks up sessions with `analysis_status='pending'` and runs the LLM-as-judge → SM-2 step.
- **External services** are reached only from the backend, never the browser. The browser holds no API keys.

State lives in two places:

1. **SQLite** at `$DATA_DIR/habla.db` — scenarios, chunks, sessions (with structured transcript stored as a JSON column), deployments, SRS state, streak.
2. **Browser `localStorage`** — UI preferences only (last selected scenario / duration). Nothing else.

There is no audio storage anywhere on disk. Pipecat emits a structured turn-by-turn transcript as the conversation happens; that transcript is the source of truth. Raw audio is never persisted.

## Component Map <!-- required -->

Target layout (this is a greenfield Python rewrite — Phase 1 scaffolds it):

```
habla-practice/
├── backend/
│   ├── pyproject.toml                     ← uv-managed Python project
│   ├── uv.lock
│   └── src/habla/
│       ├── __init__.py
│       ├── main.py                        ← FastAPI app, lifespan (startup/shutdown), route mounts, static serve
│       ├── config.py                      ← env loading (pydantic-settings)
│       ├── db/
│       │   ├── __init__.py
│       │   ├── connection.py              ← aiosqlite pool / context manager, WAL mode
│       │   ├── schema.py                  ← create_all() — runs migrations on startup
│       │   └── seed.py                    ← seeds 4 starter scenarios + their chunks
│       ├── routes/
│       │   ├── scenarios.py               ← GET/POST/PUT/DELETE /api/scenarios (SRS due-state in GET)
│       │   ├── chunks.py                  ← GET/POST/PUT/DELETE /api/chunks (rep counts in GET)
│       │   ├── sessions.py                ← POST /api/sessions/start, GET /api/sessions, GET /api/sessions/:id
│       │   ├── streak.py                  ← GET /api/streak (daily + weekly grid + dashboard stats)
│       │   └── ws.py                      ← WS /ws/session/{id} — Pipecat pipeline per connection
│       ├── agent/
│       │   ├── prompt.py                  ← builds the agent system prompt from a scenario
│       │   └── pipeline.py                ← Pipecat pipeline factory: transport → STT → LLM → TTS
│       └── analysis/
│           ├── queue.py                   ← asyncio worker: picks up pending sessions
│           ├── judge.py                   ← Anthropic LLM-as-judge call; writes chunk_deployments rows
│           └── srs.py                     ← SM-2 update for the scenario from deployment ratio + self-assessment
│
├── frontend/                               ← unchanged React + Vite shape
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                        ← shell with tabs (sesión / frases / historial)
│       ├── views/
│       │   ├── SesionHome.jsx
│       │   ├── Frases.jsx
│       │   ├── Historial.jsx
│       │   ├── LiveSession.jsx            ← Pipecat client + agent orb + timer + chunk pills
│       │   └── PostSession.jsx
│       ├── lib/
│       │   ├── api.js                     ← fetch wrappers for /api/*
│       │   └── voice.js                   ← Pipecat browser client setup, WS handshake, audio I/O
│       └── styles/
│           ├── tokens.css                 ← design tokens ported from docs/artifacts/habla-practice.html
│           └── global.css
│
├── docs/
│   ├── artifacts/                         ← UI prototype + screenshot
│   ├── prompts/
│   │   ├── madrid-chunk-seed.md           ← prompt used to generate starter chunks (Phase 1 deliverable)
│   │   ├── agent-system.md                ← scenario-agnostic part of the agent system prompt
│   │   └── judge-system.md                ← LLM-as-judge system prompt
│   └── specs/                             ← OVERVIEW.md, ARCHITECTURE.md, ROADMAP.md
│
├── package.json                            ← root: still drives `npm run dev` via concurrently (vite + uv run uvicorn)
├── fly.toml
├── Dockerfile                              ← multi-stage: node-builder (frontend) → python:3.12-slim (runtime)
└── .github/workflows/
    ├── ci.yml                              ← ruff check + pyright + uv sync + frontend build
    └── fly-deploy.yml                      ← unchanged
```

## Data Flow <!-- required -->

### 1. Home screen bootstrap

1. Browser loads `/` → React mounts → `SesionHome` fetches `/api/scenarios`, `/api/chunks`, `/api/streak` in parallel.
2. `GET /api/scenarios` returns each scenario joined with its `scenario_srs` row: `{id, slug, name, icon, chunks: [...], confidence, due_at, due_label}`.
3. `GET /api/streak` returns `{current_streak, weekly_grid, sessions_this_week, total_reps, due_today_count}`.

### 2. Starting a session

1. Learner picks scenario + duration (5/10/15/20 min) → clicks *empezar sesión*.
2. Frontend calls `POST /api/sessions/start` with `{scenario_id, duration_sec}`.
3. Backend:
   - Inserts a `sessions` row (`status='active'`, `started_at=now`).
   - Builds the agent system prompt from the scenario (persona + brief Madrid-register guidance + target chunks).
   - Returns `{session_id, ws_url: "/ws/session/{session_id}", agent_prompt_hash}`.
4. Frontend opens a WebSocket to `ws_url`.
5. Backend's WS handler instantiates a Pipecat pipeline per connection:
   - **Transport**: Pipecat's `WebsocketServerTransport` bound to this connection. Bidirectional Opus/PCM frames.
   - **VAD**: Silero VAD + smart-turn detection model (the model is loaded once at app startup, shared across pipelines).
   - **STT**: Groq Whisper (`whisper-large-v3-turbo` or current equivalent), streaming.
   - **LLM**: Anthropic Claude Haiku, streaming, with the scenario system prompt cached (Anthropic prompt caching, 1-hour TTL — covers the whole session).
   - **TTS**: Cartesia Sonic over Cartesia's WebSocket endpoint, streaming, Madrid Spanish voice.
   - **Frame sink**: a small custom Pipecat processor that captures every finalized user STT transcript and every assistant LLM completion into an in-memory `turns` list with timestamps.
6. UI switches to `LiveSession`: full-screen agent orb, status label cycling, timer, chunk pills (always visible, never highlighted during the session).

### 3. Ending a session

1. Timer expires, learner hits *terminar*, or WS disconnects — Pipecat pipeline is torn down.
2. Backend WS handler:
   - Persists the captured `turns` list to `sessions.transcript` as JSON.
   - Updates the `sessions` row: `status='ended'`, `ended_at`, `duration_sec`, `analysis_status='pending'`.
3. Frontend POSTs the learner's `self_assessment` (from the post-session screen) to `POST /api/sessions/:id/assess`. Backend updates `sessions.self_assessment`.
4. UI shows `PostSession`: scenario chunks each marked `⏳ pendiente`, async-notice banner.
5. Backend's analysis worker (running in the lifespan) picks up the session.

### 4. Post-session analysis (async, background)

1. Worker `SELECT id FROM sessions WHERE analysis_status = 'pending' AND self_assessment IS NOT NULL ORDER BY ended_at LIMIT 1`.
2. **Judge** (`analysis/judge.py`):
   - Build prompt: system prompt from `docs/prompts/judge-system.md` + transcript JSON + scenario chunks.
   - Call Anthropic Sonnet/Opus (slower model OK — this is offline). Use structured output: array of `{chunk_id, deployed: bool, evidence: string|null}` rows.
   - Write `chunk_deployments` rows.
   - Set `analysis_status='judged'`.
3. **SRS** (`analysis/srs.py`):
   - Compute quality (0–5) by blending `(deployed_count / chunk_count) * 5` with `self_assessment` (0–3 → mapped to 1–5). Exact weighting in code, unit-tested.
   - Apply SM-2 to `scenario_srs`: update `repetitions`, `interval_days`, `ease_factor`, `due_at`, `last_reviewed_at`, `last_quality`.
4. Set `analysis_status='complete'`. Record `last_judged_at` for observability.
5. Frontend's `PostSession` polls (or subscribes via SSE on a follow-up route) for analysis completion; flips `⏳` → `✓` / `✗` per chunk and shows cited evidence on hover.

### 5. Reading state

- `GET /api/scenarios` — home screen cards with confidence + due-state.
- `GET /api/chunks?scope=all|scenario:<id>&tag=<tag>` — frases tab with rep counts (`SUM(deployed)` aggregate).
- `GET /api/sessions?limit=20` — historial list with deployment ratio and confidence delta per session.
- `GET /api/streak` — dashboard counters + weekly grid.

## Data Model

```sql
-- Scenarios are templates: a persona for the agent + a curated set of target chunks.
CREATE TABLE scenarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  icon         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chunks: Spanish text + optional Spanish-only gloss for the frases tab.
-- Tags are filter sugar (bar, social, calle), independent of scenario membership.
CREATE TABLE chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  text_es      TEXT NOT NULL,
  gloss_es     TEXT,
  tags         TEXT,                              -- comma-separated
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: a chunk can belong to multiple scenarios.
CREATE TABLE scenario_chunks (
  scenario_id  INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  chunk_id     INTEGER NOT NULL REFERENCES chunks(id)    ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scenario_id, chunk_id)
);

-- One row per session. Transcript is JSON, written when Pipecat tears down.
-- No audio is stored anywhere.
CREATE TABLE sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id       INTEGER NOT NULL REFERENCES scenarios(id),
  started_at        TEXT    NOT NULL,
  ended_at          TEXT,
  duration_sec      INTEGER,
  self_assessment   INTEGER,                      -- 0=difícil, 1=regular, 2=bien, 3=fluido
  transcript        TEXT,                         -- JSON: [{role: 'user'|'agent', text, started_at, ended_at}, ...]
  analysis_status   TEXT NOT NULL DEFAULT 'active', -- active|ended|pending|judged|complete|failed
  last_judged_at    TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (session, target chunk), written by the judge.
CREATE TABLE chunk_deployments (
  session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_id     INTEGER NOT NULL REFERENCES chunks(id),
  deployed     INTEGER NOT NULL,                  -- 0/1
  evidence     TEXT,                              -- transcript span Claude cited
  PRIMARY KEY (session_id, chunk_id)
);

-- SM-2 state per scenario. Created lazily on first session for a scenario.
CREATE TABLE scenario_srs (
  scenario_id       INTEGER PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
  repetitions       INTEGER NOT NULL DEFAULT 0,
  interval_days     INTEGER NOT NULL DEFAULT 0,
  ease_factor       REAL    NOT NULL DEFAULT 2.5,
  due_at            TEXT,
  last_reviewed_at  TEXT,
  last_quality      INTEGER
);
```

Per-chunk rep count is not materialised — `SELECT chunk_id, SUM(deployed) FROM chunk_deployments GROUP BY chunk_id`. Add a covering index if query volume warrants.

The `transcript` JSON shape:

```json
[
  {"role": "agent", "text": "¿Qué va a ser?", "started_at": "2026-04-18T11:02:14.120Z", "ended_at": "2026-04-18T11:02:15.480Z"},
  {"role": "user",  "text": "Ponme un cortado", "started_at": "2026-04-18T11:02:16.030Z", "ended_at": "2026-04-18T11:02:17.500Z"},
  ...
]
```

## External Dependencies <!-- required -->

**Runtime services** (called from the backend; the browser never holds keys):

- **Groq** (`https://api.groq.com/openai/v1/audio/transcriptions`) — Whisper-compatible STT, hosted at ~5–10× OpenAI speed. Auth via `GROQ_API_KEY`. Chosen for latency.
- **Anthropic Messages API** — two distinct uses:
  - Agent during session: **Claude Haiku** with prompt caching on the scenario system prompt. Streaming.
  - Judge after session: **Claude Sonnet/Opus** (latency-tolerant). Structured output via JSON schema.
  Both via `ANTHROPIC_API_KEY`.
- **Cartesia** (`wss://api.cartesia.ai/tts/websocket`) — streaming TTS. Auth via `CARTESIA_API_KEY`. Madrid Spanish voice ID lives in `agent/pipeline.py` (carry over from previous Cartesia integration).
- **Fly.io** — single Python container. Persistent volume `habla_data` at `/data` for `habla.db` + Pipecat's smart-turn model cache. Region `fra`.

**Smart-turn model**: Pipecat's smart-turn classifier is a small local model (~tens of MB). Pre-baked into the Docker image at build time so cold starts don't pay a Hugging Face download.

**Python dependencies** (top-level):

- `fastapi`
- `uvicorn[standard]`
- `pipecat-ai` with extras for `cartesia`, `anthropic`, `groq`, `silero`, `smart-turn`
- `aiosqlite`
- `anthropic`
- `pydantic-settings`
- `pytest`, `pytest-asyncio` (dev)
- `ruff`, `pyright` (dev)

**Frontend dependencies to add**:

- Pipecat browser client (`@pipecat-ai/client-js` and the WebSocket transport package — exact package names to confirm during Phase 3).

**Removed entirely**: Hono, `@hono/node-server`, `better-sqlite3`, `dotenv`, the entire `backend/` Node project.

## Key Constraints <!-- required -->

**Environment variables** (project-root `.env`):

- `GROQ_API_KEY` — required for STT.
- `ANTHROPIC_API_KEY` — required for agent + judge.
- `CARTESIA_API_KEY` — required for TTS.
- `DATA_DIR` — SQLite + smart-turn model cache. Default `./data`; production `/data` via `fly.toml`.
- `PORT` — default `3000`.
- (Removed: `OPENAI_API_KEY`, `CARTESIA_API_KEY` was already there — preserved.)

**Trust boundaries**:

- All third-party API calls happen server-side. The browser holds no provider keys.
- Single-user assumption preserved — no auth on the API or WS endpoint. The WS endpoint must at minimum check that the `session_id` in the URL exists, is `status='active'`, and isn't already attached to another connection (otherwise a second tab could hijack the pipeline).

**Latency budget** (with Pipecat pipelining):

- STT finalize after user stops: ~150–300ms (Groq + smart-turn detection).
- Claude Haiku first token: ~300–500ms (with prompt caching on the scenario prompt).
- Cartesia first audio bytes: ~90–150ms (WebSocket TTS, streaming).
- **Time-to-first-agent-audio: ~500–700ms per turn.**

This is the target to beat. Anything substantially worse means a config issue (cache miss, wrong model, REST instead of WS endpoint).

**Cost shape**:

- Per session ≈ duration × (Groq STT + Anthropic Haiku tokens + Cartesia TTS chars) + one Anthropic Sonnet/Opus judge call.
- Bounded by single-user × ~1–5 sessions/day × 5–20 min each. No spend caps in code yet — call out as Phase 3 follow-up if it becomes a concern.

**Durability**:

- SQLite WAL on a Fly volume. Single writer, single node. Matches the single-user product stance.
- No audio storage. If we ever want to re-judge a session with an updated prompt, the transcript JSON is what we replay.

**Concurrency**:

- One active session at a time (single user). Backend should refuse a `/ws/session/{id}` connection if there's already an open WS for any session, or if the addressed session isn't in `status='active'`.
- Analysis worker is idempotent on `analysis_status` transitions; failures bump `retry_count` and re-queue with backoff.

**Pre-warming**:

- Pipecat pipeline factories are cheap; cold start cost is dominated by loading the smart-turn model (one-time at app startup, not per session).
- Anthropic prompt cache survives 60 minutes — the scenario system prompt benefits across multiple sessions of the same scenario in the same hour.
