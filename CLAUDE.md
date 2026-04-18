# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Habla Practice is a total-immersion language practice tool for colloquial Madrid Spanish. Learner-picked scenarios (bar, market, landlord, metro) frame live role-play sessions with a voice agent. Transcript-based LLM-as-judge detects which target chunks were deployed; SM-2 SRS per scenario surfaces what's due next.

Monorepo: React 19 + Vite frontend and a Python 3.12 + FastAPI backend served from a single Fly.io deployment. SQLite via `aiosqlite`. No voice pipeline yet — lands in Phase 3 (Pipecat: smart-turn VAD → Groq Whisper → Claude Haiku → Cartesia TTS).

Authoritative design docs live in `docs/specs/`: `OVERVIEW.md`, `ARCHITECTURE.md`, `ROADMAP.md`. Active phase plan (if any) in `/Users/adrianmoses/.claude/plans/`.

## Commands

```bash
npm run dev              # vite (5173) + uvicorn (3000) concurrently, prefixed be|fe
npm run dev:frontend     # frontend only
npm run dev:backend      # uv run uvicorn habla.main:app --reload --port 3000
npm run build            # build frontend into frontend/dist/
npm run start            # uvicorn bound to 0.0.0.0, serves frontend/dist via SPA fallback
npm run format           # prettier (frontend) + ruff format (backend)
npm run format:check     # both, check-only (runs in CI)
npm run lint             # ruff check
npm run typecheck        # pyright
```

Install: `npm install` at root, `(cd frontend && npm install)`, `(cd backend && uv sync)`.

## Architecture

**Frontend** (`frontend/`): React 19 + Vite. Will be rewritten in Phase 2 to the three-tab UI from `docs/artifacts/habla-practice.html` (sesión / frases / historial). During Phase 1 the legacy `App.jsx` renders with errors against the new API shapes — expected.

**Backend** (`backend/`): Python 3.12, `uv`-managed under `src/habla/`. FastAPI app in `habla.main`, `aiosqlite` connection held on `app.state.db` via lifespan. Schema in `habla.db.schema`, seed in `habla.db.seed`, routes under `habla.routes.*`. Future: `habla.agent.*` (Phase 3 pipeline) and `habla.analysis.*` (Phase 5 judge + Phase 6 SRS).

**Data model** (new, clean break from the old `topics`/`chunks`):
- `scenarios`, `chunks`, `scenario_chunks` (m:n, positioned)
- `sessions` — one row per role-play; transcript stored as JSON column (Phase 3 populates)
- `chunk_deployments` — per (session, chunk) verdict (Phase 5)
- `scenario_srs` — SM-2 state per scenario (Phase 6)

**API routes** (current, Phase 1):
- `/api/scenarios` — CRUD. GET returns `[{id, slug, name, icon, chunks: [{id, text_es, gloss_es, tags, position}], created_at}]`. POST/PUT body is `{slug, name, icon, chunk_ids: int[]}` — chunk IDs are the m:n source of truth.
- `/api/chunks` — CRUD. GET returns `[{id, text_es, gloss_es, tags, rep_count, created_at}]` — `rep_count` always 0 in Phase 1; Phase 5 fills from `SUM(chunk_deployments.deployed)`.

All routes return JSON; 204 on DELETE; 400/404/409/422 for validation/missing/unique/shape errors.

## Environment

`.env` at project root. Phase 1 doesn't require any key but the file is loaded by `pydantic-settings`:
- `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CARTESIA_API_KEY` — used from Phase 3 onward
- `DATA_DIR` (default `./data`), `PORT` (default 3000)

## Tooling

- **Python**: ruff (lint + format, 100-col, double-quote, `E,F,I,UP,B,SIM,RUF`), pyright (standard mode), pytest + pytest-asyncio (harness set up, first tests land in Phase 5).
- **Frontend**: Prettier 3 (unchanged — double quotes, semicolons, trailing commas, 100 col, 2-space).

## Deployment

Fly.io multi-stage Docker: `node:20-slim` builds frontend → `python:3.12-slim` runs uvicorn and serves `frontend/dist`. Persistent volume `habla_data` at `/data`. Region `fra`. Config in `fly.toml` and `Dockerfile`. Deploy on push to `main` via `.github/workflows/fly-deploy.yml`.

## Specs

When picking up work, read `docs/specs/OVERVIEW.md` for product intent, `docs/specs/ARCHITECTURE.md` for the target data flow / schema / data model, and `docs/specs/ROADMAP.md` for the phase breakdown. The ROADMAP's "Phases" section is the canonical shipping order.
