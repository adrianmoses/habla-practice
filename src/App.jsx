import { useState, useEffect, useRef, useCallback } from "react";
import { uploadRecording } from "./lib/api.js";

const TOPICS = [
  {
    cat: "Everyday Life",
    items: [
      "How you make your morning coffee or tea",
      "What your neighborhood looks like",
      "Your typical weekday routine",
      "How to do laundry from start to finish",
      "What's in your fridge right now and why",
      "How you get to work or school",
      "Your favorite meal to cook and how you make it",
      "What you do to relax after a long day",
      "How you organize your phone apps",
      "Your weekend routine versus your weekday routine",
    ],
  },
  {
    cat: "People & Relationships",
    items: [
      "Describe your best friend's personality",
      "What makes a good neighbor",
      "How you met someone important in your life",
      "What your family dynamic is like",
      "The difference between a good boss and a bad boss",
      "How friendships change as you get older",
      "Describe someone you admire and why",
      "What you look for in a travel companion",
      "How people in your culture greet each other",
      "The funniest person you know and what makes them funny",
    ],
  },
  {
    cat: "How Things Work",
    items: [
      "How a refrigerator keeps food cold",
      "Why the sky changes color at sunset",
      "How a search engine finds results",
      "Why we dream when we sleep",
      "How a bicycle stays balanced",
      "What happens when you catch a cold",
      "How plants turn sunlight into food",
      "Why some things float and others sink",
      "How a microwave heats food",
      "What WiFi actually is",
    ],
  },
  {
    cat: "Opinions",
    items: [
      "The best season of the year and why",
      "City vs countryside living",
      "Your favorite type of music and why",
      "Cooking at home vs eating out",
      "The most overrated thing in popular culture",
      "Morning vs night productivity",
      "Your unpopular opinion about food",
      "Social media: more good or harm?",
      "The ideal age to learn a second language",
      "Pets or no pets?",
    ],
  },
  {
    cat: "Describe & Compare",
    items: [
      "Your country's weather vs Spain's",
      "Compare two cities you've visited",
      "A book vs its movie adaptation",
      "How you studied as a teen vs now",
      "Being busy vs being productive",
      "Compare two sports you know",
      "Your life five years ago vs now",
      "Being alone vs being lonely",
      "Compare two holidays you enjoy",
      "Talent vs hard work",
    ],
  },
  {
    cat: "Hypothetical",
    items: [
      "What you'd do with an extra hour daily",
      "If you could live in any historical period",
      "Your perfect no-budget vacation",
      "If you had to teach a class on anything",
      "What you'd change about your city",
      "Dinner with anyone alive — who?",
      "Explain your job to a child",
      "Instantly master one skill — which?",
      "The world in 50 years",
      "Redesign the school system",
    ],
  },
  {
    cat: "Culture & Society",
    items: [
      "A tradition from your culture",
      "How holidays are celebrated where you're from",
      "Why people travel",
      "The role of music in daily life",
      "How fashion has changed in your lifetime",
      "What makes a city feel alive",
      "Local markets vs big stores",
      "How humor differs across cultures",
      "Food bringing people together",
      "Why people are nostalgic",
    ],
  },
  {
    cat: "Storytelling",
    items: [
      "The last dream you remember",
      "A time you got completely lost",
      "The most memorable meal you've had",
      "A creative problem-solving moment",
      "Your most embarrassing moment",
      "A trip that didn't go as planned",
      "First time trying something scary",
      "A moment that changed your perspective",
      "The strangest coincidence you've had",
      "Communicating without a shared language",
    ],
  },
  {
    cat: "Abstract",
    items: [
      "What it means to be brave",
      "Whether people can truly change",
      "What makes something beautiful",
      "Knowledge vs wisdom",
      "Why time feels faster with age",
      "What success means to you",
      "Are rules necessary for freedom?",
      "What makes a memory stick?",
      "Language and thought",
      "Happiness: choice or circumstance?",
    ],
  },
];

