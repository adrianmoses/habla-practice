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


class ChunkInScenario(BaseModel):
    id: int
    text_es: str
    gloss_es: str | None
    tags: list[str]
    position: int


class ScenarioOut(BaseModel):
    id: int
    slug: str
    name: str
    icon: str
    chunks: list[ChunkInScenario]
    created_at: str


class ScenarioWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=1, max_length=120)
    icon: str = Field(min_length=1, max_length=8)
    chunk_ids: list[int] = Field(default_factory=list)


DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]


async def load_scenario(conn: aiosqlite.Connection, scenario_id: int) -> ScenarioOut:
    cur = await conn.execute(
        "SELECT id, slug, name, icon, created_at FROM scenarios WHERE id = ?",
        (scenario_id,),
    )
    row = await cur.fetchone()
    if row is None:
        raise HTTPException(404, f"Scenario {scenario_id} not found")

    cur = await conn.execute(
        """
        SELECT c.id, c.text_es, c.gloss_es, c.tags, sc.position
        FROM scenario_chunks sc
        JOIN chunks c ON c.id = sc.chunk_id
        WHERE sc.scenario_id = ?
        ORDER BY sc.position
        """,
        (scenario_id,),
    )
    chunk_rows = await cur.fetchall()
    chunks = [
        ChunkInScenario(
            id=cr["id"],
            text_es=cr["text_es"],
            gloss_es=cr["gloss_es"],
            tags=_split_tags(cr["tags"]),
            position=cr["position"],
        )
        for cr in chunk_rows
    ]
    return ScenarioOut(
        id=row["id"],
        slug=row["slug"],
        name=row["name"],
        icon=row["icon"],
        chunks=chunks,
        created_at=row["created_at"],
    )


async def _validate_chunk_ids(conn: aiosqlite.Connection, chunk_ids: list[int]) -> None:
    if not chunk_ids:
        return
    placeholders = ",".join("?" * len(chunk_ids))
    cur = await conn.execute(
        f"SELECT id FROM chunks WHERE id IN ({placeholders})",
        chunk_ids,
    )
    rows = await cur.fetchall()
    found = {row["id"] for row in rows}
    missing = [cid for cid in chunk_ids if cid not in found]
    if missing:
        raise HTTPException(400, f"Unknown chunk_ids: {missing}")


@router.get("/scenarios", response_model=list[ScenarioOut])
async def list_scenarios(conn: DbDep) -> list[ScenarioOut]:
    cur = await conn.execute("SELECT id, slug, name, icon, created_at FROM scenarios ORDER BY id")
    scenario_rows = await cur.fetchall()
    if not scenario_rows:
        return []

    scenario_ids = [row["id"] for row in scenario_rows]
    placeholders = ",".join("?" * len(scenario_ids))
    cur = await conn.execute(
        f"""
        SELECT sc.scenario_id, c.id, c.text_es, c.gloss_es, c.tags, sc.position
        FROM scenario_chunks sc
        JOIN chunks c ON c.id = sc.chunk_id
        WHERE sc.scenario_id IN ({placeholders})
        ORDER BY sc.scenario_id, sc.position
        """,
        scenario_ids,
    )
    chunk_rows = await cur.fetchall()

    by_scenario: dict[int, list[ChunkInScenario]] = {sid: [] for sid in scenario_ids}
    for cr in chunk_rows:
        by_scenario[cr["scenario_id"]].append(
            ChunkInScenario(
                id=cr["id"],
                text_es=cr["text_es"],
                gloss_es=cr["gloss_es"],
                tags=_split_tags(cr["tags"]),
                position=cr["position"],
            )
        )

    return [
        ScenarioOut(
            id=row["id"],
            slug=row["slug"],
            name=row["name"],
            icon=row["icon"],
            chunks=by_scenario[row["id"]],
            created_at=row["created_at"],
        )
        for row in scenario_rows
    ]


@router.post("/scenarios", status_code=201, response_model=ScenarioOut)
async def create_scenario(payload: ScenarioWrite, conn: DbDep) -> ScenarioOut:
    await _validate_chunk_ids(conn, payload.chunk_ids)
    try:
        cur = await conn.execute(
            "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)",
            (payload.slug, payload.name, payload.icon),
        )
        scenario_id = cur.lastrowid
        assert scenario_id is not None
        for position, chunk_id in enumerate(payload.chunk_ids):
            await conn.execute(
                "INSERT INTO scenario_chunks (scenario_id, chunk_id, position) VALUES (?, ?, ?)",
                (scenario_id, chunk_id, position),
            )
        await conn.commit()
    except aiosqlite.IntegrityError as exc:
        await conn.rollback()
        if "UNIQUE" in str(exc):
            raise HTTPException(409, f"slug '{payload.slug}' already exists") from exc
        raise
    return await load_scenario(conn, scenario_id)


@router.put("/scenarios/{scenario_id}", response_model=ScenarioOut)
async def update_scenario(scenario_id: int, payload: ScenarioWrite, conn: DbDep) -> ScenarioOut:
    cur = await conn.execute("SELECT 1 FROM scenarios WHERE id = ?", (scenario_id,))
    if await cur.fetchone() is None:
        raise HTTPException(404, f"Scenario {scenario_id} not found")

    await _validate_chunk_ids(conn, payload.chunk_ids)
    try:
        await conn.execute(
            "UPDATE scenarios SET slug = ?, name = ?, icon = ? WHERE id = ?",
            (payload.slug, payload.name, payload.icon, scenario_id),
        )
        await conn.execute("DELETE FROM scenario_chunks WHERE scenario_id = ?", (scenario_id,))
        for position, chunk_id in enumerate(payload.chunk_ids):
            await conn.execute(
                "INSERT INTO scenario_chunks (scenario_id, chunk_id, position) VALUES (?, ?, ?)",
                (scenario_id, chunk_id, position),
            )
        await conn.commit()
    except aiosqlite.IntegrityError as exc:
        await conn.rollback()
        if "UNIQUE" in str(exc):
            raise HTTPException(409, f"slug '{payload.slug}' already exists") from exc
        raise
    return await load_scenario(conn, scenario_id)


@router.delete("/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(scenario_id: int, conn: DbDep) -> Response:
    cur = await conn.execute("DELETE FROM scenarios WHERE id = ?", (scenario_id,))
    await conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"Scenario {scenario_id} not found")
    return Response(status_code=204)
