from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from habla.db.connection import get_db

router = APIRouter()


def _split_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [t.strip() for t in raw.split(",") if t.strip()]


def _join_tags(tags: list[str]) -> str:
    return ",".join(t.strip() for t in tags if t.strip())


class ChunkOut(BaseModel):
    id: int
    text_es: str
    gloss_es: str | None
    tags: list[str]
    rep_count: int
    created_at: str


class ChunkWrite(BaseModel):
    text_es: str = Field(min_length=1)
    gloss_es: str | None = None
    tags: list[str] = Field(default_factory=list)


DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]


async def _load_chunk(conn: aiosqlite.Connection, chunk_id: int) -> ChunkOut:
    cur = await conn.execute(
        "SELECT c.id, c.text_es, c.gloss_es, c.tags, c.created_at, "
        "       COALESCE(SUM(d.deployed), 0) AS rep_count "
        "FROM chunks c "
        "LEFT JOIN chunk_deployments d ON d.chunk_id = c.id "
        "WHERE c.id = ? "
        "GROUP BY c.id",
        (chunk_id,),
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, f"Chunk {chunk_id} not found")
    return ChunkOut(
        id=row["id"],
        text_es=row["text_es"],
        gloss_es=row["gloss_es"],
        tags=_split_tags(row["tags"]),
        rep_count=row["rep_count"],
        created_at=row["created_at"],
    )


@router.get("/chunks", response_model=list[ChunkOut])
async def list_chunks(conn: DbDep) -> list[ChunkOut]:
    cur = await conn.execute(
        "SELECT c.id, c.text_es, c.gloss_es, c.tags, c.created_at, "
        "       COALESCE(SUM(d.deployed), 0) AS rep_count "
        "FROM chunks c "
        "LEFT JOIN chunk_deployments d ON d.chunk_id = c.id "
        "GROUP BY c.id "
        "ORDER BY c.id"
    )
    rows = await cur.fetchall()
    return [
        ChunkOut(
            id=row["id"],
            text_es=row["text_es"],
            gloss_es=row["gloss_es"],
            tags=_split_tags(row["tags"]),
            rep_count=row["rep_count"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


@router.post("/chunks", status_code=201, response_model=ChunkOut)
async def create_chunk(payload: ChunkWrite, conn: DbDep) -> ChunkOut:
    cur = await conn.execute(
        "INSERT INTO chunks (text_es, gloss_es, tags) VALUES (?, ?, ?)",
        (payload.text_es, payload.gloss_es, _join_tags(payload.tags)),
    )
    chunk_id = cur.lastrowid
    assert chunk_id is not None
    await conn.commit()
    return await _load_chunk(conn, chunk_id)


@router.put("/chunks/{chunk_id}", response_model=ChunkOut)
async def update_chunk(chunk_id: int, payload: ChunkWrite, conn: DbDep) -> ChunkOut:
    cur = await conn.execute(
        "UPDATE chunks SET text_es = ?, gloss_es = ?, tags = ? WHERE id = ?",
        (payload.text_es, payload.gloss_es, _join_tags(payload.tags), chunk_id),
    )
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Chunk {chunk_id} not found")
    return await _load_chunk(conn, chunk_id)


@router.delete("/chunks/{chunk_id}", status_code=204)
async def delete_chunk(chunk_id: int, conn: DbDep) -> Response:
    cur = await conn.execute("DELETE FROM chunks WHERE id = ?", (chunk_id,))
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Chunk {chunk_id} not found")
    return Response(status_code=204)
