import { useState } from "react";

import { assessSession } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";

const ASSESSMENTS = [
  { value: 0, emoji: "😬", label: "difícil" },
  { value: 1, emoji: "🤔", label: "regular" },
  { value: 2, emoji: "🙂", label: "bien" },
  { value: 3, emoji: "😎", label: "fluido" },
];

export default function PostSession({ scenario, sessionId, onSave }) {
  const [assessment, setAssessment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (assessment == null || sessionId == null) return;
    setSaving(true);
    setError(null);
    try {
      await assessSession(sessionId, { self_assessment: assessment });
      onSave();
    } catch (err) {
      setError(err.message || "no se pudo guardar");
      setSaving(false);
    }
  };

  return (
    <div className="overlay post-screen">
      <div className="post-header">
        <div className="post-title">resumen de sesión</div>
        <div className="post-sub">
          {scenario.name} · {formatDuration(0)}
        </div>
      </div>
      <div className="post-body">
        <div className="async-notice">
          <div className="notice-marker" />
          <div className="notice-body">
            La transcripción se está analizando. Las frases desplegadas se confirmarán en breve y
            actualizarán tu confianza en este escenario.
          </div>
        </div>

        <div className="label">¿cómo fue?</div>
        <div className="self-assess">
          {ASSESSMENTS.map((a) => (
            <button
              key={a.value}
              className={`sa-btn${assessment === a.value ? ` sel-${a.value}` : ""}`}
              onClick={() => setAssessment(a.value)}
              disabled={saving}
            >
              <span className="sa-emoji">{a.emoji}</span>
              {a.label}
            </button>
          ))}
        </div>

        <div className="label">frases del escenario</div>
        <div className="post-chunks">
          {scenario.chunks.map((c) => (
            <div key={c.id} className="pc-row">
              <div className="pc-es">{c.text_es}</div>
              <div className="pc-status pc-pend">⏳</div>
            </div>
          ))}
        </div>

        {error && <div className="post-error">{error}</div>}

        <button
          className="save-btn"
          onClick={handleSave}
          disabled={assessment == null || saving || sessionId == null}
        >
          {saving ? "guardando…" : "guardar sesión"}
        </button>
      </div>
    </div>
  );
}
