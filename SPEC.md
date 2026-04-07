# habla.practice — Vite + Cloudflare Workers Spec

## Overview

Convert the single-file `habla_practice.jsx` React app into a production Vite project deployed to **Cloudflare Workers (Pages)** with audio upload to **Cloudflare R2**, all UI/content in **Spanish**, and **Cartesia TTS** for voicing topic prompts.

---

## 1. Project Structure

```
habla-practice/
├── public/
├── src/
│   ├── main.jsx                  # Vite entry point
│   ├── App.jsx                   # Root component (router between views)
│   ├── data/
│   │   ├── topics.js             # TOPICS array (Spanish-only text)
│   │   └── chunks.js             # CHUNKS array (es + en pairs, unchanged)
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── TabBar.jsx
│   │   ├── PracticeView.jsx      # Prompt card, recorder, rating
│   │   ├── BrowseView.jsx        # Browse topics & chunks
│   │   ├── ProgressView.jsx      # Stats & session log
│   │   ├── PromptCard.jsx        # Displays topic or chunk drill
│   │   ├── Recorder.jsx          # Mic record / playback / timer
│   │   ├── RatingPanel.jsx       # Post-recording self-rating
│   │   ├── TtsButton.jsx         # Cartesia TTS playback button
│   │   └── icons.jsx             # SVG icon components
│   ├── hooks/
│   │   ├── useRecorder.js        # MediaRecorder + timer logic
│   │   └── useStorage.js         # KV/localStorage persistence
│   ├── lib/
│   │   ├── storage.js            # Abstract storage (localStorage in browser, KV in worker)
│   │   ├── api.js                # Client-side fetch helpers for /api/* routes
│   │   └── utils.js              # rand(), fmtTime(), today()
│   └── styles/
│       └── global.css            # CSS variables, dark mode, component classes
├── functions/                    # Cloudflare Pages Functions (Workers)
│   └── api/
│       ├── upload.js             # POST: upload audio blob to R2
│       ├── recordings/
│       │   └── [id].js           # GET: presigned URL / stream from R2
│       └── tts.js                # POST: Cartesia TTS proxy
├── wrangler.toml                 # Cloudflare config (R2 binding, env vars)
├── vite.config.js
├── package.json
├── index.html
└── .dev.vars                     # Local dev secrets (CARTESIA_API_KEY)
```

---

## 2. Vite + Cloudflare Workers Setup

### 2.1 Tooling

- **Vite** with `@vitejs/plugin-react`
- **Cloudflare Pages** with Functions (`functions/` directory convention)
- Deploy via `wrangler pages deploy` or connect to Git for CI/CD

### 2.2 `wrangler.toml`

```toml
name = "habla-practice"
compatibility_date = "2024-12-01"

[[r2_buckets]]
binding = "RECORDINGS"
bucket_name = "habla-recordings"

[vars]
# Non-secret vars here

# Secrets set via `wrangler secret put`:
# CARTESIA_API_KEY
```

### 2.3 `vite.config.js`

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
```

### 2.4 Local Development

```bash
# Install
npm install

# Dev — runs Vite + local Workers runtime
npx wrangler pages dev -- npx vite dev

