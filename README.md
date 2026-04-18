# habla.practice

A total-immersion language practice tool for colloquial Madrid Spanish. The learner picks a scenario (neighbourhood bar, market, landlord, metro) and holds a live role-play with a voice agent — no English, no translation hints. Target phrases ("chunks") are visible as pills at the bottom of the session screen; after the session, a transcript-based judge determines which were actually deployed, and an SM-2 SRS per scenario surfaces what's due next.

This repo is mid-rewrite. See `docs/specs/OVERVIEW.md`, `docs/specs/ARCHITECTURE.md`, and `docs/specs/ROADMAP.md` for the six-phase plan.

## Stack

- **Frontend**: React 19 + Vite 6
- **Backend**: Python 3.12 + FastAPI, managed with [uv](https://docs.astral.sh/uv/). SQLite via `aiosqlite` (WAL). Pipecat voice pipeline lands in Phase 3 (OpenAI Realtime is _not_ used — the pipeline is STT + LLM + TTS with smart-turn VAD).
- **External services** (Phase 3+): Groq Whisper (STT), Anthropic Claude (agent Haiku + judge Sonnet/Opus), Cartesia (streaming TTS).
- **Deployment**: Fly.io, multi-stage Docker (Node builds frontend → Python runs backend).

## Getting started

### Prerequisites

- Node.js 20+
- Python 3.12
- `uv` — install with `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Install

```bash
npm install
(cd frontend && npm install)
(cd backend && uv sync)
```

### Configure

Copy `.env.example` to `.env` at the repo root and fill in the keys you have. Phase 1 doesn't consume any of them; they become load-bearing in Phase 3.

### Run

```bash
npm run dev
```

Starts Vite (port 5173, proxies `/api` → backend) and uvicorn (port 3000) concurrently. Logs are prefixed `be |` / `fe |`.

### Build & production

```bash
npm run build    # builds the frontend into frontend/dist/
npm run start    # runs uvicorn bound to 0.0.0.0, serving the built frontend
```

### Lint, format, typecheck

```bash
npm run format         # prettier (frontend) + ruff format (backend)
npm run format:check   # both, check-only (runs in CI)
npm run lint           # ruff check
npm run typecheck      # pyright
```

## Current API (Phase 1)

| Method | Endpoint                 | Description                                   |
| ------ | ------------------------ | --------------------------------------------- |
| GET    | `/api/scenarios`         | List scenarios with their chunks (m:n)        |
| POST   | `/api/scenarios`         | Create a scenario (`{slug, name, icon, chunk_ids}`) |
| PUT    | `/api/scenarios/:id`     | Update scenario + replace chunk list          |
| DELETE | `/api/scenarios/:id`     | Delete scenario (cascades m:n)                |
| GET    | `/api/chunks`            | List chunks with rep counts (zero in Phase 1) |
| POST   | `/api/chunks`            | Create a chunk (`{text_es, gloss_es?, tags}`) |
| PUT    | `/api/chunks/:id`        | Replace chunk (full fields)                   |
| DELETE | `/api/chunks/:id`        | Delete chunk                                  |

WebSocket voice-session endpoint, sessions, streak, judge, and SRS land in later phases.

## Deployment

Fly.io with a multi-stage Dockerfile. Persistent volume `habla_data` mounted at `/data` holds `habla.db` (and, starting Phase 3, the Pipecat smart-turn model cache). Region `fra`. Config lives in `fly.toml` and `Dockerfile`.
