from pathlib import Path

import aiosqlite
from fastapi import Request


async def open_db(path: Path) -> aiosqlite.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(path)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode = WAL")
    await conn.execute("PRAGMA foreign_keys = ON")
    await conn.execute("PRAGMA synchronous = NORMAL")
    return conn


async def close_db(conn: aiosqlite.Connection) -> None:
    await conn.close()


def get_db(request: Request) -> aiosqlite.Connection:
    return request.app.state.db
