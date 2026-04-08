# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Habla Practice is a Spanish language speaking practice app with voice recording, Cartesia TTS playback, and vocabulary/topic management. Monorepo with a React frontend and Hono/Node.js backend using SQLite.

## Commands

```bash
npm run dev              # Start frontend + backend concurrently
npm run dev:frontend     # Vite dev server only (port 5173, proxies /api to :3000)
npm run dev:backend      # Backend with --watch and --env-file=.env
npm run build            # Build frontend (cd frontend && vite build)
npm run start            # Run backend in production mode
npm run format           # Prettier write
npm run format:check     # Prettier check (runs in CI)
```

Dependencies are installed separately: `npm ci` at root, `cd frontend && npm ci`, `cd backend && npm ci`.

## Architecture

**Frontend** (`frontend/`): React 19 + Vite. Single-page app in `App.jsx` with three views (practice, browse, progress). Uses browser MediaRecorder for audio capture and localStorage for session/streak persistence. Vite proxies `/api/*` to the backend in dev.

**Backend** (`backend/`): Hono on `@hono/node-server`. Serves API routes and the built frontend static files. SQLite database (`better-sqlite3`) at `$DATA_DIR/habla.db` with WAL mode. Tables: `topics` (category, prompt_text) and `chunks` (category, text_es, text_en). Auto-seeds from `db/seed.js` if tables are empty.

**API routes** (all in `backend/src/routes/`):
- `POST /api/tts` — proxies to Cartesia AI for Spanish TTS, returns audio/mpeg
- `POST /api/upload` — saves WebM audio to `$DATA_DIR/recordings/{date}/{id}.webm`
- `GET /api/recordings/:id?key=...` — serves audio files from disk
- `/api/topics` and `/api/chunks` — CRUD (GET list, POST create, PUT /:id, DELETE /:id)

GET responses for topics/chunks are grouped by category: `[{cat, items: [...]}]`. Topic items have `{id, text}`, chunk items have `{id, es, en}`.

## Environment

Requires `.env` at project root with `CARTESIA_API_KEY`. Optional: `DATA_DIR` (default: `./data`), `PORT` (default: 3000).

## Formatting

Prettier with: double quotes, semicolons, trailing commas, 100 char width, 2-space indent. CI enforces via `format:check`.

## Deployment

Fly.io with Docker multi-stage build. Persistent volume mounted at `/data` for SQLite DB and audio recordings. Region: fra. Config in `fly.toml` and `Dockerfile`.
