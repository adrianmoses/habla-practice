export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return Response.json({ error: "Missing text parameter" }, { status: 400 });
    }

    if (!env.CARTESIA_API_KEY) {
      return Response.json({ error: "TTS not configured" }, { status: 503 });
    }

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
      return Response.json({ error: "TTS request failed" }, { status: 502 });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
