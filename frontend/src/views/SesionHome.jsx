import ScenarioCard from "../components/ScenarioCard.jsx";

const DURATIONS = [
  { sec: 300, label: "5 min" },
  { sec: 600, label: "10 min" },
  { sec: 900, label: "15 min" },
  { sec: 1200, label: "20 min" },
];

export default function SesionHome({
  scenarios,
  selectedScenario,
  onSelectScenario,
  onEditScenario,
  onNewScenario,
  durationSec,
  onChangeDuration,
  onStart,
  streak,
}) {
  const weekCount = streak?.sessions_this_week ?? "—";
  const totalReps = streak?.total_reps ?? "—";
  const dueToday = streak?.due_today_count ?? "—";
  return (
    <div>
      <div className="stats">
        <div className="stat">
          <div className="stat-l">esta semana</div>
          <div className="stat-v">{weekCount}</div>
          <div className="stat-s">sesiones</div>
        </div>
        <div className="stat">
          <div className="stat-l">frases usadas</div>
          <div className="stat-v">{totalReps}</div>
          <div className="stat-s">repeticiones</div>
        </div>
        <div className="stat">
          <div className="stat-l">pendientes hoy</div>
          <div className="stat-v">{dueToday}</div>
          <div className="stat-s">escenarios</div>
        </div>
      </div>

      <div className="label">escenario</div>
      <div className="scenarios">
        {scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            selected={selectedScenario?.id === s.id}
            onSelect={onSelectScenario}
            onEdit={onEditScenario}
          />
        ))}
      </div>
      <button className="add-row" onClick={onNewScenario}>
        <span className="add-circle">+</span>
        nuevo escenario
      </button>

      <div className="preview-block">
        <div className="label">
          frases ·{" "}
          <span style={{ textTransform: "none", letterSpacing: 0 }}>
            {selectedScenario?.name ?? "—"}
          </span>
        </div>
        {selectedScenario && selectedScenario.chunks.length > 0 ? (
          <div className="preview-pills">
            {selectedScenario.chunks.map((c) => (
              <div key={c.id} className="prev-pill">
                {c.text_es}
              </div>
            ))}
          </div>
        ) : (
          <div className="preview-empty">sin frases asignadas</div>
        )}
      </div>

      <div className="label">duración</div>
      <div className="dur-row">
        {DURATIONS.map((d) => (
          <button
            key={d.sec}
            className={`dur${durationSec === d.sec ? " active" : ""}`}
            onClick={() => onChangeDuration(d.sec)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <button className="start" onClick={onStart} disabled={!selectedScenario}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.5" stroke="rgba(255,255,255,0.4)" />
          <circle cx="7" cy="7" r="3" fill="white" />
        </svg>
        empezar sesión
      </button>
    </div>
  );
}
