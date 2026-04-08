import { Hono } from "hono";

export default function ttsRoutes() {
  const app = new Hono();

  app.post("/tts", async (c) => {
    const { text } = await c.req.json();

    if (!text || typeof text !== "string") {
      return c.json({ error: "Missing text parameter" }, 400);
    }

    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      return c.json({ error: "TTS not configured" }, 503);
    }

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic",
        transcript: text,
        voice: {
          mode: "id",
          id: "538a8872-3799-4df5-b373-b78493b766c6",
        },
        language: "es",
        output_format: {
          container: "mp3",
          sample_rate: 44100,
          bit_rate: 128000,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Cartesia API error:", response.status, err);
      return c.json({ error: "TTS request failed" }, 502);
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  return app;
}
