import { useState, useEffect, useRef, useCallback } from "react";
import { uploadRecording } from "./lib/api.js";

// --- Utility ---
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const today = () => new Date().toISOString().slice(0, 10);

// --- Storage helpers using localStorage ---
function loadData() {
  try {
    const r = localStorage.getItem("habla-data");
    return r ? JSON.parse(r) : { sessions: [], streak: 0, lastDate: null };
  } catch {
    return { sessions: [], streak: 0, lastDate: null };
  }
}
function saveData(data) {
  try {
    localStorage.setItem("habla-data", JSON.stringify(data));
  } catch (e) {
    console.error(e);
  }
}

// --- Icons ---
const MicIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const StopIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);
const PlayIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21" />
  </svg>
);
const PauseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="3" width="4" height="18" />
    <rect x="15" y="3" width="4" height="18" />
  </svg>
);
const ShuffleIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
);
const SpeakerIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </svg>
);
const LoadingIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" opacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" className="spinner-path" />
  </svg>
);
const PencilIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);
const TrashIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const PlusIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const XIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ttsCache = new Map();

function TtsButton({ text }) {
  const [loading, setLoading] = useState(false);

  const play = async () => {
    if (loading) return;

    let blobUrl = ttsCache.get(text);
    if (!blobUrl) {
      setLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error("TTS failed");
        const blob = await res.blob();
        blobUrl = URL.createObjectURL(blob);
        ttsCache.set(text, blobUrl);
      } catch (err) {
        console.error("TTS error:", err);
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    const audio = new Audio(blobUrl);
    audio.play();
  };

  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        e.stopPropagation();
        play();
      }}
      style={{ padding: "4px 6px", minWidth: 0 }}
      title="Escuchar"
    >
      {loading ? <LoadingIcon /> : <SpeakerIcon />}
    </button>
  );
}

const ChevronIcon = ({ down }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ transform: down ? "rotate(0)" : "rotate(-90deg)", transition: "transform 0.2s" }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const RATINGS = [
  { label: "Me costó", emoji: "😤", color: "#e85d4a" },
  { label: "Más o menos", emoji: "🤔", color: "#e8a84a" },
  { label: "Me salió bien", emoji: "😎", color: "#4aae6a" },
];

