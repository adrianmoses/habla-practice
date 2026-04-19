import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

const STATE_EVENT_MAP = [
  [RTVIEvent.Connected, "ready"],
  [RTVIEvent.UserStartedSpeaking, "listening"],
  [RTVIEvent.UserStoppedSpeaking, "thinking"],
  [RTVIEvent.BotStartedSpeaking, "speaking"],
  [RTVIEvent.BotStoppedSpeaking, "listening"],
];

// Logging for audio-pipeline debugging. Set to false once stable.
const DEBUG_VOICE = true;
const log = (...args) =>
  DEBUG_VOICE && console.log("%c[voice]", "color:#1D9E75;font-weight:bold", ...args);

const TRACED_EVENTS = [
  "Connected",
  "Disconnected",
  "TransportStateChanged",
  "BotStarted",
  "BotConnected",
  "BotReady",
  "BotDisconnected",
  "BotStartedSpeaking",
  "BotStoppedSpeaking",
  "BotLlmStarted",
  "BotLlmStopped",
  "BotTtsText",
  "BotTranscript",
  "UserStartedSpeaking",
  "UserStoppedSpeaking",
  "UserTranscript",
  "Error",
  "MessageError",
  "ServerMessage",
  "Metrics",
];

export function createVoiceSession({ wsUrl }) {
  const listeners = new Map();
  const emit = (name, detail) => {
    for (const fn of listeners.get(name) ?? []) {
      try {
        fn(detail);
      } catch (err) {
        console.error(`voice listener for ${name} threw`, err);
      }
    }
  };

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const absUrl = /^wss?:/i.test(wsUrl) ? wsUrl : `${proto}//${location.host}${wsUrl}`;

  log("ws url resolved →", absUrl);

  const transport = new WebSocketTransport({ wsUrl: absUrl });
  const client = new PipecatClient({ transport });

  if (DEBUG_VOICE) {
    for (const name of TRACED_EVENTS) {
      const evt = RTVIEvent[name];
      if (evt === undefined) continue;
      client.on(evt, (...args) => {
        const first = args[0];
        const preview =
          first && typeof first === "object"
            ? Object.fromEntries(
                Object.entries(first).slice(0, 6).map(([k, v]) => [
                  k,
                  typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v,
                ]),
              )
            : first;
        log(name, preview ?? "");
      });
    }
  }

  for (const [rtviEvent, stateName] of STATE_EVENT_MAP) {
    client.on(rtviEvent, () => emit(stateName));
  }
  client.on(RTVIEvent.UserTranscript, (t) => {
    if (!t?.text || t.final === false) return;
    emit("turn", { role: "user", text: t.text });
  });
  client.on(RTVIEvent.BotTranscript, (t) => {
    if (!t?.text) return;
    emit("turn", { role: "agent", text: t.text });
  });
  client.on(RTVIEvent.Error, (err) => {
    emit("error", {
      code: err?.code ?? "pipecat-error",
      message: err?.message ?? "error del agente",
    });
  });
  client.on(RTVIEvent.Disconnected, () => emit("closed"));

  async function start() {
    log("start() called");
    try {
      await client.initDevices();
      log("initDevices OK", {
        mic: client.selectedMic?.()?.label,
        micEnabled: client.isMicEnabled?.(),
      });
    } catch (err) {
      log("initDevices FAILED", err);
      const code = err?.name === "NotAllowedError" ? "mic-denied" : "mic-error";
      emit("error", { code, message: err?.message ?? "no se pudo acceder al micrófono" });
      return;
    }
    try {
      await client.connect();
      log("connect() resolved; state =", client.state);
      // Probe the playback audio element / context. A suspended AudioContext is the
      // classic "TTS arrives, nothing plays" symptom (browsers block autoplay until
      // a user gesture). initDevices() + the click that opened LiveSession should
      // have satisfied autoplay, but log so we can see.
      const audios = document.querySelectorAll("audio");
      log(
        `${audios.length} <audio> elements in DOM; readyStates =`,
        Array.from(audios).map((a) => ({
          src: a.src || a.srcObject?.id || "(srcObject)",
          muted: a.muted,
          paused: a.paused,
          readyState: a.readyState,
        })),
      );
    } catch (err) {
      log("connect() FAILED", err);
      emit("error", { code: "ws-error", message: err?.message ?? "error de conexión" });
    }
  }

  async function end() {
    try {
      await client.disconnect();
    } catch {
      // already disconnected
    }
    listeners.clear();
  }

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event)?.delete(cb);
  }

  return { start, end, on };
}
