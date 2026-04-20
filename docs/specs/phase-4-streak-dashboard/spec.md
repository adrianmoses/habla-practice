---
name: Phase 4 — Streak & dashboard stats
description: Bundled spec for ROADMAP features 401–402 — GET /api/streak (current streak, last session date, sessions this week, weekly grid, total reps, due-today count) + server-side streak semantics wired into the home screen stats row, header streak pill, and historial weekly grid
type: spec
---

# Spec: Phase 4 — Streak & dashboard stats

| Field | Value                                                                                    |
|---|------------------------------------------------------------------------------------------|
| id | phase-4                                                                                  |
| status | approved                                                                                 |
| created | 2026-04-20                                                                               |
| roadmap | [ROADMAP.md §Phase 4](../ROADMAP.md#phase-4--streak--dashboard-stats) — features 401–402 |

---

## Why

Phase 3 landed the keystone interaction — picking a scenario and actually speaking Spanish to a voice agent — and started writing real `sessions` rows to the DB. But the UI that wraps that interaction is still a placeholder shell: the header streak pill shows `—`, the home-screen stats tiles show `—`, and the historial weekly grid shows `—` in all seven day cells. A learner who completes a session sees nothing about whether they've kept their streak alive, how their week looks, or whether anything is due — which undercuts the product's *consistency* promise.

Phase 4 wires the consistency signal end-to-end. Sessions already exist in the DB the moment they end (Phase 3); what's missing is the derived read path — a `/api/streak` endpoint — and the three UI surfaces that consume it. The deliverables are narrow, deliberately, because streak + dashboard stats are a thin derivation on top of the `sessions` table: no new column, no new background worker, no judge dependency. The streak is the only piece of the product feedback loop that should *not* wait for the LLM-as-judge — if a learner showed up and spoke Spanish, that counts toward the streak regardless of whether the judge has scored it yet. Decoupling streak from judging is the central design choice this phase commits to.

This also brings the product visually level with the reference screenshot in `docs/artifacts/habla-screenshot.png` (the "12 días seguidos" state in the header, the populated weekly dot grid, the non-placeholder stats row).

### Consumer Impact

The solo learner, after Phase 4, sees:

- **A live streak counter in the header.** `12 días seguidos` (or current count). Updates the instant they finish a session on a new day.
- **Dashboard stats that reflect reality.** The home screen's three tiles — `esta semana` (sessions count), `frases usadas` (total chunk deployments, still 0 until Phase 5 runs the judge), `pendientes hoy` (scenarios due today per SRS, still 0 until Phase 6 populates SRS) — all read from the DB instead of showing `—`. The latter two intentionally read 0 in Phase 4 because their upstream data isn't populated yet; the point is that the *wiring* is in place so Phases 5/6 flip them on with no frontend work.
- **A populated weekly grid in historial.** Each day L–D shows a filled dot if ≥1 session happened that day, an empty dot otherwise. Today is highlighted.
- **Nothing else changes.** No new views, no new modals, no post-session state transitions. A learner who doesn't look at the header or stats tiles won't notice the phase shipped.

### Roadmap Fit

- **Depends on Phase 3**: real `sessions` rows with `ended_at` and a non-`active` `analysis_status`. Phase 3 writes these on clean WS close (`pending`) and on abnormal close (`failed`). Phase 4 reads them.
- **Does *not* depend on Phase 5 or 6**: streak is computed from `sessions` directly; `frases usadas` and `pendientes hoy` read `chunk_deployments` and `scenario_srs` respectively and will naturally report 0 until those tables are populated. No coupling to the judge or SRS code path.
- **Unblocks nothing strictly** — Phase 5 (judge) and Phase 6 (SRS) don't read streak. But the `total_reps` and `due_today_count` fields returned by `/api/streak` are the surfaces those phases light up without touching the frontend.
- **Natural fit to also wire the `historial` session list here.** Phase 3's spec flagged the empty-state jarringness ("once Phase 3 starts persisting real sessions, historial still shows `aún no hay sesiones`"). Phase 4 already touches historial for the weekly grid; adding a minimal `GET /api/sessions` + list rendering is low-cost and removes the regression. Committing to this in the spec rather than deferring — see Key Decisions.

---

## What

### Acceptance Criteria

From the consumer's perspective:

- [ ] **Header streak pill shows the current streak.** `TopBar` renders `N días seguidos` with `N` sourced from `/api/streak`. The `—` placeholder state survives only while the initial fetch is in flight or if the fetch fails.
- [ ] **Streak increments on a new-day session.** If the last completed session was yesterday (Europe/Madrid), finishing a new session today bumps `current_streak` by 1. Visible without a page refresh (the home-screen refetch after `guardar sesión` surfaces the update).
- [ ] **Streak resets on a gap.** If the last completed session was ≥2 days ago (Europe/Madrid), finishing a new session today returns `current_streak = 1`. (Not 0 — the session itself is day 1.)
- [ ] **Streak is a no-op for same-day repeats.** A second session on the same day as the last one does not change `current_streak`, but it *does* increment `sessions_this_week` and the day's weekly-grid count.
- [ ] **Streak is judge-independent.** Streak reflects sessions with `ended_at IS NOT NULL` regardless of `analysis_status` (pending, judged, complete, or failed — as long as the session actually happened and has a transcript, it counts). A session that ended in `failed` (WS drop mid-conversation) still counts toward the streak provided `ended_at` is set and `transcript` is non-empty.
- [ ] **Home screen "esta semana" tile shows the count.** Number of sessions with `ended_at` in the current Madrid-local week (Mon–Sun). Updates live after a session end.
- [ ] **Home screen "frases usadas" tile shows `SUM(chunk_deployments.deployed)`.** Renders 0 in Phase 4 (no judge output yet). Sanity-verifiable by manually inserting a `chunk_deployments` row and confirming the tile updates on refetch.
- [ ] **Home screen "pendientes hoy" tile shows SRS-due scenarios.** Count of scenarios where `scenario_srs.due_at <= now` in Madrid local time. Renders 0 in Phase 4 (no SRS rows yet). Sanity-verifiable by inserting a `scenario_srs` row with `due_at` in the past.
- [ ] **Historial weekly grid is populated.** Each of the seven cells (L, M, X, J, V, S, D) shows a filled dot if one or more sessions ended on that day in the current Madrid-local week; empty dot otherwise. Today's cell is visually distinguished.
- [ ] **Historial "sesiones recientes" shows a list.** Up to 20 most-recent sessions with `ended_at IS NOT NULL`, each showing `{scenario.icon scenario.name}`, relative date (`hoy` / `ayer` / `hace N días` / date), and duration. Deployment ratio is a placeholder (`— frases`) in Phase 4 and gets wired in Phase 5.
- [ ] **All three surfaces refresh after session save.** `PostSession.guardar sesión` → `App.refetchAll` → streak/stats/grid reflect the new session with no manual reload.
- [ ] **Empty state handled.** With zero sessions in the DB, `/api/streak` returns `{current_streak: 0, last_session_date: null, sessions_this_week: 0, weekly_grid: [0,0,0,0,0,0,0], total_reps: 0, due_today_count: 0}`. The UI renders `0 días seguidos` in the header, `0` in the stats tiles, all-empty dots in the grid, and `aún no hay sesiones` in the historial list.
- [ ] **Reproduces the screenshot state.** Seeding a 12-day streak directly into `sessions` (a one-off script or SQL insert) reproduces the `12 días seguidos` + populated weekly grid state shown in `docs/artifacts/habla-screenshot.png`.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `cd backend && uv run pytest`, and `docker build .` all pass.

### Non-Goals

- **No change to how sessions are written.** `routes/sessions.py` and `routes/ws.py` are not modified. Phase 4 is read-side only.
- **No new DB columns, no migrations.** Streak is derived from `sessions.ended_at` on every `GET /api/streak`. No `streak_state` table, no `current_streak` column on anything. If the derivation becomes expensive at scale, it's cheap to materialize later; for a single-user app with ≤~thousands of sessions lifetime, the query is trivially fast.
- **No caching of `/api/streak` responses.** The endpoint is called on page load and after session save; running the SQL live is fine. If it becomes a hot path (it won't, single-user), revisit.
- **No SSE / WebSocket push of streak updates.** The existing `refetchAll()` after `PostSession` save is the refresh trigger. No realtime sync.
- **No streak "freeze" / grace period / recovery tokens.** Miss a day, streak resets. (Consistent with the product's "no gamification beyond a daily streak" stance in `OVERVIEW.md`.)
- **No streak animations, confetti, milestone badges.** Number in the pill. That's it.
- **No timezone configurability.** Europe/Madrid is hardcoded (see Key Decisions). No `TZ` env var, no per-user setting, no IP-based detection.
- **No wiring of `frases usadas` from anywhere except `chunk_deployments`.** In Phase 4 the value will be 0 because nothing writes to that table yet — that's correct; Phase 5's judge flips it on with zero frontend change.
- **No wiring of `pendientes hoy` from anywhere except `scenario_srs`.** Same shape: 0 in Phase 4, Phase 6's SM-2 update flips it on with zero frontend change.
- **No confidence bars on scenario cards, no due-state pills on scenarios.** Those read `scenario_srs` too but land in Phase 6 (feature 602).
- **No confidence delta in historial list.** Phase 6 deliverable (feature 603).
- **No per-session deployment ratio in historial list.** Phase 5 deliverable (feature 505-adjacent).
- **No historial-tab filters, search, pagination beyond the 20-row cap.** The list is a flat most-recent-first feed; that's enough at the expected session volume.
- **No deletion / re-assessment of past sessions from historial.** Read-only list.
- **No separate "monthly view" or calendar grid.** Weekly grid only. Per `OVERVIEW.md`, the product's consistency signal is weekly.
- **No tests of the frontend wiring.** Vitest still deferred per `OVERVIEW.md`. Backend pytest covers the streak derivation and endpoint contract; frontend verified manually.

### Open Questions

- **Do `failed` sessions count toward the streak?** ROADMAP language says "when `analysis_status` first reaches `ended`" — but Phase 3 doesn't write a literal `ended` state; it writes `pending` (clean end) or `failed` (abnormal WS drop). A `failed` session can still have a real partial transcript (the learner spoke for several turns before the tab closed). **Default: yes, failed counts** provided `ended_at IS NOT NULL` and `transcript` is non-empty / non-`[]`. Reason: from the learner's perspective they *practiced*; a network blip shouldn't cost them the streak. Encode the filter as `ended_at IS NOT NULL AND transcript IS NOT NULL AND transcript != '[]'` rather than filtering on `analysis_status`. If this proves noisy during Phase 4 dev (e.g., failed sessions with truly empty transcripts slip through because WS dropped before any turn finalized), tighten.
- **Do `active` sessions (in-flight right now) count toward "esta semana" or the weekly grid?** They aren't in a terminal state yet; they don't have `ended_at`. **Default: no.** Only sessions with `ended_at IS NOT NULL` are counted anywhere. An active session in the same tab is temporally concurrent with the stats view anyway — the learner will see the count update when they finish.
- **"Today" cutoff — midnight Madrid or rolling 24h?** Midnight-to-midnight in Europe/Madrid. Matches how a human thinks about a daily streak ("did I do one today?"). A session that ends at 00:01 counts for the new day; 23:59 counts for the old day. Not the last 24 hours.
- **Week start: Monday or Sunday?** Monday (ISO 8601 and the `L M X J V S D` order already rendered in `Historial.jsx`).
- **Response shape: array or object for `weekly_grid`?** ROADMAP proposes `{L,M,X,J,V,S,D}`. A seven-element array `[mon, tue, ..., sun]` is easier to map over in React and avoids the Spanish-label-as-key awkwardness. **Default: array** (`list[int]` of length 7, Monday-indexed). Frontend maps to the existing `WEEK_DAYS` labels by index. If a decision-record reviewer prefers the keyed object, that's a one-line change.
- **Should `total_reps` count deployments across all sessions, or only recent?** All-time sum per `OVERVIEW.md`'s "rep counter" framing. `SELECT SUM(deployed) FROM chunk_deployments` — no time window.
- **Should `due_today_count` be "due today" (strictly today's date) or "due now" (including overdue)?** Overdue counts as due. `SELECT COUNT(*) FROM scenario_srs WHERE due_at <= now()` in Madrid local time. Otherwise a learner who skipped two days would see 0 due today even though they're behind on everything.
- **Historial list in this phase or deferred?** Phase 3's open questions flagged adding a minimal list here would remove the regression. **Default: include it** — the endpoint + view changes are small, and it's the natural home for it. Covered below in Approach. If scope creep becomes a concern during implementation, the list is the clean thing to drop: it's independent of the streak / stats / grid work.
- **`GET /api/sessions` response shape.** If we add it, recommend `[{id, scenario: {id, slug, name, icon}, ended_at, duration_sec, self_assessment, analysis_status}]` limited to rows with `ended_at IS NOT NULL`, ordered `ended_at DESC`, capped at 20. No deployment ratio yet; add in Phase 5.
- **Do we need a `recent_sessions` in the `/api/streak` payload, or a separate `/api/sessions` route?** Separate route — `/api/streak` is cheap aggregates; `/api/sessions` is list data. Different cache semantics, different consumers (streak feeds header + home; sessions feeds historial). One endpoint per consumer.

---

## How

### Approach

Phase 4 is three small slices: **(A) backend `streak` + `sessions` list routes**, **(B) frontend api + App-level fetch**, **(C) UI rendering in TopBar / SesionHome / Historial**. All three are mechanical extensions on top of Phase 1/2/3 scaffolding; the only non-trivial logic is the streak derivation SQL + the Madrid-local-time date math.

#### Slice A — Backend routes

**New module: `backend/src/habla/routes/streak.py`**

```python
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Annotated

import aiosqlite
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from habla.db.connection import get_db

MADRID_TZ = ZoneInfo("Europe/Madrid")
router = APIRouter()
DbDep = Annotated[aiosqlite.Connection, Depends(get_db)]


class StreakOut(BaseModel):
    current_streak: int
    last_session_date: str | None           # ISO date, Madrid-local day
    sessions_this_week: int
    weekly_grid: list[int]                  # length 7, Mon..Sun counts
    total_reps: int
    due_today_count: int


@router.get("/streak", response_model=StreakOut)
async def get_streak(conn: DbDep) -> StreakOut: ...
```

Implementation notes:

- **Fetch the set of distinct session days.** `SELECT DISTINCT DATE(ended_at, 'localtime') FROM sessions WHERE ended_at IS NOT NULL AND transcript IS NOT NULL AND transcript != '[]'` — *but* SQLite's `'localtime'` modifier uses the server's system TZ, not Europe/Madrid explicitly. Fly runs UTC; the Docker container runs UTC. Instead: fetch `ended_at` as ISO strings, convert in Python using `datetime.fromisoformat(...).astimezone(MADRID_TZ).date()`, dedupe. Volume is small (dozens of rows) so per-row Python is fine.
- **Streak computation** (pure function, unit-testable):
  ```python
  def compute_streak(session_dates: set[date], today: date) -> tuple[int, date | None]:
      """Returns (current_streak, last_session_date).

      Streak is the count of consecutive days ending today or yesterday.
      - If the most recent session day is before yesterday, streak is 0.
      - Walk backward from the most recent session day, counting contiguous
        days present in the set.
      """
  ```
  Separate function (not inlined in the route) to pytest against golden cases: empty set, single today, single yesterday, single day-before-yesterday (streak 0), three-in-a-row ending today, ten-day gap with a run before it (streak 0), same-day multiple sessions (dedupe by day — count is 1).
- **`last_session_date`** is `max(session_dates)` or `None` if empty.
- **`sessions_this_week`**: raw count of sessions (not distinct days) with `ended_at` in the current Madrid-local Mon–Sun window. Computed the same way — fetch rows, convert, filter.
- **`weekly_grid`**: length-7 int array, Monday-indexed, count per day. Today's count included.
- **`total_reps`**: `SELECT COALESCE(SUM(deployed), 0) FROM chunk_deployments`. Returns 0 in Phase 4.
- **`due_today_count`**: `SELECT COUNT(*) FROM scenario_srs WHERE due_at IS NOT NULL AND due_at <= ?` where `?` is `datetime.now(MADRID_TZ).isoformat()`. Returns 0 in Phase 4.

**Register the router** in `backend/src/habla/main.py`:

```python
from habla.routes import streak as streak_routes
...
app.include_router(streak_routes.router, prefix="/api")
```

**New module: `backend/src/habla/routes/sessions_list.py`** (or extend `sessions.py` — see Key Decisions; leaning `sessions.py`):

```python
class SessionListItem(BaseModel):
    id: int
    scenario: ScenarioRef                   # {id, slug, name, icon}
    ended_at: str
    duration_sec: int
    self_assessment: int | None
    analysis_status: str


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(conn: DbDep, limit: int = 20) -> list[SessionListItem]:
    # SELECT s.id, s.ended_at, s.duration_sec, s.self_assessment, s.analysis_status,
    #        sc.id, sc.slug, sc.name, sc.icon
    # FROM sessions s JOIN scenarios sc ON s.scenario_id = sc.id
    # WHERE s.ended_at IS NOT NULL
    # ORDER BY s.ended_at DESC LIMIT ?
    ...
```

Put it in `sessions.py` alongside `start_session` / `assess_session` rather than a new file — the three-route module stays under ~150 LOC and the routes share a domain.

#### Slice B — Frontend API + App-level fetch

**`frontend/src/lib/api.js`** — append:

```js
export function getStreak() {
  return request("/api/streak");
}

export function listSessions() {
  return request("/api/sessions");
}
```

**`frontend/src/App.jsx`** — extend `refetchAll`:

```js
const [streak, setStreak] = useState(null);
const [sessions, setSessions] = useState([]);

const refetchAll = useCallback(async () => {
  const [s, c, st, se] = await Promise.all([
    api.listScenarios(), api.listChunks(), api.getStreak(), api.listSessions(),
  ]);
  setScenarios(s);
  setChunks(c);
  setStreak(st);
  setSessions(se);
  // ...
}, []);
```

Pass `streak` into `TopBar` and `SesionHome`; pass `streak` + `sessions` into `Historial`.

#### Slice C — UI rendering

**`TopBar.jsx`** — no API change needed. It already accepts `streak` as a prop (currently `null`); App starts passing `streak?.current_streak`.

**`SesionHome.jsx`** — swap the three `—` placeholders for values from `streak`:

- `esta semana` → `{streak?.sessions_this_week ?? "—"}`
- `frases usadas` → `{streak?.total_reps ?? "—"}`
- `pendientes hoy` → `{streak?.due_today_count ?? "—"}`

Preserve `—` as the loading/error state so the shape of the row doesn't jump.

**`Historial.jsx`** — takes two new props: `streak` and `sessions`.

Weekly grid:

```jsx
const weeklyGrid = streak?.weekly_grid ?? [0, 0, 0, 0, 0, 0, 0];
const todayIdx = getMondayIndex(new Date()); // 0..6 in Madrid tz
return (
  <div className="week">
    {WEEK_DAYS.map((label, i) => (
      <div key={label} className={`wday${i === todayIdx ? " wday-today" : ""}`}>
        <div className="wlabel">{label}</div>
        <div className={`wdot ${weeklyGrid[i] > 0 ? "wd-filled" : "wd-empty"}`}>
          {weeklyGrid[i] > 0 ? weeklyGrid[i] : "—"}
        </div>
      </div>
    ))}
  </div>
);
```

Computing "today's index" in Madrid time from the browser is a small trap: `new Date().getDay()` uses the browser's local TZ. Options:

1. Trust the browser's TZ and `new Date().getDay()` — produces wrong results for users outside Madrid. Single-user product + user lives in Madrid-ish TZ → low risk, but sloppy.
2. Use `Intl.DateTimeFormat("en-GB", {timeZone: "Europe/Madrid", weekday: "short"})` — correct and zero-dep.
3. Have `/api/streak` return `today_index: 0..6` — keeps date logic on the server.

**Default: option 2.** Add a small `lib/dates.js` helper: `madridWeekdayIndex(date)` returns Monday-indexed 0..6. Also usable for the historial list's relative-date labels.

Recent sessions list:

```jsx
{sessions.length === 0 ? (
  <div className="hist-empty">aún no hay sesiones</div>
) : (
  sessions.map((s) => (
    <div key={s.id} className="hist-row">
      <span className="hist-icon">{s.scenario.icon}</span>
      <span className="hist-name">{s.scenario.name}</span>
      <span className="hist-date">{relativeDate(s.ended_at)}</span>
      <span className="hist-duration">{formatDuration(s.duration_sec)}</span>
    </div>
  ))
)}
```

`relativeDate` → `hoy` / `ayer` / `hace N días` / `DD mmm`. `formatDuration` → `5:12 min` style. Both live in `lib/dates.js`.

Styles: extend `frontend/src/styles/global.css` with `.wday-today`, `.wd-filled`, `.hist-row`, `.hist-icon`, `.hist-name`, `.hist-date`, `.hist-duration` using the existing token palette (no new tokens needed). Match the layout in `docs/artifacts/habla-practice.html`.

#### Timezone hygiene

One single place owns "what day is it in Madrid":

- **Backend**: `MADRID_TZ = ZoneInfo("Europe/Madrid")` in `routes/streak.py`. All `datetime` conversions go through it.
- **Frontend**: `lib/dates.js` exports `madridWeekdayIndex`, `relativeDate`, `formatDuration`. All UI components consume these.

No `datetime.now()` without tz anywhere in the new code. `datetime.now(MADRID_TZ)` or `datetime.now(UTC)` explicitly.

**Docker base image** is `python:3.12-slim`, which ships `tzdata` — verify with `docker run --rm <image> python -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Madrid')"`. If `tzdata` isn't present (Debian slim sometimes strips it), add `apt-get install -y tzdata` in the Dockerfile's runtime stage. Otherwise `ZoneInfo` raises `ZoneInfoNotFoundError` at import-time.

#### File layout summary

Net-new + modified:

```
backend/src/habla/
├── main.py                          ← MOD: include streak router
└── routes/
    ├── streak.py                    ← NEW: GET /api/streak
    └── sessions.py                  ← MOD: add GET /api/sessions (list)

backend/tests/                       ← harness if not yet created in repo;
└── routes/                            Phase 5 is where the main pytest work
    └── test_streak.py               ← NEW: compute_streak unit tests
                                       + endpoint contract test

frontend/src/
├── App.jsx                          ← MOD: fetch streak + sessions, pass props
├── components/
│   └── TopBar.jsx                   ← MOD: pass current_streak value
├── lib/
│   ├── api.js                       ← MOD: getStreak + listSessions
│   └── dates.js                     ← NEW: madridWeekdayIndex, relativeDate, formatDuration
├── styles/
│   └── global.css                   ← MOD: .wday-today, .wd-filled, .hist-row, etc.
└── views/
    ├── SesionHome.jsx               ← MOD: read streak values into stats tiles
    └── Historial.jsx                ← REWRITE body: weekly grid + sessions list
```

No Dockerfile changes expected (if `tzdata` turns out to be missing, that's a one-line apt install). No pyproject/package.json changes.

### Confidence

**Level:** High

**Rationale:**

- Every piece of this phase is a thin read derivation on top of tables already populated (`sessions` by Phase 3) or correctly-empty-until-later-phases (`chunk_deployments`, `scenario_srs`). No new framework, no new service, no concurrency primitive, no migration.
- The streak computation is pure Python over an in-memory set of dates — trivially unit-testable against a handful of golden cases. The only subtle bit is TZ handling, and it's isolated to two touch points (one file on each side).
- The UI changes are prop-drilling + three small JSX swaps. No new overlay state, no state machine changes.
- `/api/streak` is called twice per session lifecycle (initial load + post-save refetch) — there's no hot-path concern, no cache invalidation, no realtime sync surface.
- Risks I'm tracking but not blocked by: `tzdata` absence in the slim image (one-line fix), the `ended_at IS NOT NULL AND transcript != '[]'` filter missing edge cases (unit-testable), and the historial list creeping past its "minimal" scope. All low-impact.

### Key Decisions

- **Streak is derived on every read, not persisted.** No `streak_state` table, no cached counter. Query `sessions` directly. Single-user, ≤thousands of rows lifetime, <1ms query. Rationale: one source of truth; no cache-invalidation bug surface; seeding/testing is a plain `INSERT`.
- **Streak counts any session with a real end.** `ended_at IS NOT NULL AND transcript IS NOT NULL AND transcript != '[]'`. Intentionally includes `failed` sessions (partial transcripts still represent practice time). Excludes WS drops before any turn finalized (empty transcript).
- **Europe/Madrid is the canonical TZ, hardcoded.** Product is specifically about Madrid Spanish; the learner is practicing on a Madrid-shaped schedule. A user traveling to another timezone will see slight drift in "what counts as today"; that's acceptable for a single-user product and can become a setting if it ever matters.
- **Week starts on Monday.** ISO 8601 + the existing `L M X J V S D` order in the UI. `weekly_grid[0]` is Monday.
- **`weekly_grid` is a length-7 int array, not a keyed object.** Easier to `.map()`, matches the JSX pattern already present in `Historial.jsx`.
- **`/api/streak` aggregates, `/api/sessions` lists.** Separate concerns, separate routes. Don't nest a `recent_sessions` array inside the streak payload.
- **Historial's session list ships in Phase 4.** Removes the Phase 3 regression, co-lives naturally with the weekly-grid changes in the same view. Deployment ratio column deferred to Phase 5 — the list shows session + duration + date + self-assessment only for now.
- **`refetchAll` is the refresh trigger.** No SSE, no WS broadcast, no polling. Post-session save already calls it.
- **`frases usadas` and `pendientes hoy` return 0 from the endpoint in Phase 4 and update automatically in Phases 5/6.** No frontend changes needed later.
- **`—` is the loading/error state only.** Once data has loaded, the UI shows real zeros (`0`), not placeholder dashes. Zero is meaningful; dashes are "we don't know yet".
- **No backend tests for the `GET /api/sessions` listing endpoint.** The compute_streak function gets unit tests (it's the phase's non-trivial logic); the endpoints are thin SQL wrappers and are verified by the manual acceptance run + a single happy-path integration test of `GET /api/streak`. The broader pytest harness expansion is a Phase 5 deliverable.

### Testing Approach

Per `OVERVIEW.md`, the formal pytest harness + golden-transcript fixtures land in Phase 5. Phase 4 adds the *first real* backend unit tests to the repo (Phase 3 added only the prompt-builder test), covering the streak derivation.

**Automated (lands this phase):**

- `backend/tests/routes/test_streak.py`:
  - `compute_streak` unit tests:
    - Empty set → `(0, None)`.
    - Single session today → `(1, today)`.
    - Single session yesterday → `(1, yesterday)`.
    - Single session day-before-yesterday → `(0, dby)`. (Streak broken.)
    - Three consecutive days ending today → `(3, today)`.
    - Three consecutive days ending yesterday → `(3, yesterday)`.
    - 10-day run ending 2 days ago → `(0, 10-days-ago-day)`. (Streak broken.)
    - 5-day run + 2-day gap + 3-day run ending today → `(3, today)`. (Most-recent run wins.)
    - Multiple same-day entries dedupe: `{today, today, yesterday}` set = `{today, yesterday}` → `(2, today)`.
  - `GET /api/streak` contract test (single happy path): seed a few sessions, call the endpoint via `httpx.AsyncClient(app=app)`, assert the response shape + values.

**Gates (must pass before merge):**

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `cd backend && uv run pytest`
- `docker build .`

**Manual verification (captured in decision record):**

1. **Cold boot with empty DB.** `npm run dev` → TopBar shows `0 días seguidos`, home tiles show `0`, historial grid all-empty, "aún no hay sesiones".
2. **Seed a 12-day streak.** SQL-insert 12 session rows with `ended_at` spanning the last 12 days in Madrid local time (script or one-liner documented in the decision record). Refresh → header shows `12 días seguidos`, `esta semana` tile shows 7 (or however many fell in the current Mon–Sun), weekly grid has all seven dots filled with counts, historial list shows 12 rows, most-recent first. Matches `docs/artifacts/habla-screenshot.png`.
3. **Miss-a-day reset.** Delete today's and yesterday's seeded rows, refresh → streak goes to 0; weekly grid loses today's dot.
4. **Finish a real session.** Start from empty DB (or post-reset state), run through the Phase 3 voice flow, `guardar sesión` → header updates to `1 días seguidos` without manual reload. Historial list has a row. Weekly grid has today's dot.
5. **Same-day second session.** Immediately after step 4, run another session → streak stays at 1, `sessions_this_week` increments to 2, today's weekly-grid count goes from 1 to 2.
6. **Failed-session still counts.** Force a WS drop mid-session (kill tab) → streak increments (if it's a new day) / `sessions_this_week` increments regardless.
7. **Empty-transcript failed session does NOT count.** Force a WS drop *before* any turn finalizes (drop immediately after WS accept) → row exists with `transcript = '[]'`, streak/grid unchanged.
8. **Historial list cap.** Seed 25 session rows → list shows exactly 20 (most-recent), no pagination surface.
9. **`frases usadas` wiring sanity.** Manually `INSERT INTO chunk_deployments (session_id, chunk_id, deployed) VALUES (1, 1, 1);`, refresh → tile value increments. (Confirms the read path; actual population comes from Phase 5.)
10. **`pendientes hoy` wiring sanity.** Manually `INSERT INTO scenario_srs (scenario_id, due_at) VALUES (1, datetime('now', '-1 day'));`, refresh → tile value increments. (Same sanity intent for Phase 6.)
11. **TZ edge cases.** Set system clock near Madrid midnight (or use a mocked-clock test case); confirm a session ended at 23:59 counts for the old day and 00:01 counts for the new day. Easier to verify via the pytest cases than a real clock change.

**Seeding helper (decision-record artefact, not shipped code):**

- A short SQL snippet or a `uv run python -m habla.scripts.seed_streak --days 12` one-off script that inserts N fake sessions with staggered `ended_at` values. Kept under `backend/scripts/` if written as Python, or inline in the decision record if plain SQL. Not checked into prod paths.

---

## Completion Criteria

- [ ] All required sections populated.
- [ ] Open questions resolved or explicitly deferred with defaults stated.
- [ ] Status flipped from `draft` → `approved` after human review.
- [ ] `ROADMAP.md` features 401–402 status flipped from `planned` → `in-progress`.