const CHUNKS = [
  {
    cat: "Programming",
    items: [
      { es: "Estoy depurando el código", en: "I'm debugging the code" },
      { es: "He encontrado un error / un bug", en: "I've found an error / a bug" },
      { es: "Voy a hacer un commit", en: "I'm going to make a commit" },
      { es: "Tengo que refactorizar esta función", en: "I need to refactor this function" },
      { es: "Se ha caído el servidor", en: "The server has gone down" },
      { es: "Necesito hacer una consulta a la base de datos", en: "I need to query the database" },
      { es: "Me he quedado atascado con este problema", en: "I've gotten stuck on this problem" },
      { es: "He desplegado la última versión", en: "I've deployed the latest version" },
      { es: "La API no me devuelve nada", en: "The API isn't returning anything" },
      { es: "He montado el entorno de desarrollo", en: "I've set up the dev environment" },
    ],
  },
  {
    cat: "Brushing Teeth",
    items: [
      { es: "Voy a lavarme los dientes", en: "I'm going to brush my teeth" },
      { es: "Pongo pasta de dientes en el cepillo", en: "I put toothpaste on the brush" },
      { es: "Me paso el hilo dental", en: "I floss" },
      { es: "Hago enjuague bucal", en: "I use mouthwash" },
      { es: "Escupo y me enjuago la boca", en: "I spit and rinse my mouth" },
    ],
  },
  {
    cat: "Meditation",
    items: [
      { es: "Voy a meditar un rato", en: "I'm going to meditate for a bit" },
      { es: "Me siento con la espalda recta", en: "I sit with my back straight" },
      { es: "Cierro los ojos y respiro hondo", en: "I close my eyes and breathe deeply" },
      { es: "Me centro en la respiración", en: "I focus on my breathing" },
      { es: "Se me va la mente y la vuelvo a traer", en: "My mind wanders and I bring it back" },
      { es: "Hoy me cuesta concentrarme", en: "Today it's hard for me to focus" },
      { es: "Me quedo con una sensación de calma", en: "I'm left with a feeling of calm" },
    ],
  },
  {
    cat: "Lifting Weights",
    items: [
      { es: "Voy a hacer pesas", en: "I'm going to lift weights" },
      { es: "Hoy toca tren superior / tren inferior", en: "Today is upper body / lower body" },
      { es: "Hago tres series de diez repeticiones", en: "I do three sets of ten reps" },
      { es: "Me duelen las agujetas de ayer", en: "I'm sore from yesterday" },
      {
        es: "Estoy haciendo sentadillas / peso muerto / press de banca",
        en: "Squats / deadlifts / bench press",
      },
      { es: "Descanso un minuto entre series", en: "I rest one minute between sets" },
      {
        es: "Me estoy estancando, necesito cambiar la rutina",
        en: "I'm plateauing, I need to change my routine",
      },
    ],
  },
  {
    cat: "Food Prep",
    items: [
      { es: "Voy a picar la cebolla en trocitos", en: "I'm going to dice the onion" },
      { es: "Pico el ajo bien fino", en: "I mince the garlic" },
      { es: "Corto las verduras en juliana", en: "I cut vegetables into thin strips" },
      { es: "Quito la grasa de la carne", en: "I trim the fat off the meat" },
      { es: "Bato los huevos", en: "I beat the eggs" },
      { es: "Tengo que afilar el cuchillo", en: "I need to sharpen the knife" },
      { es: "Separo las claras de las yemas", en: "I separate the whites from the yolks" },
    ],
  },
  {
    cat: "Preparing Coffee",
    items: [
      { es: "Voy a poner café", en: "I'm going to make coffee" },
      { es: "Muelo los granos de café", en: "I grind the coffee beans" },
      { es: "Pongo la cafetera italiana en el fuego", en: "I put the moka pot on the stove" },
      { es: "Me hago un cortado", en: "I make myself a cortado" },
      { es: "Ya está listo el café", en: "The coffee's ready" },
      { es: "El café está muy cargado / muy flojo", en: "The coffee is very strong / very weak" },
    ],
  },
  {
    cat: "Emails & Messages",
    items: [
      { es: "Estoy redactando un correo", en: "I'm drafting an email" },
      { es: "Le doy a enviar", en: "I hit send" },
      { es: "Pongo en copia a mi compañero", en: "I CC my colleague" },
      { es: "Tengo la bandeja de entrada llena", en: "My inbox is full" },
      { es: "Reviso el borrador antes de mandarlo", en: "I review the draft before sending" },
      { es: "Me he equivocado de destinatario", en: "I sent it to the wrong person" },
    ],
  },
  {
    cat: "Clothes",
    items: [
      { es: "Me cambio de ropa", en: "I change clothes" },
      { es: "Doblo la ropa recién lavada", en: "I fold the freshly washed clothes" },
      { es: "Cuelgo las camisas en perchas", en: "I hang the shirts on hangers" },
      { es: "Tiendo la ropa en el tendedero", en: "I hang clothes on the drying rack" },
      { es: "Esto está arrugado, lo plancho", en: "This is wrinkled, I'll iron it" },
      { es: "Meto la ropa sucia en la lavadora", en: "I put dirty clothes in the washing machine" },
    ],
  },
  {
    cat: "Cleaning",
    items: [
      { es: "Voy a barrer el suelo", en: "I'm going to sweep the floor" },
      { es: "Paso la fregona", en: "I mop the floor" },
      { es: "Limpio la encimera con un trapo", en: "I wipe down the counter" },
      { es: "Quito el polvo de los muebles", en: "I dust the furniture" },
      { es: "Saco la basura", en: "I take out the trash" },
      { es: "Hay una mancha que no se quita", en: "There's a stain that won't come off" },
      { es: "Hay que ventilar un poco la casa", en: "We need to air out the house" },
    ],
  },
  {
    cat: "Maintenance",
    items: [
      { es: "Se ha roto la caldera", en: "The boiler has broken down" },
      { es: "Hay una fuga de agua en el baño", en: "There's a water leak in the bathroom" },
      { es: "Se ha atascado el desagüe", en: "The drain is clogged" },
      { es: "¿Cuándo puede venir a revisarlo?", en: "When can you come take a look?" },
      { es: "Hay humedad en la pared", en: "There's dampness on the wall" },
      { es: "¿Cuánto tardaría en arreglarlo?", en: "How long would it take to fix?" },
    ],
  },
  {
    cat: "Directions",
    items: [
      { es: "Sigue todo recto", en: "Go straight ahead" },
      { es: "Gira a la derecha / a la izquierda", en: "Turn right / left" },
      { es: "Está a unos cinco minutos andando", en: "It's about five minutes on foot" },
      { es: "No tiene pérdida", en: "You can't miss it" },
      { es: "Lo siento, no soy de aquí", en: "Sorry, I'm not from here" },
    ],
  },
  {
    cat: "Food Order",
    items: [
      { es: "Perdona, ¿puedo cambiar el pedido?", en: "Excuse me, can I change my order?" },
      { es: "Al final prefiero el otro plato", en: "Actually I'd prefer the other dish" },
      { es: "¿Se puede sin gluten / sin lactosa?", en: "Can it be gluten-free / lactose-free?" },
      {
        es: "Me he equivocado, quería la otra cosa",
        en: "I made a mistake, I wanted the other thing",
      },
      { es: "¿Tenéis algo para celíacos?", en: "Do you have anything for celiacs?" },
    ],
  },
  {
    cat: "Walking the City",
    items: [
      { es: "Estoy paseando por el centro", en: "I'm walking through the city center" },
      { es: "Busco una terraza para sentarme", en: "I'm looking for an outdoor café" },
      { es: "Me he perdido, voy a mirar el mapa", en: "I'm lost, I'll check the map" },
      { es: "El barrio tiene mucho encanto", en: "The neighborhood has a lot of charm" },
      { es: "Hay un mercadillo en la plaza", en: "There's a street market in the square" },
    ],
  },
  {
    cat: "Doctor",
    items: [
      { es: "Vengo porque me encuentro mal", en: "I'm here because I'm not feeling well" },
      { es: "Me duele aquí al presionar", en: "It hurts here when I press" },
      { es: "Llevo unos días con fiebre", en: "I've had a fever for a few days" },
      { es: "Me mareo cuando me levanto", en: "I get dizzy when I stand up" },
      { es: "¿Necesito hacerme análisis de sangre?", en: "Do I need a blood test?" },
      { es: "Me cuesta dormir últimamente", en: "I've been having trouble sleeping" },
      { es: "Necesito que me renueve la receta", en: "I need you to renew my prescription" },
    ],
  },
  {
    cat: "Tax Advisor",
    items: [
      {
        es: "Tengo que hacer la declaración de la renta",
        en: "I need to file my income tax return",
      },
      { es: "¿Me sale a pagar o a devolver?", en: "Do I owe or am I getting a refund?" },
      { es: "Soy autónomo", en: "I'm self-employed" },
      { es: "¿Qué gastos me puedo deducir?", en: "What expenses can I deduct?" },
      { es: "He recibido una carta de Hacienda", en: "I got a letter from the tax office" },
      { es: "¿Puedo fraccionar el pago?", en: "Can I pay in installments?" },
    ],
  },
  {
    cat: "Software Presentation",
    items: [
      {
        es: "Os voy a enseñar cómo funciona la plataforma",
        en: "I'm going to show you how the platform works",
      },
      { es: "Vamos a hacer una demostración en directo", en: "Let's do a live demo" },
      { es: "¿Tenéis alguna duda hasta aquí?", en: "Any questions so far?" },
      {
        es: "Esto se integra con las herramientas que ya usáis",
        en: "This integrates with your existing tools",
      },
      { es: "Aquí os muestro un caso de uso real", en: "Here I'll show you a real use case" },
      {
        es: "¿En qué se diferencia de la competencia?",
        en: "How does it differ from the competition?",
      },
    ],
  },
];

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
  { label: "Struggled", emoji: "😤", color: "#e85d4a" },
  { label: "Okay", emoji: "🤔", color: "#e8a84a" },
  { label: "Felt easy", emoji: "😎", color: "#4aae6a" },
];

