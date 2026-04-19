import { useEffect, useRef, useState } from "react";

import { startSession } from "../lib/api.js";
import { formatDuration } from "../lib/format.js";
import { createVoiceSession } from "../lib/voice.js";

const VOICE_BAR_DELAYS = [0, 0.11, 0.24, 0.06, 0.19, 0.03, 0.15, 0.29];

const LABEL_BY_STATE = {
  connecting: "conectando…",
  ready: "preparando agente…",
  listening: "escuchando…",
  thinking: "pensando…",
  speaking: "hablando…",
};

const ERROR_TITLES = {
  "mic-denied": "no hay micrófono",
};

const ERROR_BODIES = {
  "mic-denied":
    "Necesitamos acceso al micrófono para la sesión. Concede permiso o conecta un micrófono y vuelve a intentarlo.",
};

export default function LiveSession({ scenario, durationSec, onEnd }) {
  const [remaining, setRemaining] = useState(durationSec);
  const [state, setState] = useState("connecting");
  const [lastTurn, setLastTurn] = useState(null);
  const [error, setError] = useState(null);

  const voiceRef = useRef(null);
  const sessionIdRef = useRef(null);
  const endedRef = useRef(false);

  const finish = (sid) => {
    if (endedRef.current) return;
    endedRef.current = true;
    const sessionId = sid ?? sessionIdRef.current;
    voiceRef.current?.end();
    onEnd(sessionId ?? null);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await startSession({
          scenario_id: scenario.id,
          duration_sec: durationSec,
        });
        if (cancelled) return;
        sessionIdRef.current = res.session_id;

        const voice = createVoiceSession({ wsUrl: res.ws_url });
        voiceRef.current = voice;
        voice.on("ready", () => setState("ready"));
        voice.on("listening", () => setState("listening"));
        voice.on("thinking", () => setState("thinking"));
        voice.on("speaking", () => setState("speaking"));
        voice.on("turn", (t) => setLastTurn(t));
        voice.on("error", (e) => {
          setError(e);
          setState("error");
        });
        voice.on("closed", () => finish());
        await voice.start();
      } catch (err) {
        if (!cancelled) {
          setError({ code: "start_failed", message: err?.message ?? "error al iniciar" });
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      voiceRef.current?.end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state === "connecting" || state === "error") return;
    const id = setInterval(() => setRemaining((r) => (r <= 0 ? r : r - 1)), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (remaining <= 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (state === "error") {
    const code = error?.code;
    const title = ERROR_TITLES[code] ?? "algo falló";
    const body = ERROR_BODIES[code] ?? error?.message ?? "error desconocido";
    return (
      <div className="overlay">
        <div className="mic-denied">
          <div className="mic-denied-title">{title}</div>
          <div className="mic-denied-body">{body}</div>
          <button className="btn-pri" onClick={() => finish(null)}>
            cerrar
          </button>
        </div>
      </div>
    );
  }

  const label = LABEL_BY_STATE[state] ?? "…";
  const low = remaining < 60;
  const agentHint = lastTurn?.role === "agent" ? lastTurn.text : null;
  const userHint = lastTurn?.role === "user" ? lastTurn.text : null;

  return (
    <div className="overlay">
      <div className="sess-header">
        <div className="sess-scenario">{scenario.name}</div>
        <div className={`sess-timer${low ? " low" : ""}`}>
          {formatDuration(Math.max(0, remaining))}
        </div>
      </div>

      <div className="agent-zone">
        <div className={`orb-wrap${state === "speaking" ? " agent-on" : ""}`}>
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
        <div className="agent-label">{label}</div>
        {agentHint && <div className="agent-hint">{agentHint}</div>}
        {userHint && <div className="user-hint">{userHint}</div>}
      </div>

      <div className="chunk-panel">
        <div className="cp-header">
          <span className="cp-label">frases del escenario</span>
          <span className="cp-count">—</span>
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
        <button className="btn-sec" onClick={() => finish()}>
          terminar
        </button>
      </div>
    </div>
  );
}
