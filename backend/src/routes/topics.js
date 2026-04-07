import { Hono } from "hono";

export default function topicsRoutes(db) {
  const app = new Hono();

  app.get("/topics", (c) => {
    const rows = db.prepare("SELECT * FROM topics ORDER BY category, id").all();
    const grouped = [];
    const catMap = new Map();

    for (const row of rows) {
      if (!catMap.has(row.category)) {
        const entry = { cat: row.category, items: [] };
        catMap.set(row.category, entry);
        grouped.push(entry);
      }
      catMap.get(row.category).items.push({ id: row.id, text: row.prompt_text });
    }

    return c.json(grouped);
  });

  app.post("/topics", async (c) => {
    const { category, prompt_text } = await c.req.json();
    const result = db
      .prepare("INSERT INTO topics (category, prompt_text) VALUES (?, ?)")
      .run(category, prompt_text);
    return c.json({ id: result.lastInsertRowid, category, prompt_text }, 201);
  });

  app.put("/topics/:id", async (c) => {
    const id = c.req.param("id");
    const { category, prompt_text } = await c.req.json();
    db.prepare(
      "UPDATE topics SET category = COALESCE(?, category), prompt_text = COALESCE(?, prompt_text) WHERE id = ?",
    ).run(category, prompt_text, id);
    return c.json({ ok: true });
  });

  app.delete("/topics/:id", (c) => {
    const id = c.req.param("id");
    db.prepare("DELETE FROM topics WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  return app;
}
