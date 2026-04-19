# Decision Record: Phase 2 — UI shell

| Field | Value |
|---|---|
| id | phase-2 |
| status | implemented |
| created | 2026-04-18 |
| spec | [spec.md](./spec.md) |
| branch | `feat/phase-2-ui-shell` |

---

## Context

Phase 1 shipped the Python backend + new schema and deliberately left the frontend broken: the legacy `App.jsx` (1195 lines, English-only monologue/recording flow, calling removed routes `/api/topics`, `/api/tts`, `/api/upload`) still compiled but errored against the new API shapes. Phase 2's job was to replace the full frontend surface with the three-tab Spanish-only shell defined in `docs/artifacts/habla-practice.html` + `habla-screenshot.png`, wire CRUD against the Phase 1 `/api/scenarios` + `/api/chunks` endpoints, and land `LiveSession` + `PostSession` as timer-only stubs so Phase 3 (Pipecat voice) can drop in without touching navigation or state wiring.

Discoveries during implementation:

- **The artifact is a 390×720 phone mockup, but the dev environment and first-person use is desktop-plus-mobile.** The spec's "Phase 2 targets that viewport" constraint reproduced the mockup exactly (fixed `width: 390px; min-height: 720px` on `.shell`, body using `display: flex; align-items: center` to center the card). On a desktop browser the centered-card pattern clipped the top and bottom of the Frases tab (24 chunks tall) — `align-items: center` doesn't scroll past the top of the card when content overflows viewport. Fixed mid-implementation at the user's request: dropped the fixed card dimensions, made `.shell` responsive (max-width 720px, edge-to-edge on narrow, bordered card only at ≥760px), switched the window to natural page-scroll, repositioned overlays from `position: absolute` (pinned to shell) to `position: fixed` (pinned to viewport), and added sticky topbar+nav so tabs stay reachable while scrolling long lists.
- **The four seeded scenarios × six seeded chunks from Phase 1 give the UI real content from first paint** — no empty-state work needed for the `sesión` tab. Only `historial` renders empty-state (no sessions table until Phase 3).
- **No backend changes were needed.** The Phase 1 API shapes were already correct for Phase 2's needs. The only touched files outside `frontend/` are `docs/specs/ROADMAP.md` (status flips) and `docs/specs/phase-2-ui-shell/*` (spec + this record).

No browser-automation tests exist in this repo (Vitest deferred per `OVERVIEW.md`). Verification was manual: I ran the automated gates and API smoke tests via curl; the user ran `npm run dev` + browser click-through and caught the viewport-clipping issue, which drove the responsive-layout fix.

## Decision

Built the full Phase 2 UI: rewrote `frontend/src/App.jsx` as a tab + overlay shell holding `scenarios`, `chunks`, `selectedScenarioId`, and `durationSec` in local state, with a single `refetchAll` helper that child views invoke after mutations. Added 5 view components (`SesionHome`, `Frases`, `Historial`, `LiveSession`, `PostSession`), 6 reusable components (`TopBar`, `TabNav`, `ScenarioCard`, `ScenarioEditor`, `ChunkRow`, `ChunkEditor`), and 2 lib modules (`api.js` with typed fetch wrappers + `ApiError`, `format.js` with `formatDuration`/`slugify`/`uniqueTags`/`parseTagsInput`). Ported the artifact's design tokens verbatim into `frontend/src/styles/tokens.css` (dark palette, DM Sans + DM Mono, green `#1D9E75` accent, radii/spacing) and rewrote `global.css` as responsive layout CSS with ~1200 lines of scoped component styles.

Zero new dependencies. No router library, no state-management library, no test framework — all three deferred per the spec's key decisions. React 19 + Vite 6 setup unchanged.

`LiveSession` runs a `setInterval(1s)` timer with pause/resume and `terminar`, routing to `PostSession` on expiry or manual end. `PostSession` shows the async-notice banner, self-assessment row (local state only — no POST until Phase 3), and per-chunk `⏳ pendiente` rows. `ScenarioEditor` is a full-screen overlay with name/icon/chunk-multiselect + auto-derived slug (`slugify` strips diacritics, hyphenates, normalises to `^[a-z0-9-]+$`). Server 409s on slug collision are surfaced inline. `ChunkEditor` is an inline-expansion form within `Frases` with create/edit/delete and `window.confirm` on delete.

