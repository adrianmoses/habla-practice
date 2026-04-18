"""Seed data for starter scenarios.

Chunks were authored following `docs/prompts/madrid-chunk-seed.md`. Refine as needed.
"""

import aiosqlite

SCENARIOS: list[dict] = [
    {
        "slug": "bar-de-barrio",
        "name": "Bar de barrio",
        "icon": "☕",
        "chunks": [
            {
                "text_es": "Ponme una cañita",
                "gloss_es": "pedir una cerveza pequeña al camarero",
                "tags": ["bar", "pedir"],
            },
            {
                "text_es": "¿Me pones un cortado?",
                "gloss_es": "pedir café con un poco de leche",
                "tags": ["bar", "pedir"],
            },
            {
                "text_es": "Una de bravas, porfa",
                "gloss_es": "pedir una ración de patatas bravas",
                "tags": ["bar", "pedir", "casual"],
            },
            {
                "text_es": "¿Qué me recomiendas?",
                "gloss_es": "pedir consejo al camarero sobre la carta",
                "tags": ["bar", "social"],
            },
            {
                "text_es": "Ponme lo mismo",
                "gloss_es": "pedir otra ronda igual que la anterior",
                "tags": ["bar", "pedir", "casual"],
            },
            {
                "text_es": "¿Me cobras, por favor?",
                "gloss_es": "pedir la cuenta al camarero",
                "tags": ["bar", "cortés"],
            },
        ],
    },
    {
        "slug": "mercado-tienda",
        "name": "Mercado / tienda",
        "icon": "🏪",
        "chunks": [
            {
                "text_es": "¿A cuánto está el kilo?",
                "gloss_es": "preguntar el precio por kilo",
                "tags": ["tienda", "precio"],
            },
            {
                "text_es": "Ponme medio kilo de tomates",
                "gloss_es": "hacer un pedido por peso",
                "tags": ["tienda", "pedir"],
            },
            {
                "text_es": "¿Está bien de madurito?",
                "gloss_es": "preguntar si la fruta está en su punto",
                "tags": ["tienda", "casual"],
            },
            {
                "text_es": "¿Tienes algo más barato?",
                "gloss_es": "preguntar por una opción más económica",
                "tags": ["tienda", "precio"],
            },
            {
                "text_es": "Con esto ya está",
                "gloss_es": "indicar al vendedor que no quieres nada más",
                "tags": ["tienda", "casual"],
            },
            {
                "text_es": "¿Cuánto es todo?",
                "gloss_es": "pedir el total al pagar",
                "tags": ["tienda", "precio"],
            },
        ],
    },
    {
        "slug": "casero-vecinos",
        "name": "Casero / vecinos",
        "icon": "🏠",
        "chunks": [
            {
                "text_es": "Oye, hay una fuga en el baño",
                "gloss_es": "avisar al casero de un problema de agua",
                "tags": ["vivienda", "queja"],
            },
            {
                "text_es": "¿Cuándo puedes pasarte a verlo?",
                "gloss_es": "pedir al casero que venga a revisar",
                "tags": ["vivienda", "cortés"],
            },
            {
                "text_es": "Llevo días sin agua caliente",
                "gloss_es": "describir un problema que dura varios días",
                "tags": ["vivienda", "queja"],
            },
            {
                "text_es": "¿Se puede hacer algo con el ruido?",
                "gloss_es": "quejarse del ruido de un vecino o la calle",
                "tags": ["vivienda", "queja", "social"],
            },
            {
                "text_es": "Buenas, ¿qué tal?",
                "gloss_es": "saludar a un vecino de forma cercana",
                "tags": ["social", "casual"],
            },
            {
                "text_es": "Pues nada, gracias por avisar",
                "gloss_es": "cerrar una conversación con agradecimiento",
                "tags": ["social", "cortés"],
            },
        ],
    },
    {
        "slug": "metro-transporte",
        "name": "Metro / transporte",
        "icon": "🚇",
        "chunks": [
            {
                "text_es": "Perdona, ¿esto va al centro?",
                "gloss_es": "confirmar el destino de un tren o autobús",
                "tags": ["transporte", "direcciones"],
            },
            {
                "text_es": "¿Por dónde se sale?",
                "gloss_es": "pedir indicaciones para la salida del metro",
                "tags": ["transporte", "direcciones"],
            },
            {
                "text_es": "Creo que me he pasado de parada",
                "gloss_es": "darse cuenta de haber pasado la parada destino",
                "tags": ["transporte", "casual"],
            },
            {
                "text_es": "¿Cuánto queda para Sol?",
                "gloss_es": "preguntar cuántas paradas faltan",
                "tags": ["transporte", "direcciones"],
            },
            {
                "text_es": "¿Está libre este sitio?",
                "gloss_es": "preguntar si se puede ocupar un asiento",
                "tags": ["transporte", "social", "cortés"],
            },
            {
                "text_es": "Una de diez viajes, por favor",
                "gloss_es": "comprar una tarjeta de diez viajes en taquilla",
                "tags": ["transporte", "pedir", "cortés"],
            },
        ],
    },
]


async def seed_if_empty(conn: aiosqlite.Connection) -> None:
    cur = await conn.execute("SELECT COUNT(*) FROM scenarios")
    row = await cur.fetchone()
    assert row is not None
    (count,) = row
    if count > 0:
        return

    for scenario in SCENARIOS:
        cur = await conn.execute(
            "INSERT INTO scenarios (slug, name, icon) VALUES (?, ?, ?)",
            (scenario["slug"], scenario["name"], scenario["icon"]),
        )
        scenario_id = cur.lastrowid
        for position, chunk in enumerate(scenario["chunks"]):
            cur = await conn.execute(
                "INSERT INTO chunks (text_es, gloss_es, tags) VALUES (?, ?, ?)",
                (chunk["text_es"], chunk["gloss_es"], ",".join(chunk["tags"])),
            )
            chunk_id = cur.lastrowid
            await conn.execute(
                "INSERT INTO scenario_chunks (scenario_id, chunk_id, position) VALUES (?, ?, ?)",
                (scenario_id, chunk_id, position),
            )
    await conn.commit()
