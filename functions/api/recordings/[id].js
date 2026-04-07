export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!key) {
    return Response.json({ error: "Missing key parameter" }, { status: 400 });
  }

  const object = await env.RECORDINGS.get(key);

  if (!object) {
    return Response.json({ error: "Recording not found" }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": "audio/webm",
      "Content-Length": object.size,
    },
  });
}
