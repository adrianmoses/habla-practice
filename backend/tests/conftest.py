"""Shared pytest fixtures.

`db` provides a fresh in-memory aiosqlite connection with the schema applied.
`app_client` is a small builder for tests that need to mount one of the route
modules behind an `httpx.AsyncClient`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiosqlite
import pytest_asyncio
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from habla.db.schema import create_all


@pytest_asyncio.fixture
async def db() -> AsyncIterator[aiosqlite.Connection]:
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await create_all(conn)
    try:
        yield conn
    finally:
        await conn.close()


@asynccontextmanager
async def build_test_app(router: APIRouter) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    """Spin up a FastAPI app with one router + an in-memory DB on app.state.

    The app's lifespan opens its own connection (independent of the `db` fixture)
    so route handlers using the `get_db` dependency see consistent state.
    """

    @asynccontextmanager
    async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        await create_all(conn)
        app.state.db = conn
        app.state.active_ws = {}
        try:
            yield
        finally:
            await conn.close()

    app = FastAPI(lifespan=_lifespan)
    app.include_router(router, prefix="/api")
    async with (
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        app.router.lifespan_context(app),
    ):
        yield app, client
