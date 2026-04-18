export default function TopBar({ streak }) {
  const display = streak == null ? "—" : streak;
  return (
    <div className="topbar">
      <div className="logo">
        <div className="logo-mark">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="4" stroke="white" strokeWidth="1.5" />
            <circle cx="6" cy="6" r="1.5" fill="white" />
          </svg>
        </div>
        habla.practice
      </div>
      <div className="streak">
        <strong>{display}</strong> días seguidos
      </div>
    </div>
  );
}
