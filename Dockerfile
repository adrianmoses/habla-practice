# syntax=docker/dockerfile:1.7

# ---- Stage 1: build the React frontend ----
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /usr/local/bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app/backend

# Install deps first (cache layer) — copy only the lock + manifest.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Now copy the package source and install the project itself.
COPY backend/src ./src
RUN uv sync --frozen --no-dev

# Frontend dist — main.py resolves <repo_root>/frontend/dist from /app/backend/src/habla/main.py.
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

EXPOSE 3000
CMD ["uv", "run", "--no-sync", "uvicorn", "habla.main:app", "--host", "0.0.0.0", "--port", "3000"]