export default function App() {
  const [view, setView] = useState("practice"); // practice | log
  const [mode, setMode] = useState("topics"); // topics | chunks
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

  const mediaRec = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const audioRef = useRef(null);
  const startTimeRef = useRef(null);
  const audioBlobRef = useRef(null);

  useEffect(() => {
    const d = loadData();
    setData(d);
    setLoaded(true);
  }, []);

  // Generate random prompt
  const randomPrompt = useCallback(() => {
    if (mode === "topics") {
      const cat = rand(TOPICS);
      setPrompt({ type: "topic", cat: cat.cat, text: rand(cat.items) });
      setChunkCat(null);
    } else {
      const cat = rand(CHUNKS);
      setPrompt({ type: "chunk", cat: cat.cat });
      setChunkCat(cat);
    }
    setAudioUrl(null);
    setShowRating(false);
    setElapsed(0);
    setShowEn({});
  }, [mode]);

  useEffect(() => {
    if (loaded && !prompt) randomPrompt();
  }, [loaded, randomPrompt, prompt]);

  // Recording
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => chunks.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
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
      alert("Microphone access is needed to record.");
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
        session.r2Key = result.key;
      } catch (err) {
        console.error("R2 upload failed, saving locally:", err);
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
        Loading...
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
            Activate your Spanish vocabulary
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
            day streak
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="tab-bar">
        <button
          className={`tab ${view === "practice" ? "active" : ""}`}
          onClick={() => setView("practice")}
        >
          Practice
        </button>
        <button
          className={`tab ${view === "browse" ? "active" : ""}`}
          onClick={() => setView("browse")}
        >
          Browse
        </button>
        <button className={`tab ${view === "log" ? "active" : ""}`} onClick={() => setView("log")}>
          Progress
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
              Explain It Simply
            </button>
            <button
              className={`btn btn-sm ${mode === "chunks" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => {
                setMode("chunks");
                setPrompt(null);
              }}
            >
              Chunk Drill
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
                <ShuffleIcon /> New
              </button>
            </div>

            {prompt?.type === "topic" && (
              <p
                style={{
                  fontSize: 18,
                  fontWeight: 500,
                  lineHeight: 1.4,
                  color: "var(--text-primary)",
                }}
              >
                {prompt.text}
              </p>
            )}

            {prompt?.type === "chunk" && chunkCat && (
              <div>
                {chunkCat.items.map((item, i) => (
                  <div key={i} className="chunk-item" onClick={() => toggleEn(i)}>
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
                ))}
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  Tap a phrase to reveal its English translation
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
                  <MicIcon /> Start Recording
                </button>
              )}
              {recording && (
                <button
                  className="btn"
                  style={{ background: "var(--danger)", color: "#fff" }}
                  onClick={stopRec}
                >
                  <StopIcon /> Stop
                </button>
              )}
              {audioUrl && (
                <button className="btn btn-ghost" onClick={togglePlay}>
                  {playing ? <PauseIcon /> : <PlayIcon />} {playing ? "Pause" : "Play back"}
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
                How did that feel?
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
              Today: {todaySessions.length} session{todaySessions.length > 1 ? "s" : ""} ·{" "}
              {fmtTime(todayMin)} total
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
              Topics
            </button>
            <button
              className={`btn btn-sm ${mode === "chunks" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setMode("chunks")}
            >
              Chunks
            </button>
          </div>

          {mode === "topics" &&
            TOPICS.map((cat, ci) => (
              <div key={ci} className="card" style={{ padding: "6px 20px" }}>
                <div className="cat-header" onClick={() => toggleCat(cat.cat)}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.cat}</span>
                  <ChevronIcon down={expandedCats[cat.cat]} />
                </div>
                {expandedCats[cat.cat] &&
                  cat.items.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px 0",
                        borderTop: "1px solid var(--card-border)",
                        fontSize: 14,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {item}
                    </div>
                  ))}
              </div>
            ))}

          {mode === "chunks" &&
            CHUNKS.map((cat, ci) => (
              <div key={ci} className="card" style={{ padding: "6px 20px" }}>
                <div className="cat-header" onClick={() => toggleCat(cat.cat)}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.cat}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {cat.items.length} phrases
                  </span>
                </div>
                {expandedCats[cat.cat] &&
                  cat.items.map((item, i) => (
                    <div key={i} className="chunk-item" onClick={() => toggleEn(`b-${ci}-${i}`)}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
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
                  ))}
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
                <div className="stat-label">Streak</div>
              </div>
              <div className="stat-box">
                <div className="stat-num">{totalSessions}</div>
                <div className="stat-label">Sessions</div>
              </div>
              <div className="stat-box">
                <div className="stat-num">
                  {fmtTime(data.sessions.reduce((a, s) => a + s.duration, 0))}
                </div>
                <div className="stat-label">Total Time</div>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Recent Sessions</h3>
            {data.sessions.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No sessions yet. Start practicing!
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
                if (confirm("Clear all progress data?")) {
                  const empty = { sessions: [], streak: 0, lastDate: null };
                  setData(empty);
                  saveData(empty);
                }
              }}
            >
              Reset Progress
            </button>
          )}
        </>
      )}
    </div>
  );
}
