import { useEffect, useRef, useState } from "react";

import { formatDuration } from "../lib/format.js";

const VOICE_BAR_DELAYS = [0, 0.11, 0.24, 0.06, 0.19, 0.03, 0.15, 0.29];

export default function LiveSession({ scenario, durationSec, onEnd }) {
  const [remaining, setRemaining] = useState(durationSec);
  const [paused, setPaused] = useState(false);
  const endedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining((r) => (paused ? r : r - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    if (remaining <= 0 && !endedRef.current) {
      endedRef.current = true;
      onEnd();
    }
  }, [remaining, onEnd]);

  const low = remaining < 60;

  return (
    <div className="overlay">
      <div className="sess-header">
        <div className="sess-scenario">{scenario.name}</div>
        <div className={`sess-timer${low ? " low" : ""}`}>
          {formatDuration(Math.max(0, remaining))}
        </div>
      </div>

      <div className="agent-zone">
        <div className="orb-wrap">
          <div className="ring" />
          <div className="ring" />
          <div className="orb">
            <div className="orb-core" />
          </div>
        </div>
        <div className="voice-bars">
          {VOICE_BAR_DELAYS.map((d, i) => (
            <div key={i} className="vbar" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
        <div className="agent-label">agente esperando…</div>
      </div>

      <div className="chunk-panel">
        <div className="cp-header">
          <span className="cp-label">frases del escenario</span>
          <span className="cp-count">0 / {scenario.chunks.length}</span>
        </div>
        <div className="cpills">
          {scenario.chunks.map((c) => (
            <div key={c.id} className="cpill">
              <div className="cpill-dot" />
              {c.text_es}
            </div>
          ))}
        </div>
      </div>

      <div className="sess-footer">
        <button
          className="btn-sec"
          onClick={() => {
            if (!endedRef.current) {
              endedRef.current = true;
              onEnd();
            }
          }}
        >
          terminar
        </button>
        <button className="btn-pri" onClick={() => setPaused((p) => !p)}>
          {paused ? "reanudar" : "pausa"}
        </button>
      </div>
    </div>
  );
}
