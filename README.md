# habla.practice

A Spanish language speaking practice app with voice recording, text-to-speech playback, and vocabulary management. Built as a monorepo with a React frontend and Hono/Node.js backend.

## Features

- **Speaking prompts** -- practice explaining topics in your own words or drilling key phrases
- **Text-to-speech** -- hear native pronunciation via Cartesia AI
- **Voice recording** -- record yourself, play it back, and rate your performance
- **Vocabulary management** -- add, edit, and delete topics and chunks inline from the Explorar page
- **Progress tracking** -- daily streaks, session history, and self-ratings
- **Dark mode** -- automatic light/dark theme based on system preference

## Getting Started

### Prerequisites

- Node.js 20+
- A [Cartesia](https://cartesia.ai) API key

### Install

```bash
npm ci
cd frontend && npm ci
cd ../backend && npm ci
```

### Configure

Create a `.env` file at the project root:

```
CARTESIA_API_KEY=your_key_here
```

Optional variables:

- `DATA_DIR` -- directory for SQLite DB and recordings (default: `./data`)
- `PORT` -- backend port (default: `3000`)

### Run

```bash
npm run dev
```

This starts the Vite dev server on port 5173 (proxying `/api` to the backend) and the backend on port 3000 concurrently.

### Build & Production

```bash
npm run build    # builds the frontend
npm run start    # runs the backend serving the built frontend
```

## Architecture

**Frontend** (`frontend/`): React 19 + Vite single-page app with three views -- practice, browse (Explorar), and progress. Uses browser MediaRecorder for audio capture and localStorage for session/streak data.

**Backend** (`backend/`): Hono on `@hono/node-server` with SQLite (`better-sqlite3`, WAL mode). Serves API routes and built frontend static files. Auto-seeds the database on first run.

### API

| Method | Endpoint              | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/api/topics`         | List topics grouped by category      |
| POST   | `/api/topics`         | Create a topic                       |
| PUT    | `/api/topics/:id`     | Update a topic                       |
| DELETE | `/api/topics/:id`     | Delete a topic                       |
| GET    | `/api/chunks`         | List chunks grouped by category      |
| POST   | `/api/chunks`         | Create a chunk                       |
| PUT    | `/api/chunks/:id`     | Update a chunk                       |
| DELETE | `/api/chunks/:id`     | Delete a chunk                       |
| POST   | `/api/tts`            | Text-to-speech (proxies to Cartesia) |
| POST   | `/api/upload`         | Upload a recording                   |
| GET    | `/api/recordings/:id` | Retrieve a recording                 |

## Deployment

Deployed on Fly.io with a Docker multi-stage build. A persistent volume at `/data` stores the SQLite database and audio recordings. Config lives in `fly.toml` and `Dockerfile`.

## Roadmap

- **Speech-to-text** -- transcribe recordings with STT to enable conversational practice
- **LLM-powered conversations** -- use an LLM to generate dynamic practice dialogues around chunks and topics
- **Recording review** -- browse and replay past recordings from the progress view
- **Progress analysis** -- analyze recordings over time to measure fluency, accuracy, and improvement

## Formatting

```bash
npm run format         # auto-fix with Prettier
npm run format:check   # check only (runs in CI)
```

Prettier config: double quotes, semicolons, trailing commas, 100 char width, 2-space indent.
