import { madridWeekdayIndex, relativeDate } from "../lib/dates.js";
import { formatDuration } from "../lib/format.js";

const WEEK_DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const EMPTY_GRID = [0, 0, 0, 0, 0, 0, 0];

function dotClass(isToday, count) {
  if (isToday) return "wdot wd-today";
  if (count > 0) return "wdot wd-done";
  return "wdot wd-empty";
}

export default function Historial({ streak, sessions }) {
  const grid = streak?.weekly_grid ?? EMPTY_GRID;
  const todayIdx = madridWeekdayIndex(new Date());
  const rows = sessions ?? [];

  return (
    <div>
      <div className="label">esta semana</div>
      <div className="week">
        {WEEK_DAYS.map((d, i) => {
          const count = grid[i] ?? 0;
          const isToday = i === todayIdx;
          const display = count > 0 ? count : isToday ? "·" : "—";
          return (
            <div key={d} className="wday">
              <div className="wlabel">{d}</div>
              <div className={dotClass(isToday, count)}>{display}</div>
            </div>
          );
        })}
      </div>

      <div className="label">sesiones recientes</div>
      <div className="hist-list">
        {rows.length === 0 ? (
          <div className="hist-empty">aún no hay sesiones</div>
        ) : (
          rows.map((s) => (
            <div key={s.id} className="hist-row">
              <span className="hist-icon">{s.scenario.icon}</span>
              <span className="hist-name">{s.scenario.name}</span>
              <span className="hist-date">{relativeDate(s.ended_at)}</span>
              <span className="hist-duration">{formatDuration(s.duration_sec ?? 0)} min</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
