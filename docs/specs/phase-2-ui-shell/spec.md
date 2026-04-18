---
name: Phase 2 — UI shell
description: Bundled spec for ROADMAP features 201–206 — design tokens, three-tab shell, sesión/frases/historial views, scenario creation UI
type: spec
---

# Spec: Phase 2 — UI shell (no voice yet)

| Field | Value |
|---|---|
| id | phase-2 |
| status | approved |
| created | 2026-04-18 |
| roadmap | [ROADMAP.md §Phase 2](../ROADMAP.md#phase-2--new-ui-shell-no-voice-yet) — features 201–206 |

---

## Why

Phase 1 cut over to the Python backend and a clean schema, and explicitly accepted a broken legacy frontend as interim state ("broken UI is fine, build passing is what matters" — ROADMAP Phase 1 exit criteria). The legacy `App.jsx` (598 lines, English copy, monologue/recording flow, hits `/api/topics`) renders with errors against the new `/api/scenarios` + `/api/chunks` shapes. Phase 2's job is to replace it with the real product surface, matching the design in `docs/artifacts/habla-practice.html` and `docs/artifacts/habla-screenshot.png`.

This is the shell Phase 3 (voice) will plug into. `LiveSession` lands as a stub here (timer only) so that the Pipecat client can be inserted in Phase 3 without touching navigation, state wiring, or the post-session flow.

### Consumer Impact

The solo learner gets the real product surface for the first time:

- **Spanish-only UI.** No English copy anywhere. `sesión` / `frases` / `historial` tabs, `empezar sesión`, `repasa hoy`, `frases usadas`, etc.
- **A usable scenario + chunk authoring workflow.** Today they can only CRUD scenarios/chunks via `curl`; the Phase 2 UI makes the `+ nuevo escenario` and `+ nueva frase` flows real.
- **A credible preview of the product shape.** Stats row, scenario cards with confidence bars + due pills, duration picker, chunk preview pills — even though stats, confidence, and due-state are placeholders until Phases 4/6, the learner can see what the product will feel like.
- **Session start is a known stub.** `empezar sesión` routes to a `LiveSession` that just runs the timer and returns to the post-session screen. Deliberate: the voice agent lands in Phase 3 without any remaining UI scaffolding work.

### Roadmap Fit

- **Depends on Phase 1** (implemented): the `/api/scenarios` and `/api/chunks` payload shapes, the 4-scenario × 6-chunk seed, the Vite dev proxy. No backend changes in Phase 2.
- **Blocks Phase 3**: the `LiveSession` and `PostSession` views need to exist as components before the Pipecat client and WebSocket plumbing can be inserted.
- **Defers placeholders to later phases**: stats row numbers, streak count, confidence %, due-state pill, rep counts, weekly grid, historial delta all render as visible placeholders (zero-state / hardcoded values) until Phases 4 (streak + dashboard), 5 (rep counts), and 6 (SRS) wire real data.

---

## What

### Acceptance Criteria

From the consumer's perspective:

- [ ] The app loads to the `sesión` tab with Spanish-only copy, DM Sans + DM Mono typography, the dark palette, and the green `#1D9E75` accent. Visually matches `docs/artifacts/habla-screenshot.png`.
- [ ] Tabs `sesión` / `frases` / `historial` switch without a full reload; the active tab underline tracks the selection.
- [ ] Top-bar streak pill shows `— días seguidos` (placeholder dash or `0` — real value in Phase 4).
- [ ] `sesión` tab shows three stat tiles (esta semana / frases usadas / pendientes hoy), the four seeded scenarios as selectable cards, a chunk-preview row for the selected scenario, a duration picker (5/10/15/20 min), and an `empezar sesión` button.
- [ ] Clicking a scenario card selects it (green border + glow); the `FRASES · {scenario}` row below updates to that scenario's chunk pills.
- [ ] `+ nuevo escenario` opens a creation UI: name, emoji, multi-select of existing chunks. Submitting calls `POST /api/scenarios` and the new card appears on return.
- [ ] An existing scenario card exposes edit + delete (surface TBD — context menu or secondary click; the UI may be minimal but both actions must be reachable).
- [ ] `frases` tab shows every chunk with a rep-count circle (placeholder `0` for every row in Phase 2), Spanish text, Spanish gloss, and a tag badge. Tag filter pills work client-side.
- [ ] `+ nueva frase` opens a creation form (text_es, gloss_es, tags). Submitting calls `POST /api/chunks` and the new chunk appears.
- [ ] Chunks in the `frases` tab are editable + deletable.
- [ ] `historial` tab renders the weekly dot grid (empty state OK — all placeholders until Phase 4) and a "sesiones recientes" list (empty state OK — populated in Phase 3 onward).
- [ ] Clicking `empezar sesión` routes to a stub `LiveSession` view that shows the scenario name, chunk pills, and a running timer counting down from the selected duration. There is no voice agent. Clicking `terminar` or timer-expiry routes to `PostSession`.
- [ ] `PostSession` shows the self-assessment row (difícil / regular / bien / fluido) and a list of scenario chunks each marked `⏳ pendiente`. `guardar sesión` returns to the `sesión` tab. No session persistence in Phase 2 — the POST API for sessions lands in Phase 3.
- [ ] All previous views (`Practicar`, `Explorar`, `Progreso`) and the upload-recording code path are gone from `frontend/src/`.
- [ ] `npm run build` succeeds; no runtime errors in the browser console during a full navigation through all three tabs + the session stub.
- [ ] `npm run format:check` passes.

### Non-Goals

- **No voice agent, no WebSocket, no Pipecat.** `LiveSession` is a timer-only stub. All of that lands in Phase 3.
- **No real streak, no real confidence, no real due-state, no real rep counts, no real weekly grid.** These are placeholders / zero-state until Phases 4–6. Do not compute any of them client-side as a shortcut.
- **No `/api/sessions` calls.** Those routes don't exist yet; don't invent frontend plumbing that calls them.
- **No session persistence.** The Phase 2 session stub doesn't write anything to the DB.
- **No router library.** Tab switching is local state; the session-stub / post-session transitions are local state. React Router is overkill for three tabs + two modal-ish full-screens.
- **No testing framework.** Vitest lands if/when needed; Phase 2 is verified by manual navigation + the existing build + format gates.
- **No design-system abstraction.** Styles live as plain CSS with a tokens file. No CSS-in-JS, no Tailwind, no component library.
- **No mobile/responsive polish beyond what the artifact already shows.** The artifact is a 390×720 phone frame; Phase 2 targets that viewport. Desktop scaling can come later.
- **No i18n framework.** Copy is Spanish strings in JSX. We are never adding English, so there is nothing to switch between.
- **No accessibility audit.** Basic semantic HTML + keyboard navigation for buttons is enough; no ARIA sweep in this phase.

### Open Questions

- **Scenario card edit/delete affordance.** Right-click menu? A small pencil icon on hover? A dedicated edit screen reached by long-press / secondary tap? The artifact doesn't show one. **Default:** keep it minimal — an edit mode toggle in the creation modal, reached by clicking the card's name area (or a small icon in the corner). Decide during implementation; worth noting in the decision record.
- **Chunk edit/delete in the `frases` tab.** Same question. **Default:** clicking a chunk row opens an inline-expanding edit form; delete is a button inside that form.
- **Where does the `+ nuevo escenario` modal live?** Full-screen overlay, like `LiveSession`? Or an inline expanding card? **Default:** full-screen overlay, consistent with `LiveSession` / `PostSession`. Easier to build, matches the artifact's framing.
- **Stats row in Phase 2.** Show hardcoded placeholder values (`5`, `48`, `2` from the artifact) or zero-state (`0`, `0`, `0`)? **Default:** zero-state with dashes — honest signal that the feature isn't wired yet. Placeholders that look real risk confusing the learner.
- **Deferred:** whether to preserve a `localStorage` of the last-selected scenario + duration for nicer UX. The artifact doesn't require it; Phase 2 can skip and Phase 3 can add.

---

## How

### Approach

**File layout** (net-new, replacing the legacy `App.jsx`):

```
frontend/src/
├── main.jsx                      ← unchanged entry
├── App.jsx                       ← rewritten: top-bar + tabs + view router + session-overlay state
├── views/
│   ├── SesionHome.jsx            ← stats + scenario cards + preview + duration + start button
│   ├── Frases.jsx                ← chunk list + tag filter + add/edit/delete
│   ├── Historial.jsx             ← weekly grid + recent sessions list (both empty-state in P2)
│   ├── LiveSession.jsx           ← timer-only stub: header, orb placeholder, chunk pills, footer
│   └── PostSession.jsx           ← self-assessment + pendiente chunks + guardar
├── components/
│   ├── ScenarioCard.jsx          ← icon + name + confidence bar + due pill
│   ├── ChunkPill.jsx             ← preview pill used on SesionHome
│   ├── ChunkRow.jsx              ← full chunk row used on Frases
│   ├── ScenarioEditor.jsx        ← full-screen overlay: create/edit scenario
│   └── ChunkEditor.jsx           ← inline or modal: create/edit chunk
├── lib/
│   ├── api.js                    ← rewritten: fetchScenarios, createScenario, etc. (drop uploadRecording)
│   └── format.js                 ← small helpers: formatDuration, dueLabel placeholder, etc.
└── styles/
    ├── tokens.css                ← design tokens ported from docs/artifacts/habla-practice.html :root
    └── global.css                ← reset + base body styles; per-component styles live next to components or in global.css sections
```

**Design tokens** (`tokens.css`): lift the `:root` block wholesale from `docs/artifacts/habla-practice.html` (colors, radii, fonts). Font faces come from `https://fonts.googleapis.com` via `index.html` `<link>` (matching the artifact) to avoid bundling 400kb of font WOFFs. Delete `styles/global.css`'s current contents; replace with reset + body + font-family + scrollbar styling drawn from the artifact.

**App shell** (`App.jsx`):

- Local state: `activeTab: 'sesion' | 'frases' | 'historial'`, `overlay: null | {kind: 'live', sessionStub} | {kind: 'post', sessionStub} | {kind: 'scenario-editor', scenario?}`.
- Renders `<TopBar />`, `<TabNav />`, and one of the three view components. If `overlay` is set, renders the overlay on top (absolute-positioned div like `.session-screen` and `.post-screen` in the artifact).
- The "session stub" flow: `SesionHome` calls `onStart(scenario, durationSec)` → `App` sets overlay to `live`. `LiveSession` calls `onEnd()` (timer expiry or `terminar`) → overlay becomes `post`. `PostSession` calls `onSave()` → overlay cleared, back to `sesion` tab.

**`lib/api.js` rewrite**:

```js
export async function listScenarios() { /* GET /api/scenarios */ }
export async function createScenario({slug, name, icon, chunk_ids}) { /* POST */ }
export async function updateScenario(id, body) { /* PUT */ }
export async function deleteScenario(id) { /* DELETE */ }
export async function listChunks() { /* GET /api/chunks */ }
export async function createChunk({text_es, gloss_es, tags}) { /* POST */ }
export async function updateChunk(id, body) { /* PUT */ }
export async function deleteChunk(id) { /* DELETE */ }
```

Plain `fetch` + small JSON helpers; throw on non-2xx with the server's `detail` message. No external HTTP client. Drop `uploadRecording` entirely.

**Data fetching**: each view fetches its own data in a `useEffect` on mount. No global store. Scenario/chunk mutations optimistically re-fetch the relevant list on success (simple refetch; no cache invalidation library). When editing a scenario that affects chunk membership, both lists are re-fetched.

**Tag filter in `frases`**: tag options derive from the union of `chunks[*].tags`. Filter is client-side — `tags` is a comma-separated string; split and match. The artifact hardcodes `todo / bar / social / calle`; the real implementation should derive these from actual chunk data.

**`ScenarioEditor`** (full-screen overlay):

- Form: `name` (text), `icon` (text input accepting a single emoji — no picker in Phase 2; learner types or pastes), `chunk_ids` (multi-select against the full chunk list, rendered as toggleable pills grouped or searchable by tag).
- Slug is auto-derived from name (lowercase, hyphenated, strip non `[a-z0-9-]`). If the derived slug collides (409 from backend), surface the error and let the learner edit.
- Edit mode pre-fills from an existing scenario; submit calls `PUT /api/scenarios/:id`.
- Delete button appears only in edit mode; confirm via a native `window.confirm` in Phase 2 (no custom modal).

**`ChunkEditor`**: simpler. Inline expansion of a chunk row, or a small modal — implementer's call. Fields: `text_es`, `gloss_es`, `tags` (comma-separated input).

**`LiveSession` stub**:

- Props: `{scenario, durationSec, onEnd}`.
- Renders the session-screen layout from the artifact: header (scenario name + timer), a static agent orb (no rings animation needed, or keep the CSS ring pulse — cheap and looks alive), chunk pills (all inactive — no `.hit` state until Phase 5), `terminar` / `pausa` footer.
- `useEffect` starts a 1-second interval decrementing `remaining`; on zero, calls `onEnd()`. `terminar` calls `onEnd()` immediately. `pausa` toggles the tick (the artifact's behavior).
- No WS, no mic permission, no audio. Deliberate.

**`PostSession` stub**:

- Props: `{scenario, onSave}`.
- Renders the post-screen layout: async-notice banner, self-assessment row, chunks all marked `⏳ pendiente`, `guardar sesión` button.
- Self-assessment is local state — Phase 2 does not POST it anywhere (`/api/sessions/:id/assess` doesn't exist yet). `guardar sesión` just calls `onSave()`.

**Legacy teardown**:

- Delete the entire current `App.jsx` body and rewrite.
- Delete `lib/api.js`'s `uploadRecording` (rewritten above).
- Confirm no leftover references to `Practicar`, `Explorar`, `Progreso`, or topics. Grep before PR.

### Confidence

**Level:** High

**Rationale:**
- The design artifact (`docs/artifacts/habla-practice.html`) is a fully-working HTML/CSS/JS prototype of the entire Phase 2 surface. Porting it to React components is mechanical: tokens, styles, and even the behavioral JS (tab switch, scenario select, session stub, post-session) are already specified and demonstrable.
- The backend API is stable from Phase 1, already curl-verified against the exact payload shapes this frontend needs.
- React 19 + Vite 6 is set up, builds cleanly, hot-reloads via the existing Vite dev proxy to FastAPI.
- The only non-trivial decisions are UX affordances for edit/delete and overlay vs. inline editors — both tracked as open questions with defaults. None block shipping; they're resolvable during implementation and documented in the Phase 2 decision record.
- No external services, no new dependencies beyond the DM Sans + DM Mono `<link>` (which is not a package dep).

### Key Decisions

- **Vanilla CSS + per-component `.css` files or one `global.css`, not CSS-in-JS / Tailwind.** Matches the artifact, minimizes dependencies, matches Phase 1 frontend minimalism. Implementer may split global.css into per-view sections keyed on class prefixes (`.sc-*`, `.cpill-*`, etc.) — same as the artifact does.
- **No router.** Three tabs + two overlay screens = `useState` in `App.jsx`. React Router would add a dep without clarifying anything.
- **No state management library.** Per-view `useEffect + useState`. If/when the wiring grows complex (Phase 4/5 cross-view invalidation), re-evaluate.
- **Zero-state placeholders over hardcoded values.** Stats row, streak, confidence, due pill all render as dashes / empty state until the real data arrives in Phases 4–6. Never hardcode `5 sesiones` in a way that looks real.
- **Session stub persists nothing.** The API doesn't exist yet; adding localStorage "fake sessions" would have to be deleted in Phase 3. Skip.
- **`ScenarioEditor` is a full-screen overlay, not a modal.** Matches the session-screen framing from the artifact. Phones first.

### Testing Approach

Per `OVERVIEW.md`, frontend tests are deferred ("deferred — Vitest is the obvious default if/when the React surface grows complex enough"). Phase 2 adds no tests.

Verification is manual + gate-driven:

1. **Gates** (must pass before merge):
   - `npm run format:check`
   - `npm run lint` (Python-only, unaffected)
   - `npm run typecheck` (Python-only, unaffected)
   - `npm run build` — frontend production build with no warnings
   - No browser-console errors during a full click-through

2. **Manual verification script** (to be captured in the decision record with actual output):
   - Load `/` → `sesión` tab renders with four seeded scenarios, each clickable. Chunk preview below updates on selection.
   - Tab switch to `frases` → 24 chunks render with rep-count `0`, tag filter pills derived from real data.
   - Create a new scenario via `+ nuevo escenario` → POST lands, card appears in the list.
   - Edit an existing scenario → PUT lands, updated name renders.
   - Delete a scenario → DELETE lands, card disappears.
   - Same three flows for chunks on the `frases` tab.
   - `empezar sesión` → timer counts down from the selected duration; `terminar` and expiry both route to `PostSession`; `guardar sesión` returns home.
   - `historial` tab renders empty state cleanly.
   - Visual diff against `docs/artifacts/habla-screenshot.png` — at a glance indistinguishable.

3. **API contract check**: confirm no frontend code path calls `/api/sessions*`, `/api/upload`, or `/api/topics`. Grep the tree before merging.

Frontend tests land when the surface gets complex enough to need them — most likely Phase 3 (voice client state machine) or Phase 5 (post-session status polling), per `OVERVIEW.md`.