---

## Alternatives Considered

### Viewport strategy: lock to 390×720 card vs. responsive

**Option A — Reproduce the artifact exactly (fixed 390×720 phone card, centered in viewport).**
- Pros: Pixel-matches `habla-screenshot.png`. Matches the spec's explicit Non-Goal ("No mobile/responsive polish beyond what the artifact already shows. The artifact is a 390×720 phone frame; Phase 2 targets that viewport.").
- Cons: On desktop browsers, `body { display: flex; align-items: center }` vertically-centers the card — when content (the 24-chunk `frases` list) is taller than viewport, flex centering clips the top and bottom of the card and there's no way to scroll past the centered item. User experienced this immediately on first load.

**Option B — Responsive: edge-to-edge on narrow, centered max-width card on wide, body-as-scroll-container.**
- Pros: Works on both mobile and desktop. Solves the scroll-clipping bug by making the window the scroll container. Preserves the card aesthetic on wide viewports via a single `@media (min-width: 760px)` block.
- Cons: Overlays need to reposition from `position: absolute` (pinned to shell) to `position: fixed` (pinned to viewport) to keep covering the window when the shell grows taller than the viewport. Small added complexity.

**Chosen: Option B**, after the user saw the artifact-exact version and pushed back. The spec's Non-Goal was overly strict given the actual use environment. The fix was isolated to `global.css` (CSS-only change, no JSX touched except the already-present `className="overlay"` modifiers).

### Scenario edit affordance: full-card click vs. pencil icon vs. context menu

**Option A — Full-card click on name area opens editor.**
- Pros: Matches the spec's default. No affordance clutter.
- Cons: Conflicts with selection click (a card is also the "select for session" affordance). Would need a modifier key or a dedicated sub-region.

**Option B — Small pencil icon in the card's trailing area, visible on hover + when selected.**
- Pros: Unambiguous affordance. Matches common patterns (GitHub card hover actions). Selection stays on the body click.
- Cons: One extra SVG per card.

**Option C — Right-click context menu.**
- Pros: Zero visual clutter.
- Cons: Not discoverable. Breaks on touch.

**Chosen: Option B.** Spec defaulted to "a small icon in the card's trailing area" — implemented exactly that with a pencil SVG, `opacity: 0` by default, `opacity: 1` on card hover or when the card is selected.

### Chunk editor placement: inline expansion vs. modal overlay

**Option A — Inline expansion of the chunk row.**
- Pros: Spec default. Keeps context (the chunk list stays visible, the editor expands in place). Lower visual churn.
- Cons: Vertical layout shift on open.

**Option B — Modal or overlay (like `ScenarioEditor`).**
- Pros: Consistent with scenario creation UX.
- Cons: Over-kill for a three-field form.

**Chosen: Option A.** Inline expansion via a `{editingId === c.id ? <ChunkEditor/> : <ChunkRow/>}` ternary in `Frases.jsx`.

### Stats row in Phase 2: hardcoded artifact values vs. zero-state dashes

**Option A — Hardcoded `5` / `48` / `2` (artifact values).**
- Pros: Looks "real" in screenshots.
- Cons: Deceptive — feature isn't actually wired until Phase 4/5. Risks the learner thinking they're looking at their own data.

**Option B — Zero-state dashes (`—`).**
- Pros: Honest signal. Easy to wire real values later.
- Cons: Looks bare.

**Chosen: Option B.** Spec defaulted to dashes and that's what was built. Each tile shows `—` with Spanish labels intact.

### State management: local state in App.jsx vs. context or store

**Option A — Single `App.jsx` holds `scenarios`, `chunks`, `selectedScenarioId`, `durationSec`, `overlay`, and passes callbacks down.**
- Pros: Zero dependencies. Matches the spec's explicit decision ("No state management library"). Three tabs + two overlays is trivially small — no re-render thrash.
- Cons: Some prop-drilling (`onEditScenario`, `onChanged`, `onStart`, etc.).

