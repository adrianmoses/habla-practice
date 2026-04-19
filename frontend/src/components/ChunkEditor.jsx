import { useState } from "react";

import { ApiError } from "../lib/api.js";
import { parseTagsInput } from "../lib/format.js";

export default function ChunkEditor({ chunk, onSave, onDelete, onCancel }) {
  const isEdit = Boolean(chunk);
  const [textEs, setTextEs] = useState(chunk?.text_es ?? "");
  const [glossEs, setGlossEs] = useState(chunk?.gloss_es ?? "");
  const [tagsRaw, setTagsRaw] = useState((chunk?.tags ?? []).join(", "));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const canSave = textEs.trim().length > 0 && !busy;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        text_es: textEs.trim(),
        gloss_es: glossEs.trim() || null,
        tags: parseTagsInput(tagsRaw),
      });
    } catch (err) {
      setError(err instanceof ApiError ? String(err.detail) : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm("¿Eliminar esta frase?")) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof ApiError ? String(err.detail) : err.message);
      setBusy(false);
    }
  }

  return (
    <form className="chunk-editor" onSubmit={handleSubmit}>
      <div className="chunk-editor-title">{isEdit ? "editar frase" : "nueva frase"}</div>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label className="input-label">español</label>
        <input
          className="input"
          type="text"
          value={textEs}
          onChange={(e) => setTextEs(e.target.value)}
          placeholder="Venga, ponme un cortado"
          autoFocus
        />
      </div>
      <div className="field">
        <label className="input-label">gloss (opcional)</label>
        <input
          className="input"
          type="text"
          value={glossEs}
          onChange={(e) => setGlossEs(e.target.value)}
          placeholder="pedir con naturalidad"
        />
      </div>
      <div className="field">
        <label className="input-label">tags (separados por coma)</label>
        <input
          className="input"
          type="text"
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
          placeholder="bar, social"
        />
      </div>
      <div className="editor-actions">
        <button type="button" className="btn-sec" onClick={onCancel} disabled={busy}>
          cancelar
        </button>
        <button type="submit" className="btn-pri" disabled={!canSave}>
          {busy ? "guardando…" : "guardar"}
        </button>
        {isEdit && (
          <button type="button" className="btn-danger" onClick={handleDelete} disabled={busy}>
            eliminar
          </button>
        )}
      </div>
    </form>
  );
}
