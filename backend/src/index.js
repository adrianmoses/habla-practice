import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initDb } from "./db/schema.js";
import { seedDb } from "./db/seed.js";
import ttsRoutes from "./routes/tts.js";
import uploadRoutes from "./routes/upload.js";
import recordingsRoutes from "./routes/recordings.js";
import topicsRoutes from "./routes/topics.js";
import chunksRoutes from "./routes/chunks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "../../data");
const FRONTEND_DIR = join(__dirname, "../../frontend/dist");
const PORT = Number(process.env.PORT || 3000);

const db = initDb(join(DATA_DIR, "habla.db"));
seedDb(db);

const app = new Hono();

// API routes
app.route("/api", ttsRoutes());
app.route("/api", uploadRoutes(DATA_DIR));
app.route("/api", recordingsRoutes(DATA_DIR));
app.route("/api", topicsRoutes(db));
app.route("/api", chunksRoutes(db));

// Serve frontend static files
app.use("/*", serveStatic({ root: FRONTEND_DIR }));

// SPA fallback
app.get("*", serveStatic({ path: join(FRONTEND_DIR, "index.html") }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