export default function App() {
  const [view, setView] = useState("practice"); // practice | log
  const [mode, setMode] = useState("chunks"); // topics | chunks
  const [prompt, setPrompt] = useState(null);
  const [chunkCat, setChunkCat] = useState(null);
  const [showEn, setShowEn] = useState({});
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [data, setData] = useState({ sessions: [], streak: 0, lastDate: null });
  const [loaded, setLoaded] = useState(false);
  const [expandedCats, setExpandedCats] = useState({});
  const [uploading, setUploading] = useState(false);
  const [topics, setTopics] = useState([]);
  const [chunksData, setChunksData] = useState([]);
  const [editing, setEditing] = useState(null); // { type, id, ...fields }
  const [adding, setAdding] = useState(null); // { type, cat, ...fields }

  const mediaRec = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const startTimeRef = useRef(null);
  const audioBlobRef = useRef(null);

  useEffect(() => {
    const d = loadData();
    setData(d);
    Promise.all([
      fetch("/api/topics").then((r) => r.json()),
      fetch("/api/chunks").then((r) => r.json()),
    ]).then(([t, ch]) => {
      setTopics(t);
      setChunksData(ch);
      setLoaded(true);
    });
  }, []);

  const refetchData = useCallback(() => {
    Promise.all([
      fetch("/api/topics").then((r) => r.json()),
      fetch("/api/chunks").then((r) => r.json()),
    ]).then(([t, ch]) => {
      setTopics(t);
      setChunksData(ch);
    });
  }, []);

  const handleDelete = async (type, id) => {
    if (!confirm("¿Eliminar este elemento?")) return;
    await fetch(`/api/${type}/${id}`, { method: "DELETE" });
    refetchData();
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const { type, id, ...fields } = editing;
    await fetch(`/api/${type}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    setEditing(null);
    refetchData();
  };

  const handleAdd = async () => {
    if (!adding) return;
    const { type, ...fields } = adding;
    await fetch(`/api/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    setAdding(null);
    refetchData();
  };

  // Generate random prompt
  const randomPrompt = useCallback(() => {
    if (mode === "topics" && topics.length > 0) {
      const cat = rand(topics);
      const item = rand(cat.items);
      setPrompt({ type: "topic", cat: cat.cat, text: item.text });
      setChunkCat(null);
    } else if (mode === "chunks" && chunksData.length > 0) {
      const cat = rand(chunksData);
      setPrompt({ type: "chunk", cat: cat.cat });
      setChunkCat(cat);
    }
    setAudioUrl(null);
    setShowRating(false);
    setElapsed(0);
    setShowEn({});
  }, [mode, topics, chunksData]);

  useEffect(() => {
    if (loaded && !prompt) randomPrompt();
  }, [loaded, randomPrompt, prompt]);

  // Recording
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioBlobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        setShowRating(true);
      };
      mr.start();
      mediaRec.current = mr;
      setRecording(true);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch {
      alert("Se necesita acceso al micrófono para grabar.");
    }
  };

  const stopRec = () => {
    mediaRec.current?.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const saveSession = async (rating) => {
    const session = {
      id: Date.now(),
      date: today(),
      mode,
      cat: prompt?.cat || "",
      prompt: prompt?.type === "topic" ? prompt.text : chunkCat?.items.map((i) => i.es).join(" / "),
      duration: elapsed,
      rating,
    };

    if (audioBlobRef.current) {
      setUploading(true);
      try {
        const result = await uploadRecording(audioBlobRef.current, session.id, {
          date: session.date,
          mode: session.mode,
          cat: session.cat,
          prompt: session.prompt,
          duration: String(session.duration),
          rating: session.rating,
        });
        session.fileKey = result.key;
      } catch (err) {
        console.error("Upload failed, saving locally:", err);
      }
      setUploading(false);
    }

    const d = today();
    let streak = data.streak;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (data.lastDate === yesterday) streak += 1;
    else if (data.lastDate !== d) streak = 1;
    const newData = { sessions: [...data.sessions, session], streak, lastDate: d };
    setData(newData);
    saveData(newData);
    setShowRating(false);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    audioBlobRef.current = null;
    setElapsed(0);
  };

  const todaySessions = data.sessions.filter((s) => s.date === today());
  const todayMin = todaySessions.reduce((a, s) => a + s.duration, 0);
  const totalSessions = data.sessions.length;

  const toggleCat = (cat) => setExpandedCats((p) => ({ ...p, [cat]: !p[cat] }));
  const toggleEn = (idx) => setShowEn((p) => ({ ...p, [idx]: !p[idx] }));

  if (!loaded)
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "'DM Sans',sans-serif",
          color: "var(--text-secondary, #888)",
        }}
      >
        Cargando...
      </div>
    );

  return (
    <div
      style={{
        fontFamily: "'DM Sans', 'Instrument Sans', sans-serif",
        maxWidth: 520,
        margin: "0 auto",
        padding: "20px 16px 40px",
        color: "var(--text-primary, #1a1a2e)",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>
            <span style={{ color: "var(--accent)" }}>habla</span>
            <span style={{ color: "var(--text-muted)", fontWeight: 300 }}>.practice</span>
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            Activa tu vocabulario en español
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 500, color: "var(--accent)" }}>
            {data.streak}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            racha de días
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="tab-bar">
        <button
          className={`tab ${view === "practice" ? "active" : ""}`}
          onClick={() => setView("practice")}
        >
          Practicar
        </button>
        <button
          className={`tab ${view === "browse" ? "active" : ""}`}
          onClick={() => setView("browse")}
        >
          Explorar
        </button>
        <button className={`tab ${view === "log" ? "active" : ""}`} onClick={() => setView("log")}>
          Progreso
        </button>
      </div>

      {/* ====== PRACTICE VIEW ====== */}
      {view === "practice" && (
        <>
          {/* Mode toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              className={`btn btn-sm ${mode === "topics" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => {
                setMode("topics");
                setPrompt(null);
              }}
            >
              Explica con Tus Palabras
            </button>
            <button
              className={`btn btn-sm ${mode === "chunks" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => {
                setMode("chunks");
                setPrompt(null);
              }}
            >
              Frases Clave
            </button>
          </div>

          {/* Prompt Card */}
          <div className="card" style={{ position: "relative" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <span className="chip">{prompt?.cat}</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={randomPrompt}
                style={{ padding: "5px 10px" }}
              >
                <ShuffleIcon /> Nuevo
              </button>
            </div>

            {prompt?.type === "topic" && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: "var(--text-primary)",
                    flex: 1,
                  }}
                >
                  {prompt.text}
                </p>
                <TtsButton text={prompt.text} />
              </div>
            )}

            {prompt?.type === "chunk" && chunkCat && (
              <div>
                {chunkCat.items.map((item, i) => (
                  <div
                    key={i}
                    className="chunk-item"
                    onClick={() => toggleEn(i)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
                  >
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-primary)" }}>
                        {item.es}
                      </p>
                      {showEn[i] && (
                        <p
                          style={{
                            fontSize: 13,
                            color: "var(--text-muted)",
                            marginTop: 4,
                            fontStyle: "italic",
                          }}
                        >
                          {item.en}
                        </p>
                      )}
                    </div>
                    <TtsButton text={item.es} />
                  </div>
                ))}
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  Toca una frase para ver la traducción
                </p>
              </div>
            )}
          </div>

          {/* Timer + Recording */}
          <div className="card" style={{ textAlign: "center" }}>
            <div
              className="mono"
              style={{
                fontSize: 42,
                fontWeight: 500,
                color: recording ? "var(--accent)" : "var(--text-primary)",
                marginBottom: 16,
              }}
            >
              <span className={recording ? "pulse" : ""}>{fmtTime(elapsed)}</span>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              {!recording && !audioUrl && (
                <button className="btn btn-accent" onClick={startRec}>
                  <MicIcon /> Grabar
                </button>
              )}
              {recording && (
                <button
                  className="btn"
                  style={{ background: "var(--danger)", color: "#fff" }}
                  onClick={stopRec}
                >
                  <StopIcon /> Detener
                </button>
              )}
              {audioUrl && (
                <button className="btn btn-ghost" onClick={togglePlay}>
                  {playing ? <PauseIcon /> : <PlayIcon />} {playing ? "Pausar" : "Reproducir"}
                </button>
              )}
            </div>

            {audioUrl && <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} />}
          </div>

          {/* Rating */}
          {showRating && (
            <div className="card" style={{ textAlign: "center" }}>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  marginBottom: 14,
                  color: "var(--text-secondary)",
                }}
              >
                ¿Cómo te fue?
              </p>
              {uploading ? (
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>Guardando...</p>
              ) : (
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  {RATINGS.map((r, i) => (
                    <button key={i} className="rating-btn" onClick={() => saveSession(r.label)}>
                      <span style={{ fontSize: 26 }}>{r.emoji}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: r.color }}>
                        {r.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Today summary */}
          {todaySessions.length > 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "10px 0",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              Hoy: {todaySessions.length} sesión{todaySessions.length > 1 ? "es" : ""} ·{" "}
              {fmtTime(todayMin)} en total
            </div>
          )}
        </>
      )}

      {/* ====== BROWSE VIEW ====== */}
      {view === "browse" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              className={`btn btn-sm ${mode === "topics" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setMode("topics")}
            >
              Temas
            </button>
            <button
              className={`btn btn-sm ${mode === "chunks" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setMode("chunks")}
            >
              Frases
            </button>
          </div>

          {/* Add new category button */}
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginBottom: 14, width: "100%" }}
            onClick={() =>
              setAdding(
                mode === "topics"
                  ? { type: "topics", category: "", prompt_text: "" }
                  : { type: "chunks", category: "", text_es: "", text_en: "" },
              )
            }
          >
            <PlusIcon /> Agregar {mode === "topics" ? "tema" : "frase"}
          </button>

          {/* Add form (new category / item) */}
          {adding && (
            <div className="card" style={{ padding: "14px 20px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Nuevo {adding.type === "topics" ? "tema" : "frase"}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAdding(null)}
                  style={{ padding: "4px 6px", minWidth: 0 }}
                >
                  <XIcon />
                </button>
              </div>
              <input
                type="text"
                placeholder="Categoría"
                value={adding.category}
                onChange={(e) => setAdding({ ...adding, category: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  marginBottom: 8,
                  borderRadius: 8,
                  border: "1px solid var(--card-border)",
                  background: "var(--surface)",
                  color: "var(--text-primary)",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
              {adding.type === "topics" ? (
                <input
                  type="text"
                  placeholder="Texto del tema"
                  value={adding.prompt_text}
                  onChange={(e) => setAdding({ ...adding, prompt_text: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    marginBottom: 8,
                    borderRadius: 8,
                    border: "1px solid var(--card-border)",
                    background: "var(--surface)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Español"
                    value={adding.text_es}
                    onChange={(e) => setAdding({ ...adding, text_es: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      marginBottom: 8,
                      borderRadius: 8,
                      border: "1px solid var(--card-border)",
                      background: "var(--surface)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="text"
                    placeholder="English"
                    value={adding.text_en}
                    onChange={(e) => setAdding({ ...adding, text_en: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      marginBottom: 8,
                      borderRadius: 8,
                      border: "1px solid var(--card-border)",
                      background: "var(--surface)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontFamily: "inherit",
                    }}
                  />
                </>
              )}
              <button
                className="btn btn-accent btn-sm"
                onClick={handleAdd}
                disabled={
                  !adding.category ||
                  (adding.type === "topics" ? !adding.prompt_text : !adding.text_es)
                }
              >
                <CheckIcon /> Guardar
              </button>
            </div>
          )}

          {mode === "topics" &&
            topics.map((cat, ci) => (
              <div key={ci} className="card" style={{ padding: "6px 20px" }}>
                <div className="cat-header" onClick={() => toggleCat(cat.cat)}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.cat}</span>
                  <ChevronIcon down={expandedCats[cat.cat]} />
                </div>
                {expandedCats[cat.cat] && (
                  <>
                    {cat.items.map((item) =>
                      editing?.type === "topics" && editing?.id === item.id ? (
                        <div
                          key={item.id}
                          style={{
                            padding: "8px 0",
                            borderTop: "1px solid var(--card-border)",
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="text"
                            value={editing.prompt_text}
                            onChange={(e) =>
                              setEditing({ ...editing, prompt_text: e.target.value })
                            }
                            style={{
                              flex: 1,
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid var(--accent)",
                              background: "var(--surface)",
                              color: "var(--text-primary)",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={handleSaveEdit}
                            style={{ padding: "4px 6px", minWidth: 0 }}
                            title="Guardar"
                          >
                            <CheckIcon />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditing(null)}
                            style={{ padding: "4px 6px", minWidth: 0 }}
                            title="Cancelar"
                          >
                            <XIcon />
                          </button>
                        </div>
                      ) : (
                        <div
                          key={item.id}
                          style={{
                            padding: "8px 0",
                            borderTop: "1px solid var(--card-border)",
                            fontSize: 14,
                            color: "var(--text-secondary)",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ flex: 1 }}>{item.text}</span>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setEditing({
                                type: "topics",
                                id: item.id,
                                category: cat.cat,
                                prompt_text: item.text,
                              })
                            }
                            style={{ padding: "4px 6px", minWidth: 0 }}
                            title="Editar"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete("topics", item.id)}
                            style={{ padding: "4px 6px", minWidth: 0, color: "var(--danger)" }}
                            title="Eliminar"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ),
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, marginBottom: 4, width: "100%", fontSize: 12 }}
                      onClick={() =>
                        setAdding({ type: "topics", category: cat.cat, prompt_text: "" })
                      }
                    >
                      <PlusIcon /> Agregar tema
                    </button>
                  </>
                )}
              </div>
            ))}

          {mode === "chunks" &&
            chunksData.map((cat, ci) => (
              <div key={ci} className="card" style={{ padding: "6px 20px" }}>
                <div className="cat-header" onClick={() => toggleCat(cat.cat)}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.cat}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {cat.items.length} frases
                  </span>
                </div>
                {expandedCats[cat.cat] && (
                  <>
                    {cat.items.map((item, i) =>
                      editing?.type === "chunks" && editing?.id === item.id ? (
                        <div
                          key={item.id}
                          style={{
                            padding: "10px 0",
                            borderBottom: "1px solid var(--card-border)",
                          }}
                        >
                          <input
                            type="text"
                            value={editing.text_es}
                            onChange={(e) => setEditing({ ...editing, text_es: e.target.value })}
                            placeholder="Español"
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              marginBottom: 6,
                              borderRadius: 8,
                              border: "1px solid var(--accent)",
                              background: "var(--surface)",
                              color: "var(--text-primary)",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editing.text_en}
                            onChange={(e) => setEditing({ ...editing, text_en: e.target.value })}
                            placeholder="English"
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              marginBottom: 6,
                              borderRadius: 8,
                              border: "1px solid var(--card-border)",
                              background: "var(--surface)",
                              color: "var(--text-primary)",
                              fontSize: 13,
                              fontFamily: "inherit",
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                          />
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={handleSaveEdit}
                              style={{ padding: "4px 8px" }}
                            >
                              <CheckIcon /> Guardar
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditing(null)}
                              style={{ padding: "4px 8px" }}
                            >
                              <XIcon /> Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={item.id}
                          style={{
                            padding: "10px 0",
                            borderBottom: "1px solid var(--card-border)",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                          }}
                        >
                          <div
                            style={{ flex: 1, cursor: "pointer" }}
                            onClick={() => toggleEn(`b-${ci}-${i}`)}
                          >
                            <p
                              style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: "var(--text-primary)",
                              }}
                            >
                              {item.es}
                            </p>
                            {showEn[`b-${ci}-${i}`] && (
                              <p
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-muted)",
                                  marginTop: 3,
                                  fontStyle: "italic",
                                }}
                              >
                                {item.en}
                              </p>
                            )}
                          </div>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setEditing({
                                type: "chunks",
                                id: item.id,
                                category: cat.cat,
                                text_es: item.es,
                                text_en: item.en,
                              })
                            }
                            style={{ padding: "4px 6px", minWidth: 0 }}
                            title="Editar"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleDelete("chunks", item.id)}
                            style={{ padding: "4px 6px", minWidth: 0, color: "var(--danger)" }}
                            title="Eliminar"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      ),
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginTop: 8, marginBottom: 4, width: "100%", fontSize: 12 }}
                      onClick={() =>
                        setAdding({ type: "chunks", category: cat.cat, text_es: "", text_en: "" })
                      }
                    >
                      <PlusIcon /> Agregar frase
                    </button>
                  </>
                )}
              </div>
            ))}
        </>
      )}

      {/* ====== PROGRESS VIEW ====== */}
      {view === "log" && (
        <>
          <div className="card">
            <div className="stat-grid">
              <div className="stat-box">
                <div className="stat-num">{data.streak}</div>
                <div className="stat-label">Racha</div>
              </div>
              <div className="stat-box">
                <div className="stat-num">{totalSessions}</div>
                <div className="stat-label">Sesiones</div>
              </div>
              <div className="stat-box">
                <div className="stat-num">
                  {fmtTime(data.sessions.reduce((a, s) => a + s.duration, 0))}
                </div>
                <div className="stat-label">Tiempo Total</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Sesiones Recientes</h3>
            {data.sessions.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                Aún no hay sesiones. ¡A practicar!
              </p>
            )}
            {[...data.sessions]
              .reverse()
              .slice(0, 20)
              .map((s, i) => (
                <div key={i} className="log-row">
                  <div style={{ fontSize: 22 }}>
                    {RATINGS.find((r) => r.label === s.rating)?.emoji || "🤔"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.cat}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      {s.date} · {fmtTime(s.duration)} · {s.mode}
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {data.sessions.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ margin: "10px auto", display: "block" }}
              onClick={() => {
                if (confirm("¿Borrar todos los datos de progreso?")) {
                  const empty = { sessions: [], streak: 0, lastDate: null };
                  setData(empty);
                  saveData(empty);
                }
              }}
            >
              Borrar Progreso
            </button>
          )}
        </>
      )}
    </div>
  );
}
