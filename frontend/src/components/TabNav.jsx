const TABS = [
  { key: "sesion", label: "sesión" },
  { key: "frases", label: "frases" },
  { key: "historial", label: "historial" },
];

export default function TabNav({ activeTab, onChange }) {
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`nav-btn${activeTab === t.key ? " active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
