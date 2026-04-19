const WEEK_DAYS = ["L", "M", "X", "J", "V", "S", "D"];

export default function Historial() {
  return (
    <div>
      <div className="label">esta semana</div>
      <div className="week">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="wday">
            <div className="wlabel">{d}</div>
            <div className="wdot wd-empty">—</div>
          </div>
        ))}
      </div>

      <div className="label">sesiones recientes</div>
      <div className="hist-list">
        <div className="hist-empty">aún no hay sesiones</div>
      </div>
    </div>
  );
}
