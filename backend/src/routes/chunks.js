import { Hono } from "hono";

export default function chunksRoutes(db) {
  const app = new Hono();

  app.get("/chunks", (c) => {
    const rows = db.prepare("SELECT * FROM chunks ORDER BY category, id").all();
    const grouped = [];
    const catMap = new Map();

    for (const row of rows) {
      if (!catMap.has(row.category)) {
        const entry = { cat: row.category, items: [] };
        catMap.set(row.category, entry);
        grouped.push(entry);
      }
      catMap.get(row.category).items.push({
        id: row.id,
        es: row.text_es,
        en: row.text_en,
      });
    }

    return c.json(grouped);
  });

  app.post("/chunks", async (c) => {
    const { category, text_es, text_en } = await c.req.json();
    const result = db
      .prepare("INSERT INTO chunks (category, text_es, text_en) VALUES (?, ?, ?)")
      .run(category, text_es, text_en);
    return c.json({ id: result.lastInsertRowid, category, text_es, text_en }, 201);
  });

  app.put("/chunks/:id", async (c) => {
    const id = c.req.param("id");
    const { category, text_es, text_en } = await c.req.json();
    db.prepare(
      "UPDATE chunks SET category = COALESCE(?, category), text_es = COALESCE(?, text_es), text_en = COALESCE(?, text_en) WHERE id = ?",
    ).run(category, text_es, text_en, id);
    return c.json({ ok: true });
  });

  app.delete("/chunks/:id", (c) => {
    const id = c.req.param("id");
    db.prepare("DELETE FROM chunks WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  return app;
}
