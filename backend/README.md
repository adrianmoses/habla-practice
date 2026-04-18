# habla-practice backend

Python 3.12 + FastAPI service. Managed with [uv](https://docs.astral.sh/uv/).

## Run

From the repo root:

```bash
npm run dev
```

This spawns Vite (5173) and uvicorn (3000) concurrently.

Or directly from this directory:

```bash
uv sync
uv run uvicorn habla.main:app --reload --port 3000
```

## Lint / typecheck / format

```bash
uv run ruff check
uv run ruff format
uv run pyright
```

## Tests

Harness is set up (`pytest` + `pytest-asyncio`); first tests land in Phase 5.

```bash
uv run pytest
```
