export async function onRequestPost(context) {
  const { request, env } = context;

  try {
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
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