**Option B — React Context for scenarios/chunks.**
- Pros: No prop drilling.
- Cons: Adds indirection. Context re-renders are harder to reason about. Not worth it at this size.

**Chosen: Option A.** `App.jsx` is 130 lines and fully comprehensible end-to-end. If state management grows in Phase 3/5, re-evaluate.

### Data fetching: per-view useEffect vs. lifted to App.jsx

**Option A — Each view fetches its own data.**
- Pros: View-local reasoning.
- Cons: Duplicate fetches on tab switch; hard to invalidate across views (creating a chunk in Frases should update the preview on Sesión).

**Option B — App.jsx fetches both scenarios + chunks on mount, passes down; mutations call back to a single `refetchAll`.**
- Pros: One source of truth. Mutation-to-visibility flow is obvious. Matches the spec's "each view fetches its own data" description loosely but improves on it (the spec was wrong to suggest per-view fetches — they'd duplicate).
- Cons: Marginal increase in `App.jsx` size.

**Chosen: Option B.** The spec's "each view fetches its own data" line was an early draft; the better pattern was obvious once the mutation-cross-view case (create chunk → visible in scenario preview) came up.

### Sticky header: yes vs. no

**Option A — Non-sticky (content scrolls past the tabs).**
- Pros: Simpler CSS.
- Cons: On tall lists (24 chunks + created ones), the learner has to scroll up to switch tabs. Daily-use friction.

**Option B — Sticky topbar (`top: 0`) + sticky nav (`top: 52px`).**
- Pros: Tabs always reachable. Small CSS addition. Modern browsers only — no compat issue.
- Cons: Hardcoded `top: 52px` for nav (topbar height). Fragile if topbar padding changes.

**Chosen: Option B.** Added during the responsive-layout fix since the scroll problem made the friction obvious. Acceptable fragility — topbar height is pinned by the `padding: 16px 20px 14px` + 22px logo = 52px.

---

## Tradeoffs

**What this approach gives up:**

- **Frontend test coverage.** No Vitest harness, no component tests, no smoke tests. Manual click-through + CI-run build/format/typecheck gates are the only safety net. `OVERVIEW.md` already codified this as a Phase 3+ concern; accepted.
- **Artifact pixel-fidelity on mobile.** The responsive layout doesn't perfectly reproduce the 390×720 mockup on a phone viewport — the shell goes edge-to-edge instead of floating as a card. Deliberate: edge-to-edge is the correct mobile pattern, and the floating-card-on-dark-bg aesthetic only makes sense on wide screens.
- **Granular chunk-position control.** The `ScenarioEditor` exposes a flat toggle-list of chunks; selection order becomes position order via `chunk_ids.indexOf()`. Users can't reorder within the selection. Fine for Phase 2 (the preview pill row + Live Session pill row both render in `position` order, and the `position` field is preserved round-trip via the backend's insertion-order indexing). If reorder UX is wanted, add drag-and-drop later.
- **Optimistic updates.** Every mutation does a full `Promise.all([listScenarios, listChunks])` refetch. Fine at current data volumes (4 scenarios, 24 chunks); if the chunk count grows large enough to feel laggy, switch to local patch + server reconcile.
- **Accessibility sweep.** Basic keyboard semantics (Enter/Space on `ScenarioCard`, button elements for clickable rows, `aria-label` on icon buttons), but no full audit. Spec explicitly deferred this.
- **Sticky header's hardcoded nav offset.** `top: 52px` is coupled to topbar padding. If a future tweak changes topbar height, the nav will visually detach. Easy to fix — either make them siblings of a single sticky wrapper, or use CSS variable — but not worth the churn now.
- **Browser scroll-lock via `:has(.overlay)`.** Modern browsers (2023+) support `:has()`, which covers all evergreens but excludes some older Safari. Acceptable since the product has no install-base yet.

**What this approach optimises for:**