# Deploy
npx wrangler pages deploy dist
```

---

## 3. Audio Recording & R2 Upload

### 3.1 Recording Flow

1. User clicks **"Grabar"** (Record) — `MediaRecorder` captures `audio/webm`.
2. User clicks **"Detener"** (Stop) — blob is created, playback available locally.
3. User rates the session — on save, the audio blob is uploaded to R2 via `POST /api/upload`.

### 3.2 `POST /api/upload` (Cloudflare Pages Function)

```
functions/api/upload.js
```

**Request:** `multipart/form-data` with fields:
- `audio` — the webm blob
- `sessionId` — unique session identifier (timestamp-based)
- `metadata` — JSON string: `{ date, mode, cat, prompt, duration, rating }`

**Handler logic:**
1. Read the audio blob from the multipart body.
2. Generate R2 key: `recordings/{date}/{sessionId}.webm`
3. `PUT` to R2 via the `RECORDINGS` binding with custom metadata headers.
4. Return `{ ok: true, key }`.

**Example implementation:**

```js
export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();
  const audio = formData.get("audio");
  const sessionId = formData.get("sessionId");
  const metadata = JSON.parse(formData.get("metadata") || "{}");
  const date = metadata.date || new Date().toISOString().slice(0, 10);
  const key = `recordings/${date}/${sessionId}.webm`;

  await env.RECORDINGS.put(key, audio.stream(), {
    httpMetadata: { contentType: "audio/webm" },
    customMetadata: metadata,
  });

  return Response.json({ ok: true, key });
}
```

### 3.3 `GET /api/recordings/:id` (Optional: playback from R2)

- Retrieve a recording by key for future playback/review.
- Stream the R2 object directly as a response with appropriate `Content-Type`.

### 3.4 Client-Side Upload (`src/lib/api.js`)

```js
export async function uploadRecording(blob, sessionId, metadata) {
  const form = new FormData();
  form.append("audio", blob, `${sessionId}.webm`);
  form.append("sessionId", sessionId);
  form.append("metadata", JSON.stringify(metadata));
  const res = await fetch("/api/upload", { method: "POST", body: form });
  return res.json();
}
```

### 3.5 Session Save Flow (updated `saveSession`)

```
1. Create session object (same as current, plus `id` used as sessionId)
2. Upload audio blob → POST /api/upload
3. Save session metadata to localStorage (or KV in future)
4. Update streak, clear UI state
```

---

## 4. Spanish-Only UI & Content

### 4.1 All UI Text in Spanish

Every user-facing string must be in Spanish. Translation table:

| Current (English)              | Spanish                          |
|-------------------------------|----------------------------------|
| "Practice"                    | "Practicar"                      |
| "Browse"                      | "Explorar"                       |
| "Progress"                    | "Progreso"                       |
| "Explain It Simply"           | "Explica con Tus Palabras"       |
| "Chunk Drill"                 | "Frases Clave"                   |
| "New"                         | "Nuevo"                          |
| "Start Recording"             | "Grabar"                         |
| "Stop"                        | "Detener"                        |
| "Play back"                   | "Reproducir"                     |
| "Pause"                       | "Pausar"                         |
| "Save"                        | "Guardar"                        |
| "How did that feel?"          | "¿Cómo te fue?"                  |
| "Struggled"                   | "Me costó"                       |
| "Okay"                        | "Más o menos"                    |
| "Felt easy"                   | "Me salió bien"                  |
| "day streak"                  | "racha de días"                  |
| "Streak"                      | "Racha"                          |
| "Sessions"                    | "Sesiones"                       |
| "Total Time"                  | "Tiempo Total"                   |
| "Recent Sessions"             | "Sesiones Recientes"             |
| "No sessions yet..."          | "Aún no hay sesiones. ¡A practicar!" |
| "Today: X sessions..."        | "Hoy: X sesión(es) · ..."       |
| "Reset Progress"              | "Borrar Progreso"                |
| "Clear all progress data?"    | "¿Borrar todos los datos de progreso?" |
| "Tap a phrase to reveal..."   | "Toca una frase para ver la traducción" |
| "Activate your Spanish vocabulary" | "Activa tu vocabulario en español" |
| "phrases"                     | "frases"                         |
| "Loading..."                  | "Cargando..."                    |

### 4.2 Topics — Translate to Spanish

All topic category names and topic items must be translated to Spanish. Example:

```js
// Before
{ cat: "Everyday Life", items: ["How you make your morning coffee or tea", ...] }

// After
{ cat: "Vida Cotidiana", items: ["Cómo preparas tu café o té por la mañana", ...] }
```

**All 9 topic categories and their 10 items each (90 total) must be translated.**

Category translations:
| English               | Spanish                     |
|-----------------------|-----------------------------|
| Everyday Life         | Vida Cotidiana              |
| People & Relationships| Personas y Relaciones       |
| How Things Work       | Cómo Funcionan las Cosas    |
| Opinions              | Opiniones                   |
| Describe & Compare    | Describir y Comparar        |
| Hypothetical          | Hipotéticos                 |
| Culture & Society     | Cultura y Sociedad          |
| Storytelling          | Narrativa                   |
| Abstract              | Abstracto                   |

### 4.3 Chunks — Translate Category Names

Chunk category names should be translated to Spanish. The `es`/`en` phrase pairs remain as-is (they are already bilingual by design).

| English                 | Spanish                    |
|-------------------------|----------------------------|
| Programming             | Programación               |
| Brushing Teeth          | Lavarse los Dientes        |
| Meditation              | Meditación                 |
| Lifting Weights         | Levantar Pesas             |
| Food Prep               | Preparar Comida            |
| Preparing Coffee        | Preparar Café              |
| Emails & Messages       | Correos y Mensajes         |
| Clothes                 | Ropa                       |
| Cleaning                | Limpieza                   |
| Maintenance             | Mantenimiento              |
| Directions              | Direcciones                |
| Food Order              | Pedir Comida               |
| Walking the City        | Pasear por la Ciudad       |
| Doctor                  | Médico                     |
| Tax Advisor             | Asesor Fiscal              |
| Software Presentation   | Presentación de Software   |

---

## 5. Cartesia TTS Integration

### 5.1 Purpose

When a topic prompt is displayed, the user can press a **speaker button** to hear the topic read aloud in Spanish via Cartesia's TTS API. This helps with pronunciation and listening comprehension.

### 5.2 Where TTS Appears

- **Topic mode:** A speaker icon button next to the topic text. Reads the full topic prompt.
- **Chunk mode:** A speaker icon button on each chunk phrase row. Reads the `es` text.

### 5.3 `POST /api/tts` (Server-Side Proxy)

The Cartesia API key must stay secret, so TTS requests are proxied through a Worker function.

```
functions/api/tts.js
```

**Request:**
```json
{
  "text": "Cómo preparas tu café por la mañana",
  "language": "es"
}
```

**Handler logic:**
1. Read `text` from request body.
2. Call Cartesia TTS API (`https://api.cartesia.ai/tts/bytes`) with:
   - `model_id`: `"sonic"` (or latest Cartesia model)
   - `transcript`: the Spanish text
   - `voice`: a Spanish-language voice (e.g., a pre-selected voice ID for natural Spanish)
   - `output_format`: `{ "container": "mp3", "sample_rate": 44100, "bit_rate": 128000 }`
   - Header: `X-API-Key: <CARTESIA_API_KEY>`
