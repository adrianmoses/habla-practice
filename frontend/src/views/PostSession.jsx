import { useEffect, useRef, useState } from "react";

import { ApiError, assessSession, getSession } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";

const ASSESSMENTS = [
  { value: 0, emoji: "😬", label: "difícil" },
  { value: 1, emoji: "🤔", label: "regular" },
  { value: 2, emoji: "🙂", label: "bien" },
  { value: 3, emoji: "😎", label: "fluido" },
];

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TICKS = 20;

// Mirrors `SessionStatus` in backend/src/habla/db/schema.py.
// `complete` is forward-compat with Phase 6 (SRS); P5 only writes `judged`.
const TERMINAL_OK = new Set(["judged", "complete"]);

const PENDING_PHASES = new Set(["idle", "submitting", "polling", "timeout"]);
const TERMINAL_PHASES = new Set(["judged", "failed", "timeout"]);

const PRIMARY_LABEL = {
  submitting: "guardando…",
  polling: "analizando…",
  judged: "cerrar",
  failed: "cerrar",
  timeout: "cerrar",
};

export default function PostSession({ scenario, sessionId, onSave }) {
  const [assessment, setAssessment] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState(null);
  const [deployments, setDeployments] = useState({});
  const tickCountRef = useRef(0);

  useEffect(() => {
    if (phase !== "polling" || sessionId == null) return undefined;
    let cancelled = false;
    tickCountRef.current = 0;

    const tick = async () => {
      if (cancelled) return;
      tickCountRef.current += 1;
      try {
        const detail = await getSession(sessionId);
        if (cancelled) return;
        if (TERMINAL_OK.has(detail.analysis_status)) {
          const map = {};
          for (const d of detail.deployments) map[d.chunk_id] = d;
          setDeployments(map);
          setPhase("judged");
          return;
        }
        if (detail.analysis_status === "failed") {
          setPhase("failed");
          return;
        }
      } catch {
        // transient — keep polling until cap
      }
      if (tickCountRef.current >= POLL_MAX_TICKS && !cancelled) {
        setPhase("timeout");
      }
    };

    const id = setInterval(tick, POLL_INTERVAL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, sessionId]);

  const handleSave = async () => {
    if (assessment == null || sessionId == null) return;
    setPhase("submitting");
    setError(null);
    try {
      await assessSession(sessionId, { self_assessment: assessment });
      setPhase("polling");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : err.message || "no se pudo guardar");
      setPhase("idle");
    }
  };

  const renderStatus = (chunkId) => {
    if (PENDING_PHASES.has(phase)) return <div className="pc-status pc-pend">⏳</div>;
    if (phase === "failed") return <div className="pc-status pc-pend">—</div>;
    const verdict = deployments[chunkId];
    return verdict?.deployed ? (
      <div className="pc-status pc-yes">✓</div>
    ) : (
      <div className="pc-status pc-no">✗</div>
    );
  };

  const evidenceFor = (chunkId) => {
    if (phase !== "judged") return null;
    const v = deployments[chunkId];
    if (!v?.deployed || !v.evidence) return null;
    return <div className="pc-evidence">{v.evidence}</div>;
  };

  const isTerminal = TERMINAL_PHASES.has(phase);
  const primaryLabel = PRIMARY_LABEL[phase] ?? "guardar sesión";
  const primaryDisabled =
    phase === "submitting" ||
    phase === "polling" ||
    (phase === "idle" && (assessment == null || sessionId == null));
  const handlePrimary = isTerminal ? onSave : handleSave;

  return (
    <div className="overlay post-screen">
      <div className="post-header">
        <div className="post-title">resumen de sesión</div>
        <div className="post-sub">
          {scenario.name} · {formatDuration(0)}
        </div>
      </div>
      <div className="post-body">
        {phase !== "judged" && phase !== "failed" && (
          <div className="async-notice">
            <div className="notice-marker" />
            <div className="notice-body">
              {phase === "timeout"
                ? "el análisis está tardando — puedes salir, lo verás en historial cuando termine."
                : "La transcripción se está analizando. Las frases desplegadas se confirmarán en breve y actualizarán tu confianza en este escenario."}
            </div>
          </div>
        )}

        {phase === "failed" && (
          <div className="async-notice">
            <div className="notice-marker" />
            <div className="notice-body">no se pudo analizar — intenta más tarde.</div>
          </div>
        )}

        <div className="label">¿cómo fue?</div>
        <div className="self-assess">
          {ASSESSMENTS.map((a) => (
            <button
              key={a.value}
              className={`sa-btn${assessment === a.value ? ` sel-${a.value}` : ""}`}
              onClick={() => setAssessment(a.value)}
              disabled={phase !== "idle"}
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
              {renderStatus(c.id)}
              {evidenceFor(c.id)}
            </div>
          ))}
        </div>

        {error && <div className="post-error">{error}</div>}

        <button className="save-btn" onClick={handlePrimary} disabled={primaryDisabled}>
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