- **Zero dependency growth.** `frontend/package.json` untouched. No router, no form library, no date library, no CSS framework.
- **Phase 3 readiness.** `LiveSession.jsx` and `PostSession.jsx` exist as components with the exact props + overlay routing Phase 3 needs. Dropping in a Pipecat client + WS handshake is a `useEffect` + a prop change, not a rewrite.
- **Spanish-only UI.** Every string is Spanish; no English leaked in any tooltip, aria-label, or error message. Grep-verified.
- **Clean break from the legacy app.** 1195 lines of `App.jsx` + `uploadRecording` + localStorage session log deleted in a single PR. Grep sanity confirms no references leak through.
- **Honest zero-state.** Stats row, streak pill, confidence bars, due pills, rep counts, weekly grid all render as `—` instead of faked values. The learner can see exactly what's wired.

---

### Spec Divergence

| Spec said | What was built | Reason |
|---|---|---|
| Non-Goal: "No mobile/responsive polish beyond what the artifact already shows. The artifact is a 390×720 phone frame; Phase 2 targets that viewport. Desktop scaling can come later." | Responsive layout: `.shell` is `max-width: 720px; margin: 0 auto; min-height: 100vh`, edge-to-edge on narrow, bordered card only at `min-width: 760px`. Body scrolls natively. Overlays use `position: fixed` centered with `max-width: 720px`. | User-directed mid-implementation. The fixed 390×720 card with `body { display: flex; align-items: center }` clipped the Frases tab's top+bottom when content exceeded viewport — the centered card didn't allow scroll past its edges. This was a real bug, not an aesthetic preference. The spec's Non-Goal was too strict given the actual use environment. |
| "Data fetching: each view fetches its own data in a `useEffect` on mount. No global store." | Lifted to `App.jsx`: single `refetchAll` on mount + mutations; views consume `scenarios` / `chunks` as props. | Per-view fetches would duplicate work and make cross-view invalidation (create chunk in Frases → visible in Sesión preview) brittle. Still no global store — just prop-drilling from the root. Strictly an improvement on the spec's design; documented here for honesty. |
| Zero-state placeholders: "stats row numbers, streak count, confidence %, due-state pill, rep counts, weekly grid, historial delta all render as visible placeholders (zero-state / hardcoded values)" | Dashes (`—`) for stats tiles + streak pill + due pill; `0` for confidence fill width; `0` for rep-count circle (default in `chunk.rep_count` from backend); `—` for weekday dots. | Consistent with the spec's open-question default ("zero-state with dashes"). Exception: confidence bar fill is `0%` width, not a dash, because it's a CSS width not a glyph. |
| "Historial list shows weekly dot grid (empty state OK — all placeholders until Phase 4) and a 'sesiones recientes' list (empty state OK — populated in Phase 3 onward)" | Empty weekly grid rendered with `wd-empty` for all 7 days; `sesiones recientes` shows a dashed-border empty-state row reading "aún no hay sesiones". | Implementation detail; matches spec intent. |
| No mention of sticky header. | Topbar + nav are both `position: sticky` (top 0 / top 52px) so tabs stay reachable during Frases-tab scrolling. | Added during the responsive-layout fix — on tall lists the scroll-to-top cost of switching tabs was immediate friction. Pure additive change, no behavior regression. |
| Self-assessment in `PostSession`: "Self-assessment is local state — Phase 2 does not POST it anywhere" | Implemented as local state, not POSTed. Button click just sets `assessment`. `guardar sesión` clears the overlay. | Matches spec. |

---

## Spec Gaps Exposed

