---
name: Phase 4 — Streak & dashboard stats
description: Decision record for ROADMAP features 401–402. Implemented as read-side-only derivation over existing tables — no schema change, no worker, no judge coupling. Also landed GET /api/sessions list and wired TopBar / SesionHome stats / Historial weekly grid + recent sessions. Manual verification done via the user's smoke test; automated tests cover compute_streak edge cases + endpoint contract.
type: decision
---

# Decision Record: Phase 4 — Streak & dashboard stats

| Field | Value |
|---|---|
| id | phase-4 |
| status | implemented |
| created | 2026-04-20 |
| spec | [spec.md](./spec.md) |
| branch | `feat/phase-4-spec` |

---

## Context

Phase 3 shipped the Pipecat voice loop and started writing real `sessions` rows to the DB. The UI around it, however, was still placeholder: TopBar streak pill rendered `—`, the home stats tiles rendered `—`, and Historial's weekly grid was a row of dashes. Phase 4 closes that gap without touching Phase 3's write path.

What shaped the work during implementation:

- **No schema changes turned out to be the right call.** The spec committed to "derive everything on every read"; implementation confirmed this holds at 1ms-scale for single-user volumes, and eliminates a whole class of cache-invalidation bugs. No persisted streak counter, no `last_reviewed` column, no cache.
- **Pipecat's install footprint forced pragmatism in tests.** Booting the full `habla.main` FastAPI lifespan in tests pays for loading `LocalSmartTurnAnalyzerV3`, Silero VAD, and the torch stack — several seconds per test run. The endpoint contract test in `tests/routes/test_streak.py` sidesteps this by mounting only the streak router into a bare FastAPI app with an in-memory `aiosqlite` DB. Tests run in ~0.24s total across the whole suite.
- **The user smoke-tested with the seed script during implementation**, caught a real bug (seeded session rows left in the DB from a prior manual run + the `seed_streak --days 12` default surfaced as `13` rows on first refresh), and asked to clear it. Script is useful but its default isn't idempotent — documented.
- **A `/simplify` review pass after initial implementation caught concrete cleanups**: an existing `formatDuration` in `frontend/src/lib/format.js` that I'd missed, stringly-typed status strings where `SessionStatus` enum existed, over-fetching after every scenario/chunk CRUD op (chunks edits don't change streak — my initial `refetchAll()` pulled `/api/streak` + `/api/sessions` needlessly). All five cleanups landed before this record was written.
- **Scope included the `historial` session list.** The spec flagged it as the natural phase to remove Phase 3's "aún no hay sesiones with real sessions in the DB" regression. It landed cleanly as a second backend route + a small rewrite of `Historial.jsx`'s body — worth the inclusion.

## Decision

Ship Phase 4 as a read-side derivation layer: one new route `GET /api/streak` (aggregates) + one new route `GET /api/sessions` (recent list) reading directly from `sessions`, `chunk_deployments`, and `scenario_srs`, plus a frontend `lib/dates.js` that owns Madrid-local date math and prop-drilled `streak` + `sessions` into TopBar / SesionHome / Historial.

Concretely:

- **Backend:**
  - `backend/src/habla/routes/streak.py` (new): pure `compute_streak(session_dates, today) -> (streak, last_day)` + `GET /api/streak` returning `{current_streak, last_session_date, sessions_this_week, weekly_grid[7], total_reps, due_today_count}`. Session filter `ended_at IS NOT NULL AND transcript IS NOT NULL AND transcript NOT IN ('', '[]')` — includes `failed` sessions with real partial transcripts, excludes empty-transcript WS drops.
  - `backend/src/habla/routes/sessions.py` (mod): added `GET /api/sessions?limit=20` with `ScenarioRef` + `SessionListItem` models. Single JOIN query, ordered `ended_at DESC`, `limit` clamped to `[1, 100]`.
  - `backend/src/habla/main.py` (mod): registered streak router.
  - `backend/src/habla/scripts/seed_streak.py` (new): CLI that inserts N fake sessions with non-empty transcripts across the last N Madrid-local days. Not a production path.
  - `backend/tests/routes/test_streak.py` (new): 9 `compute_streak` unit goldens + 2 endpoint integration tests.
