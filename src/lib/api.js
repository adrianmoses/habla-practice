export async function uploadRecording(blob, sessionId, metadata) {
  const form = new FormData();
  form.append("audio", blob, `${sessionId}.webm`);
  form.append("sessionId", String(sessionId));
  form.append("metadata", JSON.stringify(metadata));
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}
