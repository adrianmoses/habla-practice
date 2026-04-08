import { Hono } from "hono";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export default function recordingsRoutes(dataDir) {
  const app = new Hono();

  app.get("/recordings/:id", (c) => {
    const key = c.req.query("key");

    if (!key) {
      return c.json({ error: "Missing key parameter" }, 400);
    }

    const filePath = join(dataDir, key);

    if (!existsSync(filePath)) {
      return c.json({ error: "Recording not found" }, 404);
    }

    const data = readFileSync(filePath);
    const stat = statSync(filePath);

    return new Response(data, {
      headers: {
        "Content-Type": "audio/webm",
        "Content-Length": String(stat.size),
      },
    });
  });

  return app;
}