- **Frontend:**
  - `frontend/src/lib/dates.js` (new): `madridWeekdayIndex`, `relativeDate` — both use a module-level `Intl.DateTimeFormat` pinned to `Europe/Madrid`. `formatDuration` was not added here (reused existing `lib/format.js`).
  - `frontend/src/lib/api.js` (mod): `getStreak()`, `listSessions()`.
  - `frontend/src/App.jsx` (mod): `streak` + `sessions` state; three refetchers (`refetchAll`, `refetchScenariosAndChunks`, `refetchScenarios`) scoped to what each mutation actually invalidates.
  - `frontend/src/views/SesionHome.jsx` (mod): three stats tiles read from `streak`, `—` stays as the pre-data placeholder only.
  - `frontend/src/views/Historial.jsx` (rewritten body): weekly grid with today's cell highlighted via `madridWeekdayIndex`; recent-sessions list with icon/name/relative-date/duration; empty states preserved.
  - `frontend/src/styles/global.css` (mod): `.hist-row` + sub-classes using existing tokens.

No schema changes, no Dockerfile changes, no new dependencies. `tzdata` was already present in the `python:3.12-slim` runtime image — verified by a 2-minute sanity check before writing any code.

---

## Alternatives Considered

### Where to store the streak counter

**Option A:** Persist `current_streak` + `last_session_date` on a new `streak_state` table (or columns on a singleton `app_state` row). Update on session end.
- Pros: O(1) read.
- Cons: Two sources of truth (the sessions table and the cached counter). Cache-invalidation bugs are easy: miss a session write, miss a midnight boundary, miss a backfill, and the counter lies. Seeding test data requires a matching cached write. Schema change.

**Option B:** Derive from `sessions` on every `GET /api/streak`. No cache, no new column.
- Pros: Single source of truth. Zero-risk to seed (plain `INSERT`). Implementable in pure Python over a small row set.
- Cons: Full table scan per request. Trivially cheap at the expected volume (<1ms for thousands of rows on SQLite WAL).

**Chosen:** Option B. The "scan is too slow" concern doesn't materialise until tens of thousands of lifetime sessions, which this single-user product won't hit for years. If it ever does, adding a covering index on `ended_at` or a materialized counter is a one-commit change.

### Where the canonical "what day is it" lives

**Option A:** Browser's local time (`new Date().getDay()`). Trust the system clock wherever the user is.
- Pros: Zero config.
- Cons: A learner traveling outside Madrid sees a different "today" than the backend, and `/api/streak`'s `weekly_grid` indices would be inconsistent with the frontend's highlight.

**Option B:** Canonical `Europe/Madrid` on both sides. Backend uses `ZoneInfo("Europe/Madrid")`, frontend uses `Intl.DateTimeFormat({timeZone: "Europe/Madrid"})`.
- Pros: Backend and frontend always agree. Matches the product's "Madrid Spanish" framing.
- Cons: User in a distant TZ sees a slightly-off "today" — acceptable for single-user.

**Option C:** Make TZ configurable per user.
- Pros: Works anywhere.
- Cons: Single-user product doesn't need it; adds UI and storage surface for a hypothetical.

**Chosen:** Option B. Hardcoded via `MADRID_TZ = ZoneInfo("Europe/Madrid")` on the backend and a module-level `Intl.DateTimeFormat` pinned to the same zone on the frontend. Documented in the spec's Key Decisions.

### Whether `failed` sessions count toward the streak

**Option A:** Only `pending` / `judged` / `complete` count (i.e., filter on `analysis_status`).
- Pros: Clean "successful sessions only" semantics.
- Cons: A WS drop after 4 minutes of real conversation (network blip, tab close) persists as `failed` with a real partial transcript — not counting it means a good-faith session costs the learner their streak.

**Option B:** Count any session with `ended_at IS NOT NULL AND transcript != '[]'` regardless of status.
- Pros: Rewards practice effort, not network luck.
- Cons: Requires checking the transcript shape (not just status). Empty-transcript failures (WS drop before any turn finalized) must be explicitly excluded.

