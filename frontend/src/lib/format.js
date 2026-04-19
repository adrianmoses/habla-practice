export function formatDuration(sec) {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function uniqueTags(chunks) {
  const set = new Set();
  for (const c of chunks) {
    for (const t of c.tags || []) set.add(t);
  }
  return Array.from(set).sort();
}

export function parseTagsInput(raw) {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
