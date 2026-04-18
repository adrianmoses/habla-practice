import { useMemo, useState } from "react";

import { ApiError } from "../lib/api.js";
import * as api from "../lib/api.js";
import { slugify } from "../lib/format.js";

export default function ScenarioEditor({
  scenario,
  chunks,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
}) {
  const isEdit = Boolean(scenario);
  const [name, setName] = useState(scenario?.name ?? "");
  const [icon, setIcon] = useState(scenario?.icon ?? "");
  const [chunkIds, setChunkIds] = useState(() => (scenario?.chunks ?? []).map((c) => c.id));
  const [filter, setFilter] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const derivedSlug = useMemo(() => slugify(name), [name]);
  const filteredChunks = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return chunks;
    return chunks.filter((c) => {
      const hay = `${c.text_es} ${c.gloss_es ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [chunks, filter]);

  const canSave = name.trim().length > 0 && icon.trim().length > 0 && derivedSlug.length > 0;

  function toggleChunk(id) {
    setChunkIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError(null);
    const body = {
      slug: derivedSlug,
      name: name.trim(),
      icon: icon.trim(),
      chunk_ids: chunkIds,
    };
    try {
      if (isEdit) {
        await api.updateScenario(scenario.id, body);
        await onUpdated();
      } else {
        const created = await api.createScenario(body);
        await onCreated(created);
      }
    } catch (err) {
      setError(err instanceof ApiError ? String(err.detail) : err.message);
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    if (!window.confirm(`¿Eliminar el escenario "${scenario.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteScenario(scenario.id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? String(err.detail) : err.message);
      setBusy(false);
    }
  }

  return (
    <form className="overlay editor-screen" onSubmit={handleSubmit}>
      <div className="editor-header">
        <div className="editor-title">{isEdit ? "editar escenario" : "nuevo escenario"}</div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="cerrar">
          ×
        </button>
      </div>

      <div className="editor-body">
        {error && <div className="form-error">{error}</div>}

        <div className="field-row">
          <div className="field field-icon">
            <label className="input-label">icono</label>
            <input
              className="input"
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="☕"
              maxLength={8}
            />
          </div>
          <div className="field">
            <label className="input-label">nombre</label>
            <input
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bar de barrio"
              autoFocus
            />
          </div>
        </div>

        <div className="field">
          <label className="input-label">slug</label>
          <input className="input" type="text" value={derivedSlug} disabled readOnly />
        </div>

        <div className="chunk-select">
          <div className="input-label">frases del escenario · {chunkIds.length} seleccionadas</div>
          <input
            className="input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="buscar frase…"
          />
          <div className="chunk-select-list">
            {filteredChunks.length === 0 && (
              <div className="preview-empty" style={{ padding: "10px" }}>
                sin coincidencias
              </div>
            )}
            {filteredChunks.map((c) => {
              const on = chunkIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chunk-toggle${on ? " on" : ""}`}
                  onClick={() => toggleChunk(c.id)}
                >
                  <span className="chunk-toggle-mark">{on ? "✓" : ""}</span>
                  <span>{c.text_es}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="editor-footer">
        {isEdit && (
          <button type="button" className="btn-danger" onClick={handleDelete} disabled={busy}>
            eliminar
          </button>
        )}
        <button type="button" className="btn-sec" onClick={onClose} disabled={busy}>
          cancelar
        </button>
        <button type="submit" className="btn-pri" disabled={!canSave || busy}>
          {busy ? "guardando…" : "guardar"}
        </button>
      </div>
    </form>
  );
}
