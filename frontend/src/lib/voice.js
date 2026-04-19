import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

const STATE_EVENT_MAP = [
  [RTVIEvent.Connected, "ready"],
  [RTVIEvent.UserStartedSpeaking, "listening"],
  [RTVIEvent.UserStoppedSpeaking, "thinking"],
  [RTVIEvent.BotStartedSpeaking, "speaking"],
  [RTVIEvent.BotStoppedSpeaking, "listening"],
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

  const transport = new WebSocketTransport({ wsUrl: absUrl });
  const client = new PipecatClient({ transport });

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
    try {
      await client.initDevices();
    } catch (err) {
      const code = err?.name === "NotAllowedError" ? "mic-denied" : "mic-error";
      emit("error", { code, message: err?.message ?? "no se pudo acceder al micrófono" });
      return;
    }
    try {
      await client.connect();
    } catch (err) {
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