3. Stream the audio bytes back to the client.

**Example implementation:**

```js
export async function onRequestPost(context) {
  const { request, env } = context;
  const { text } = await request.json();

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "X-API-Key": env.CARTESIA_API_KEY,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic",
      transcript: text,
      voice: {
        mode: "id",
        id: "__spanish_voice_id__", // Replace with a chosen Spanish voice
      },
      language: "es",
      output_format: {
        container: "mp3",
        sample_rate: 44100,
        bit_rate: 128000,
      },
    }),
  });

  return new Response(response.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
```

### 5.4 `TtsButton.jsx` Component

```jsx
// Speaker icon button that fetches and plays TTS audio
// Props: text (string) — the Spanish text to speak

// Behavior:
// 1. On click, POST to /api/tts with { text }
// 2. Receive audio/mpeg blob
// 3. Create object URL, play via <audio> element
// 4. Show loading spinner while fetching
// 5. Cache blobs in a Map to avoid re-fetching identical text
```

### 5.5 Voice Selection

- Choose a Cartesia voice with native Spanish (Castilian or Latin American) support.
- Store the voice ID as a constant or env var.
- Future enhancement: let user pick voice variant in settings.

---

## 6. Data & Storage

### 6.1 Session Metadata

Stored in **localStorage** (browser-side). Same schema as current, with added `r2Key`:

```ts
interface Session {
  id: number;          // Date.now() timestamp
  date: string;        // "2026-04-07"
  mode: string;        // "topics" | "chunks"
  cat: string;         // Category name (in Spanish)
  prompt: string;      // Topic text or chunk phrases
  duration: number;    // Seconds
  rating: string;      // "Me costó" | "Más o menos" | "Me salió bien"
  r2Key?: string;      // R2 object key for the recording
}
```

### 6.2 Future: KV-Backed Storage

- For multi-device sync, migrate session data to **Cloudflare KV** keyed by a user identifier.
- Out of scope for initial version; localStorage is sufficient.

---

## 7. Deployment Checklist

1. **Create R2 bucket:**
   ```bash
   wrangler r2 bucket create habla-recordings
   ```

2. **Set secrets:**
   ```bash
   wrangler secret put CARTESIA_API_KEY
   ```

3. **Local dev secrets** (`.dev.vars`):
   ```
   CARTESIA_API_KEY=your_key_here
   ```

4. **Build & deploy:**
   ```bash
   npm run build
   npx wrangler pages deploy dist
   ```

5. **Verify:**
   - App loads at deployed URL
   - Recording works and uploads to R2
   - TTS plays Spanish audio for topics and chunks
   - All UI text is in Spanish
   - Dark mode works
   - Streak and session persistence works

---

## 8. Dependencies

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0",
    "wrangler": "^3.0.0"
  }
}
```

No additional runtime dependencies required. The app is intentionally lightweight.

---

## 9. Non-Goals (Out of Scope)

- User authentication / accounts
- Server-side session storage (KV) — future enhancement
- Speech-to-text / pronunciation grading
- Spaced repetition algorithm
- Offline PWA support
- Multiple language support (Spanish only)