**Chosen:** Option B. Filter is `ended_at IS NOT NULL AND transcript IS NOT NULL AND transcript NOT IN ('', '[]')`. Unit test `test_get_streak_counts_real_sessions` verifies an empty-transcript `failed` row is excluded; a partial-transcript `failed` row (not seeded here but the filter admits it) counts.

### How broad the refetch-on-mutation should be

**Option A:** One `refetchAll` used by every CRUD handler (what I initially shipped).
- Pros: One callable, one code path, simple.
- Cons: Every scenario edit and every chunk edit fires `GET /api/streak` + `GET /api/sessions` too. These endpoints can't change from a scenario/chunk mutation — wasted round-trips.

**Option B:** Three scoped refetchers: `refetchAll` (initial load + post-session save), `refetchScenariosAndChunks` (chunk CRUD — chunks embed into scenarios payload, so both refresh), `refetchScenarios` (scenario CRUD — strict subset).
- Pros: Each handler only fires what it actually invalidates.
- Cons: Two more callbacks in `App.jsx`.

**Chosen:** Option B. Landed in the `/simplify` pass after the agent review flagged the over-fetch. Cost is ~15 LOC in `App.jsx`; benefit is eliminating two wasted API calls per chunk or scenario edit.

### Whether to add a backend test framework fixture

**Option A:** Stand up a shared `conftest.py` with a `client` + `seeded_db` fixture.
- Pros: Future tests plug in easily.
- Cons: Phase 5 is where the harness lands formally (per `OVERVIEW.md` and the ROADMAP). Anticipating Phase 5's design now risks building something that doesn't match what Phase 5 actually needs (judge fixtures, golden-transcript files, asyncio-worker harness).

**Option B:** Inline the minimal fixture in `test_streak.py`. Migrate to `conftest.py` when Phase 5 lays down its pattern.
- Pros: Don't pre-commit to a harness shape.
- Cons: Per-test setup duplication if many route tests accrue before Phase 5.

**Chosen:** Option B. Two tests; trivial setup; no premature abstraction. Phase 5 will own the decision.

---

## Tradeoffs

**Optimized for:**
- Read-side simplicity and single-source-of-truth. `sessions` is the only place that tracks session reality; everything else is a function of it. Seeding, testing, and debugging are all plain SQL.
- Judge independence. The streak never waits on Anthropic Sonnet. A user who practices and goes offline still sees their streak update.
- Zero-risk deploy. No schema change, no migration, no new background worker. If something breaks, revert.
- Consistency of "what day is it" across stack. Both sides pin to `Europe/Madrid`; no drift.

**Given up / accepted:**
- `/api/streak` is recomputed on every call (full session scan). Acceptable until tens-of-thousands of rows; cheap to cache later if needed.
- `frases usadas` tile reads `SUM(deployed) FROM chunk_deployments`, which is always 0 until Phase 5 runs the judge. Same for `pendientes hoy` (reads `scenario_srs.due_at`, empty until Phase 6). The tiles deliberately render `0`, not `—`, because zero is meaningful — and the wiring lights up automatically when Phases 5/6 start writing.
- Madrid TZ is hardcoded. A user outside Madrid sees midnight drift. Explicit non-goal in the spec; revisit if it matters.
- The `historial` session list has no deployment-ratio column yet. Renders the row, the date, the duration. Phase 5 adds "X / Y frases desplegadas" per row.
- Server-side max-duration grace, `failed` vs `pending` semantics, and all the Phase 3 lifecycle detail stay as-is. Phase 4 didn't touch the write path.
- Test harness is minimal (9 unit + 2 integration). Phase 5 grows it properly. A clean `conftest.py` + `httpx` fixture would be nicer; not worth pre-committing.

---

### Spec Divergence

