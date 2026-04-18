import { useMemo, useState } from "react";

import ChunkEditor from "../components/ChunkEditor.jsx";
import ChunkRow from "../components/ChunkRow.jsx";
import * as api from "../lib/api.js";
import { uniqueTags } from "../lib/format.js";

export default function Frases({ chunks, onChanged }) {
  const [activeTag, setActiveTag] = useState("todo");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const tags = useMemo(() => uniqueTags(chunks), [chunks]);
  const visible = useMemo(() => {
    if (activeTag === "todo") return chunks;
    return chunks.filter((c) => (c.tags ?? []).includes(activeTag));
  }, [chunks, activeTag]);

  async function handleCreate(body) {
    await api.createChunk(body);
    await onChanged();
    setCreating(false);
  }

  async function handleUpdate(id, body) {
    await api.updateChunk(id, body);
    await onChanged();
    setEditingId(null);
  }

  async function handleDelete(id) {
    await api.deleteChunk(id);
    await onChanged();
    setEditingId(null);
  }

  return (
    <div>
      <div className="filters">
        <button
          className={`fpill${activeTag === "todo" ? " active" : ""}`}
          onClick={() => setActiveTag("todo")}
        >
          todo
        </button>
        {tags.map((t) => (
          <button
            key={t}
            className={`fpill${activeTag === t ? " active" : ""}`}
            onClick={() => setActiveTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {creating && (
        <div style={{ marginBottom: 8 }}>
          <ChunkEditor onSave={handleCreate} onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="chunk-list">
        {visible.length === 0 && !creating && (
          <div className="hist-empty">sin frases en este filtro</div>
        )}
        {visible.map((c) =>
          editingId === c.id ? (
            <ChunkEditor
              key={c.id}
              chunk={c}
              onSave={(body) => handleUpdate(c.id, body)}
              onDelete={() => handleDelete(c.id)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <ChunkRow key={c.id} chunk={c} onClick={() => setEditingId(c.id)} />
          ),
        )}
      </div>

      {!creating && (
        <button className="add-row" style={{ marginTop: 10 }} onClick={() => setCreating(true)}>
          <span className="add-circle">+</span>
          nueva frase
        </button>
      )}
    </div>
  );
}
