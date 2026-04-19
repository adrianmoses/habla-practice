import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from habla.config import settings
from habla.db.connection import close_db, open_db
from habla.db.schema import SessionStatus, create_all
from habla.db.seed import seed_if_empty
from habla.routes import chunks as chunks_routes
from habla.routes import scenarios as scenarios_routes
from habla.routes import sessions as sessions_routes
from habla.routes import ws as ws_routes
from habla.util import iso_now

REPO_ROOT = Path(__file__).resolve().parents[3]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    conn = await open_db(settings.db_path)
    await create_all(conn)
    await seed_if_empty(conn)
    app.state.db = conn
    app.state.active_ws = {}

    # Any session still marked `active` at startup is stale — the server died or
    # restarted mid-session. The in-memory active_ws dict is the source of truth
    # for "live right now"; the DB row just tracks intent.
    cur = await conn.execute(
        "UPDATE sessions SET analysis_status = ?, ended_at = COALESCE(ended_at, ?) "
        "WHERE analysis_status = ?",
        (SessionStatus.FAILED, iso_now(), SessionStatus.ACTIVE),
    )
    if cur.rowcount:
        log.warning("swept %d stale active session(s) on startup", cur.rowcount)
    await conn.commit()

    # Smart-turn + Silero VAD models loaded once at startup; shared across sessions.
    # Guarded so tests and HTTP-only flows can run without Pipecat installed.
    app.state.smart_turn = None
    app.state.vad = None
    try:
        from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
        from pipecat.audio.vad.silero import SileroVADAnalyzer

        app.state.smart_turn = LocalSmartTurnAnalyzerV3()
        app.state.vad = SileroVADAnalyzer()
        log.info("voice analyzers loaded")
    except ImportError:
        log.warning("pipecat not installed — voice sessions disabled")

    try:
        yield
    finally:
        await close_db(conn)


app = FastAPI(lifespan=lifespan, title="Habla Practice")

app.include_router(scenarios_routes.router, prefix="/api")
app.include_router(chunks_routes.router, prefix="/api")
app.include_router(sessions_routes.router, prefix="/api")
app.include_router(ws_routes.router)


if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def spa_fallback(full_path: str) -> FileResponse:
        # Unknown /api/* paths must return JSON 404, not the SPA shell.
        if full_path.startswith("api/") or full_path == "api":
            raise HTTPException(404, f"Unknown API path: /{full_path}")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