| Spec Said | What Was Built | Reason |
|---|---|---|
| "Validate via `docker compose exec backend python -c 'ZoneInfo(...)'`; add `tzdata` to Dockerfile if it raises." | Validated via `docker run --rm habla-backend:dev ...`; `tzdata` already present. No Dockerfile change. | Dockerfile didn't need modification; the base image ships `tzdata`. |
| "Weekly grid cell shows filled dot if ≥1 session; today visually distinguished." | Same, but reuses existing `.wd-today` + `.wd-done` + `.wd-empty` classes from `frontend/src/styles/global.css` instead of adding `.wday-today` + `.wd-filled` as the spec's Approach section suggested. | Existing classes matched the design tokens (`--green`, `--green-light`) already set up for this purpose. Adding new classes would have duplicated the intent. |
| Historial "sesiones recientes" row shows scenario icon + name + relative date + duration + "`— frases`" placeholder for deployment ratio. | Shows the first four; dropped the deployment-ratio placeholder for now. | Extra column adds visual noise for a value that's always 0 until Phase 5. Phase 5 will add it alongside the ⏳ → ✓/✗ transitions. Spec non-goal #3 deferred "per-session deployment ratio" to Phase 5 anyway; the placeholder was the spec's own ambivalence. |
| `compute_streak` walks backward counting days. | Same. | ✓ |
| `GET /api/sessions?limit=20`, clamped 1..100. | Same. | ✓ |
| Unit tests for 9 `compute_streak` edge cases + 1 endpoint integration test. | 9 unit + 2 integration (added empty-DB case explicitly). | Small expansion; the empty-DB response shape matters and was cheap to cover separately from the seeded case. |
| Seeding helper lives in `backend/scripts/` per spec's Approach bullet list. | Lives in `backend/src/habla/scripts/seed_streak.py` so it's importable as `python -m habla.scripts.seed_streak`. | The `backend/src/habla/` package already owns everything that `-m` needs to import (settings, connection, schema). Putting the script outside that tree would have required duplicating imports or adding `sys.path` hacks. |
| Manual verification: all 11 steps in spec §Testing Approach run and captured here. | User ran the smoke test (seed + browser check, streak pill visible, history list populated). Did not formally walk through all 11 steps. Empty-DB state verified via automated test + manual DB clear. | The user drove manual verification themselves and was satisfied with the smoke test. Formal 11-step procedure is available in the spec if ever needed for regression. |
| Formatting / stats: `—` only as loading state. | Same. | ✓ |
| Europe/Madrid hardcoded on both sides. | Same. | ✓ |

Everything else landed as specified.

---

## Spec Gaps Exposed

- **Seed script hygiene.** `seed_streak --days 12` run twice without clearing leaves 24+ rows. The script should either `DELETE FROM sessions` at start (opt-in via `--reset`) or at least warn if existing sessions overlap the target date range. Minor dev-UX follow-up; not a product concern.
- **`seed_streak` default of 12 days masks the real empty state.** I wrote the script as part of the spec's seeding deliverable but its default behaviour (inserting 12 rows) creates the impression of a seeded environment before the user realizes the DB isn't clean. Defaulting `--days` to 0 (require explicit count) or printing a clear "seeded N rows; remember to clear them" message would be less surprising. Flag for the script's next revision.
- **`failed` session filter needs a decision for the list route.** `GET /api/sessions` intentionally *does not* apply the transcript filter — it shows every session that ended, including empty-transcript failures. The spec flagged this ambiguity in Key Decisions ("historial list shows every session that ended... Reconsider if noisy"). Leave as-is until it's noisy in practice; document the asymmetry.
- **Timezone: no browser-mismatch warning.** If a user's browser clock is in a very different TZ, "today" on the frontend's highlight and "today" on the backend's aggregates are consistent (both Madrid), but the user might be surprised that *their* midnight isn't streak-midnight. No runtime check or soft warning. Not worth building now; note it.
- **No SSE / push for streak updates during an active session.** The streak only updates on the next `refetchAll` after the user returns to home. A learner who completes a session and stares at the TopBar for a while before clicking `guardar sesión` won't see it increment until after the save round-trip. Acceptable; document it.

None of these warrant a spec revision. The seed-script hygiene is a candidate for a tiny follow-up if it bites again.

