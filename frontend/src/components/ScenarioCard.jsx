export default function ScenarioCard({ scenario, selected, onSelect, onEdit }) {
  return (
    <div
      className={`sc${selected ? " sel" : ""}`}
      onClick={() => onSelect(scenario.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(scenario.id);
        }
      }}
    >
      <div className="sc-icon">{scenario.icon}</div>
      <div className="sc-body">
        <div className="sc-name">{scenario.name}</div>
        <div className="sc-conf">
          <div className="conf-track">
            <div className="conf-fill" style={{ width: "0%", background: "var(--green)" }} />
          </div>
          <div className="due-pill due-placeholder">—</div>
        </div>
      </div>
      <button
        className="sc-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit(scenario);
        }}
        aria-label="editar escenario"
        title="editar"
      >
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
      </button>
    </div>
  );
}
