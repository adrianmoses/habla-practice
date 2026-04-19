# syntax=docker/dockerfile:1.7

# ---- Stage: Python base with deps installed ----
# Shared by dev (source mounted via volume) and runtime (source baked in).
FROM python:3.12-slim AS python-base

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /usr/local/bin/

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates build-essential \
  && rm -rf /var/lib/apt/lists/*

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app/backend

# Install deps first (cache layer). Pipecat + CPU torch add ~3GB, so keep this layer stable.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project

# ---- Dev target ----
# Source is volume-mounted at run time at /app/backend/src. Install the project in
# editable mode so the mount is the live source uvicorn --reload watches.
FROM python-base AS dev
# Copy the source once at build time so editable-install has something to link.
# The compose volume mount replaces this with the live host source.
COPY backend/src ./src
RUN uv sync --frozen
EXPOSE 3000
CMD ["uv", "run", "--frozen", "--no-sync", "uvicorn", "habla.main:app", \
     "--host", "0.0.0.0", "--port", "3000", "--reload", \
     "--reload-dir", "/app/backend/src"]

# ---- Frontend build (only used by runtime) ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Runtime (production) ----
FROM python-base AS runtime
COPY backend/src ./src
RUN uv sync --frozen --no-dev
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
EXPOSE 3000
CMD ["uv", "run", "--no-sync", "uvicorn", "habla.main:app", "--host", "0.0.0.0", "--port", "3000"]
