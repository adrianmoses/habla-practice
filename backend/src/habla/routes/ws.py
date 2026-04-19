"""WebSocket endpoint for a live voice session.

Close codes:
    4404 — session not found or not active
    4409 — another session is already active
"""

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime

import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.pipeline.runner import PipelineRunner
from starlette.websockets import WebSocketState

from habla.agent.pipeline import build_pipeline
from habla.config import settings
from habla.db.schema import SessionStatus
from habla.routes.scenarios import load_scenario

log = logging.getLogger(__name__)
router = APIRouter()


WS_CLOSE_SESSION_NOT_ACTIVE = 4404
WS_CLOSE_ALREADY_CONNECTED = 4409


@router.websocket("/ws/session/{session_id}")
async def session_ws(websocket: WebSocket, session_id: int) -> None:
    app = websocket.app
    conn: aiosqlite.Connection = app.state.db

    cur = await conn.execute(
        "SELECT scenario_id, started_at, duration_sec, analysis_status FROM sessions WHERE id = ?",
        (session_id,),
    )
    row = await cur.fetchone()
    if row is None or row["analysis_status"] != SessionStatus.ACTIVE:
        await websocket.close(code=WS_CLOSE_SESSION_NOT_ACTIVE)
        return

    active_ws: dict[int, WebSocket] = app.state.active_ws
    if active_ws:
        await websocket.close(code=WS_CLOSE_ALREADY_CONNECTED)
        return

    if settings.voice_stack_missing() or app.state.smart_turn is None or app.state.vad is None:
        await websocket.accept()
        await websocket.send_json(
            {"type": "error", "code": "misconfigured", "message": "voice stack unavailable"}
        )
        await websocket.close()
        return

    await websocket.accept()
    active_ws[session_id] = websocket
    started_at = row["started_at"]
    # +30s grace: client timer closes the WS first; server ceiling is the safety net.
    max_duration = row["duration_sec"] + 30
    scenario = await load_scenario(conn, row["scenario_id"])

    bundle = None
    final_status = SessionStatus.FAILED
    try:
        bundle = build_pipeline(
            websocket=websocket,
            scenario=scenario,
            vad=app.state.vad,
            smart_turn=app.state.smart_turn,
            session_timeout_secs=max_duration,
        )
        log.info(
            "session_ws open session_id=%d scenario=%s fp=%s",
            session_id,
            scenario.slug,
            bundle.system_prompt_fingerprint,
        )

        @bundle.transport.event_handler("on_client_connected")
        async def _on_connected(_transport, _ws) -> None:
            await bundle.task.queue_frames([LLMRunFrame()])

        runner = PipelineRunner(handle_sigint=False)
        await asyncio.wait_for(runner.run(bundle.task), timeout=max_duration)
        final_status = SessionStatus.PENDING
    except TimeoutError:
        log.info("session_ws timeout session_id=%d", session_id)
        if bundle is not None:
            with contextlib.suppress(Exception):
                await bundle.task.queue_frames([EndFrame()])
        final_status = SessionStatus.PENDING
    except WebSocketDisconnect:
        log.info("session_ws peer closed session_id=%d", session_id)
    except Exception:
        log.exception("session_ws error session_id=%d", session_id)
    finally:
        active_ws.pop(session_id, None)
        ended_dt = datetime.now(UTC)
        duration = int((ended_dt - datetime.fromisoformat(started_at)).total_seconds())
        turns = bundle.turns if bundle is not None else []
        transcript = json.dumps(
            [
                {"role": t.role, "text": t.text, "started_at": t.started_at, "ended_at": t.ended_at}
                for t in turns
            ],
            ensure_ascii=False,
        )
        await conn.execute(
            "UPDATE sessions "
            "SET transcript = ?, ended_at = ?, duration_sec = ?, analysis_status = ? "
            "WHERE id = ?",
            (transcript, ended_dt.isoformat(), duration, final_status, session_id),
        )
        await conn.commit()
        if websocket.client_state != WebSocketState.DISCONNECTED:
            with contextlib.suppress(RuntimeError):
                await websocket.close()