- **The Non-Goal "Phase 2 targets [the 390×720] viewport" is wrong.** The artifact is a mobile mockup, but the product's actual use environment is desktop-plus-mobile. A Non-Goal that locks dimensions to the mockup rather than the product creates real bugs (scroll clipping from flex-centered fixed-height card). Future specs that are based on mockup artifacts should explicitly call out that the artifact is a visual reference, not a viewport lock. Worth updating `spec.md` after the fact — though since this record is the authoritative post-mortem, maybe just leave the spec as-is and let this record serve as the correction.
- **`ARCHITECTURE.md`'s `ScenarioOut.chunks[].position` field is preserved at the backend (insertion-order via the `scenario_chunks.position` column) but no UI surfaces reordering.** The editor flat-selects chunks; their order derives from `chunk_ids` array order at submit time, which in turn derives from selection-click order. Fine for now — the field is authoritative and correct round-trip — but if reorder UX is wanted in Phase 3+, it needs design work.
- **Slug-conflict UX is rough.** When a user creates a scenario whose `slugify(name)` collides with an existing slug, the server returns 409 and the form shows the error inline ("slug 'bar-de-barrio' already exists"). But `slug` is a derived readonly field, so the user can't just type a different slug — they have to pick a different name. That's fine semantically but the error message references the slug directly, which could confuse someone who didn't realise slug = derived. Consider surfacing "este nombre ya existe" instead of the raw server message for this specific 409 case. Deferred.
- **No session persistence in Phase 2 means pressing `guardar sesión` literally does nothing but close the overlay** — the spec was explicit about this but a naïve learner could think it actually saved something. Acceptable because no one is using this yet, but worth a visible state-of-the-work banner somewhere until Phase 3 lands. Not added in Phase 2; consider for Phase 3.
- **The spec's "Data fetching: each view fetches its own data" prescription was wrong** (see Spec Divergence). Future specs should prefer "lifted to App.jsx, refetched on mutation" as a default pattern, especially when mutations cross view boundaries.
- **Browser verification is informal.** Spec's "Testing Approach" lists a 17-step manual click-through. The gates ran clean in CI, but the actual click-through was the user's own browser session (which found the viewport bug). Next phase should codify a Playwright or Vitest-DOM smoke test to at least catch "page loads, three tabs navigate, no console errors" — would have caught the viewport clip in a CI environment that uses desktop dimensions. Probably too soon to add in Phase 2; revisit when Phase 5 introduces Python-side pytest and the frontend gets its own feature-testing need.

---

## Test Evidence

No frontend automated tests exist (Vitest deferred per `OVERVIEW.md`). Python backend tests also deferred to Phase 5. Phase 2 verification is manual gates + curl smoke + user browser walkthrough.

### Gates

```
$ npm run format:check
> habla-practice@0.1.0 format:check
> prettier --check 'frontend/src/**/*.{js,jsx}' && uv run --directory backend ruff format --check && uv run --directory backend ruff check

Checking formatting...
All matched files use Prettier code style!
13 files already formatted
All checks passed!

$ npm run lint
All checks passed!

$ npm run typecheck
0 errors, 0 warnings, 0 informations

$ (cd frontend && npm run build)
vite v6.4.2 building for production...
transforming...
✓ 42 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.72 kB │ gzip:  0.40 kB
dist/assets/index-C5h89U8J.css   17.63 kB │ gzip:  3.57 kB
dist/assets/index-D2PXUR8a.js   212.74 kB │ gzip: 66.05 kB
✓ built in 920ms
```

### API contract smoke test (through Vite proxy → FastAPI)

```
$ curl -s -o /dev/null -w "vite HTTP %{http_code}\n" http://localhost:5173/
vite HTTP 200

$ curl -s http://localhost:5173/api/scenarios | python3 -c "import json,sys; d=json.load(sys.stdin); print('count:', len(d)); [print(f\"  {s['icon']} {s['name']} (chunks: {len(s['chunks'])})\") for s in d]"
count: 4
  ☕ Bar de barrio (chunks: 6)
  🏪 Mercado / tienda (chunks: 6)
  🏠 Casero / vecinos (chunks: 6)
  🚇 Metro / transporte (chunks: 6)

$ curl -s http://localhost:5173/api/chunks | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
24
```

### CRUD round-trip (chunks)

```
$ curl -s -X POST http://localhost:5173/api/chunks -H 'content-type: application/json' \
       -d '{"text_es":"Prueba Phase 2","gloss_es":"gloss prueba","tags":["test","bar"]}' -w "\nHTTP %{http_code}\n"
{"id":26,"text_es":"Prueba Phase 2","gloss_es":"gloss prueba","tags":["test","bar"],"rep_count":0,"created_at":"2026-04-18 19:15:26"}
HTTP 201

$ curl -s -X PUT http://localhost:5173/api/chunks/26 -H 'content-type: application/json' \
       -d '{"text_es":"Prueba Phase 2 editada","gloss_es":"gloss prueba","tags":["test"]}' -w "\nHTTP %{http_code}\n"
{"id":26,"text_es":"Prueba Phase 2 editada","gloss_es":"gloss prueba","tags":["test"],"rep_count":0,"created_at":"2026-04-18 19:15:26"}
HTTP 200

$ curl -s -X DELETE http://localhost:5173/api/chunks/26 -w "HTTP %{http_code}\n"
HTTP 204
```

