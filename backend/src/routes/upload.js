import { Hono } from "hono";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default function uploadRoutes(dataDir) {
  const app = new Hono();

  app.post("/upload", async (c) => {
    try {
      const body = await c.req.parseBody();
      const audio = body.audio;
      const sessionId = body.sessionId;
      const metadata = JSON.parse(body.metadata || "{}");
      const date = metadata.date || new Date().toISOString().slice(0, 10);
      const key = `recordings/${date}/${sessionId}.webm`;

      const dir = join(dataDir, "recordings", date);
      mkdirSync(dir, { recursive: true });

      const buffer = Buffer.from(await audio.arrayBuffer());
      writeFileSync(join(dataDir, key), buffer);

      return c.json({ ok: true, key });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 500);
    }
  });

  return app;
}