---

## Test Evidence

Backend `pytest` — full suite (Phase 3's prompt tests + Phase 4's streak tests), via `docker compose run --rm backend uv run pytest -v`:

```
============================= test session starts ==============================
platform linux -- Python 3.12.13, pytest-9.0.3, pluggy-1.6.0 -- /app/backend/.venv/bin/python
cachedir: .pytest_cache
rootdir: /app/backend
configfile: pyproject.toml
testpaths: tests
plugins: anyio-4.13.0, asyncio-1.3.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 21 items

tests/agent/test_prompt.py::test_prompt_contains_scenario_name_and_icon PASSED [  4%]
tests/agent/test_prompt.py::test_prompt_contains_every_chunk_text PASSED [  9%]
tests/agent/test_prompt.py::test_prompt_does_not_command_chunks PASSED   [ 14%]
tests/agent/test_prompt.py::test_prompt_is_spanish_only_scaffolding PASSED [ 19%]
tests/agent/test_prompt.py::test_prompt_is_under_size_cap PASSED         [ 23%]
tests/agent/test_prompt.py::test_fingerprint_is_deterministic_and_sensitive PASSED [ 28%]
tests/agent/test_prompt.py::test_prompt_handles_all_seed_icons[☕] PASSED [ 33%]
tests/agent/test_prompt.py::test_prompt_handles_all_seed_icons[🏪] PASSED [ 38%]
tests/agent/test_prompt.py::test_prompt_handles_all_seed_icons[🏠] PASSED [ 42%]
tests/agent/test_prompt.py::test_prompt_handles_all_seed_icons[🚇] PASSED [ 47%]
tests/routes/test_streak.py::test_compute_streak_empty PASSED            [ 52%]
tests/routes/test_streak.py::test_compute_streak_single_today PASSED     [ 57%]
tests/routes/test_streak.py::test_compute_streak_single_yesterday PASSED [ 61%]
tests/routes/test_streak.py::test_compute_streak_single_day_before_yesterday_is_broken PASSED [ 66%]
tests/routes/test_streak.py::test_compute_streak_three_consecutive_ending_today PASSED [ 71%]
tests/routes/test_streak.py::test_compute_streak_three_consecutive_ending_yesterday PASSED [ 76%]
tests/routes/test_streak.py::test_compute_streak_ten_day_run_ending_two_days_ago_is_broken PASSED [ 80%]
tests/routes/test_streak.py::test_compute_streak_most_recent_run_wins PASSED [ 85%]
tests/routes/test_streak.py::test_compute_streak_same_day_dedupes_via_set PASSED [ 90%]
tests/routes/test_streak.py::test_get_streak_empty_db PASSED             [ 95%]
tests/routes/test_streak.py::test_get_streak_counts_real_sessions PASSED [100%]

============================== 21 passed in 0.24s ==============================
```

Format / lint / typecheck gates:

```
# uv run ruff check .
All checks passed!

# uv run ruff format --check .
25 files already formatted

# uv run pyright
0 errors, 0 warnings, 0 informations

# prettier --check 'frontend/src/**/*.{js,jsx}'
Checking formatting...
All matched files use Prettier code style!

# cd frontend && npm run build
vite v6.4.2 building for production...
✓ 108 modules transformed.
dist/index.html                   0.72 kB │ gzip:   0.40 kB
dist/assets/index-jzdJYPxB.css   18.76 kB │ gzip:   3.81 kB
dist/assets/index-N0V5dstV.js   647.30 kB │ gzip: 182.73 kB
✓ built in 889ms

# docker build .
naming to docker.io/library/habla-phase4-check:latest done
DONE
```

Manual verification: user smoke-tested the flow (seeded via `python -m habla.scripts.seed_streak`, observed the 12-day streak pill + populated weekly grid + historial rows; asked to clear 13 stale rows from the DB which were removed via a direct `DELETE FROM sessions`). Not all 11 formal steps from the spec were exercised; the ones the user did walk through (seed + render + clear) confirmed the core read path works end-to-end.