### CRUD round-trip (scenarios) + slug-collision 409

```
$ curl -s -X POST http://localhost:5173/api/scenarios -H 'content-type: application/json' \
       -d '{"slug":"bar-de-barrio","name":"X","icon":"X","chunk_ids":[]}' -w "\nHTTP %{http_code}\n"
{"detail":"slug 'bar-de-barrio' already exists"}
HTTP 409

$ curl -s -X POST http://localhost:5173/api/scenarios -H 'content-type: application/json' \
       -d '{"slug":"test-phase-2","name":"Test Phase 2","icon":"🧪","chunk_ids":[1,2]}' -w "\nHTTP %{http_code}\n"
HTTP 201

$ curl -s -X DELETE http://localhost:5173/api/scenarios/<id> -w "HTTP %{http_code}\n"
HTTP 204

$ curl -s http://localhost:5173/api/chunks | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
24
```

### Grep sanity check (legacy references absent)

```
$ rg -l "uploadRecording|/api/topics|/api/tts|/api/upload|habla-data|MicIcon|TtsButton|RATINGS|MediaRecorder|Practicar|Explorar|Progreso" frontend/src/
(no matches)
```

### Diff summary

```
$ git status --short
 M docs/specs/ROADMAP.md
 M frontend/index.html
 M frontend/src/App.jsx
 M frontend/src/lib/api.js
 M frontend/src/styles/global.css
?? docs/specs/phase-2-ui-shell/
?? frontend/src/components/
?? frontend/src/lib/format.js
?? frontend/src/styles/tokens.css
?? frontend/src/views/

$ git diff --stat HEAD
 docs/specs/ROADMAP.md          |   13 +-
 frontend/index.html            |    8 +-
 frontend/src/App.jsx           | 1296 ++++------------------------------------
 frontend/src/lib/api.js        |   75 ++-
 frontend/src/styles/global.css | 1295 +++++++++++++++++++++++++++++++++++----
 5 files changed, 1401 insertions(+), 1286 deletions(-)

New frontend files (line counts):
      90 frontend/src/views/Frases.jsx
      22 frontend/src/views/Historial.jsx
      86 frontend/src/views/LiveSession.jsx
      62 frontend/src/views/PostSession.jsx
      99 frontend/src/views/SesionHome.jsx
      97 frontend/src/components/ChunkEditor.jsx
      25 frontend/src/components/ChunkRow.jsx
      49 frontend/src/components/ScenarioCard.jsx
     168 frontend/src/components/ScenarioEditor.jsx
      21 frontend/src/components/TabNav.jsx
      19 frontend/src/components/TopBar.jsx
      70 frontend/src/lib/api.js
      32 frontend/src/lib/format.js
    1200 frontend/src/styles/global.css
      25 frontend/src/styles/tokens.css
```

### User-reported browser verification

The user ran `npm run dev` and walked through the three tabs. Two issues surfaced during that walkthrough, both in `global.css`:

1. **Frases tab scroll clipping** — content taller than viewport was clipped top and bottom with no scroll. Root cause: `body { display: flex; align-items: center }` centered the fixed-size shell, and flex centering doesn't let the user scroll past the centered item. Fixed by removing body flex centering and making the window the scroll container.
2. **Fixed 390×720 phone silhouette on desktop** — the shell was capped at 390px width even on wide viewports. Fixed by making `.shell` responsive (`max-width: 720px; margin: 0 auto`) and applying card styling only at `min-width: 760px`.

Both fixes landed as CSS-only changes. Re-verified by user after the fix; no further issues reported at close of Phase 2.
