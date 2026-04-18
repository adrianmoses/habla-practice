# Decision Record: Phase 1 — Python backend migration

| Field | Value |
|---|---|
| id | phase-1 |
| status | implemented |
| created | 2026-04-18 |
| spec | [ROADMAP.md §Phase 1](../ROADMAP.md#phase-1--python-skeleton-data-model-clean-break) + [plan file](/Users/adrianmoses/.claude/plans/let-s-start-a-branch-serene-sprout.md) |

This repo doesn't use per-feature `spec.md` files — product intent lives in `docs/specs/OVERVIEW.md`, architecture targets in `docs/specs/ARCHITECTURE.md`, and phase exit criteria in `docs/specs/ROADMAP.md`. The implementation plan at `/Users/adrianmoses/.claude/plans/let-s-start-a-branch-serene-sprout.md` is the most detailed baseline against which this record is measured.

---

## Context

The monolingual-monologue-recording app was being pivoted to a scenario-based voice-agent role-play tool (see `OVERVIEW.md`). Phase 3 of the ROADMAP depends on **Pipecat**, a Python-only voice pipeline framework chosen for its smart-turn detection, interruption handling, and provider integrations. That meant a Python runtime was coming.

The question was when to cross the Node→Python boundary. Options on the table:

- **Now, before Phase 3.** Hono was ~230 lines across 5 routes plus a tiny `better-sqlite3` schema. Cheapest it would ever be to replace.
- **Alongside Phase 3,** with Pipecat as a Python microservice behind a Node HTTP layer. Two runtimes forever.
- **After Phase 3,** gluing Pipecat to Hono via a subprocess / IPC. Ugly and blocks feature work on the glue.

We picked option 1. Phase 1's job is therefore to stand up a Python 3.12 + FastAPI service, port the new data model (`scenarios / chunks / scenario_chunks / sessions / chunk_deployments / scenario_srs`), seed 4 starter Madrid scenarios, and **delete the Node backend in the same PR** — no dual-runtime interim state.

Discoveries during implementation:

- The root `package.json` dev script needed `cd frontend && npm run dev`, not `cd frontend && vite` — `vite` CLI isn't in root `PATH`.
- The FastAPI SPA catch-all was initially a plain `@app.get` which returns 405 for `HEAD /`. Had to switch to `@app.api_route(..., methods=["GET", "HEAD"])`.
- The user caught `GET /api/topics` (a legacy path the old `App.jsx` still hits) returning HTML instead of a 404. The catch-all was shadowing unknown `/api/*` routes. Added an explicit `/api/` prefix guard inside the fallback.

## Decision

Replaced the entire Hono/Node backend with a Python 3.12 + FastAPI service managed by **`uv`**, using **`aiosqlite`** for async SQLite access (no ORM). New schema from `ARCHITECTURE.md` (6 tables) via idempotent `CREATE TABLE IF NOT EXISTS`. The Hono backend and the legacy root-level `habla_practice.jsx` (598-line English prototype) are gone from the tree. Legacy `data/habla.db*` and `data/recordings/` purged. Root `package.json` scripts now drive `uv run uvicorn` for the backend; CI runs `ruff` + `pyright` alongside the frontend Prettier+build. Docker is a multi-stage `node:20-slim` (frontend) → `python:3.12-slim` (runtime) image.

Four starter scenarios (Bar de barrio, Mercado / tienda, Casero / vecinos, Metro / transporte) seeded with 6 chunks each — 24 chunks total — authored inline using the tone constraints codified in `docs/prompts/madrid-chunk-seed.md`.

---

## Alternatives Considered

### Cross the Node→Python boundary now, incrementally, or later?

**Option A — Now, in one PR.** Replace Hono wholesale; Phase 1 ships as a Python service.
- Pros: Hono footprint is trivial; cheapest migration moment. Phase 3 inherits a real Python service. No dual-runtime era.
- Cons: Legacy frontend (Phase 2 rewrite candidate) renders broken against new API shapes during the interim.

**Option B — Pipecat as a sidecar Python service, Hono remains.**
- Pros: No immediate Node teardown. Pipecat gets its native runtime.
- Cons: Two services, two deploys, two monitoring surfaces. SQLite access either duplicated or bridged via HTTP. Long-term tax.

**Option C — Defer the migration; bridge Pipecat to Node via subprocess / FFI.**
- Pros: No Python in the tree yet.
- Cons: The glue is throwaway work. Phase 3 fights the bridge rather than building features.

**Chosen: Option A.** Hono was thin enough that a full rewrite was cheaper than any bridge. The legacy frontend being broken during Phase 1 is explicit in the ROADMAP's Phase 1 exit criteria.

### SQLite access layer: ORM vs. raw SQL?

**Option A — `aiosqlite` with raw SQL.** Minimal dependency, async, direct DB-API.
**Option B — SQLAlchemy + `aiosqlite` async driver.** Full ORM.
**Option C — SQLModel (SQLAlchemy + Pydantic).** Pydantic-native, ORM-lite.

**Chosen: Option A.** The query surface is tiny — two domain tables at Phase 1, four more added later. Raw SQL is easier to read than an ORM's generated queries for this volume. No migration framework yet (idempotent DDL on startup); introducing Alembic-backed migrations can wait until a real schema change lands.

### Dependency manager: `uv` vs. `pip + requirements.txt` vs. Poetry?

**Chosen: `uv`.** Fast (order-of-magnitude faster than pip in cold cache), reproducible lock (`uv.lock`), modern PEP 621 `pyproject.toml`, first-class monorepo support via `--directory`. Drop-in for the Dockerfile via `ghcr.io/astral-sh/uv:0.5`. No real competitor for a greenfield Python project in 2026.

### Static serving + SPA fallback pattern in FastAPI

**Option A — `app.mount("/", StaticFiles(html=True))` at the end.**
- Pros: One line. Standard-looking.
- Cons: Mount matching is greedy and happens before any late-registered routes. `/api/*` routes get shadowed in subtle ways depending on mount order. Doesn't give us a natural place to 404 unknown API paths.

**Option B — Mount `/assets` only, plus `@app.api_route("/{full_path:path}")` catch-all that serves `index.html` or the literal file.**
- Pros: Explicit. Keeps `/api/*` working cleanly since routers are registered first. Can guard unknown `/api/*` to return JSON 404.
- Cons: Slightly more code.

**Chosen: Option B.** After observing `HEAD /` returning 405 (switched to `api_route` with `["GET", "HEAD"]`) and the user's report of `/api/topics` returning HTML (added an explicit `api/` prefix 404 guard), Option B's flexibility paid off immediately.

### Pipecat in Phase 1 pyproject, or deferred?

**Chosen: Deferred to Phase 3.** Adding `pipecat-ai[cartesia,anthropic,groq,silero,smart-turn]` now would balloon the dep tree with ML libs (torch, ONNX runtime, VAD models) that Phase 1 doesn't exercise. `uv sync` stays fast; CI stays fast; Dockerfile stays small until it has to grow.

### Madrid chunk seed: draft inline now vs. defer prompt runs?

User chose "Author prompt + draft chunks now" via AskUserQuestion during planning. The prompt lives at `docs/prompts/madrid-chunk-seed.md`; the chunks went into `seed.py`. The alternative — shipping seed placeholders and generating later — would leave a visibly-empty frases tab through Phase 2, delaying the moment the UI has real content to show.

---

## Tradeoffs

**What this approach gives up:**

- **Interim product quality.** The legacy `App.jsx` renders with errors against the new API shapes for the duration between this PR merging and Phase 2 completing. Acceptable because `ROADMAP.md` Phase 1 exit criteria explicitly call this out ("broken UI is fine, build passing is what matters").
- **Schema migration infrastructure.** Phase 1 uses `CREATE TABLE IF NOT EXISTS` with a manual DB wipe for the one-time clean break. No Alembic. First real schema change (Phase 3 sessions, Phase 5 deployments, Phase 6 SRS are already in the baseline schema) will still be trivial to migrate manually. If schema churn picks up, introduce Alembic then.
- **Per-feature tests.** No `pytest` coverage was added — the harness is in place (`pytest`, `pytest-asyncio`, `httpx`) but no assertions exist yet. The ROADMAP codifies Phase 5 as the test-introduction phase (golden-transcript fixtures for the judge). Phase 1 was verified by curl + `ruff` + `pyright` + manual docker smoke.
- **Shared `aiosqlite` connection on `app.state.db`.** Single connection shared across requests. Fine for single-user + serialised WAL writes. Phase 5's analysis worker will need a second connection or a pool — carried forward as a known follow-up.

**What this approach optimises for:**

- **Clean-break hygiene.** Zero backwards-compat shims; the old schema and routes are genuinely gone, not deprecated.
- **Phase 3 readiness.** Python runtime, FastAPI + WS-capable, `/data` volume already handling SQLite — adding Pipecat + a `/ws/session/{id}` endpoint is additive in Phase 3, not a layering fight.
- **Dep-tree minimalism.** 5 runtime packages (`fastapi`, `uvicorn[standard]`, `aiosqlite`, `pydantic`, `pydantic-settings`). Anthropic, Groq, Cartesia, Pipecat land only when consumed.

---

### Spec Divergence

The implementation matches the plan with a small number of tactical adjustments, all caught during gate testing. Each is deliberate.

| Plan said | What was built | Reason |
|---|---|---|
| `dev:frontend: "cd frontend && vite"` in root `package.json` | `dev:frontend: "cd frontend && npm run dev"` | `vite` CLI is in `frontend/node_modules/.bin` only; invoking via `npm run dev` (which already exists in `frontend/package.json`) uses the local install without requiring `npx`. |
| SPA fallback via `@app.get("/{full_path:path}")` | `@app.api_route("/{full_path:path}", methods=["GET", "HEAD"])` | Plain `@app.get` returns 405 on HEAD. The plan's own verification step `curl -sI /` needs HEAD to return 200. |
| SPA fallback serves `index.html` for anything not a literal file | Catch-all now also raises 404 JSON for `api/*` prefixes before the file/HTML logic | User reported legacy `App.jsx` calls to `GET /api/topics` returning HTML (200 + SPA shell) instead of 404 JSON. Unknown `/api/*` should be a structured 404, not a SPA fallthrough. Hardens the API surface against silently-broken client code in Phase 2+. |
| Steps listed as linear; "wipe legacy DB" appeared in Step 9 | Legacy `data/habla.db*` files were wiped before Step 8 (during the GATE verification) to force the seed path to run on a clean schema | Cosmetic ordering tweak. Same outcome. |

No other divergences. The data model is bit-for-bit what `ARCHITECTURE.md` specified.

---

## Spec Gaps Exposed

- **`ARCHITECTURE.md` does not state that the SPA fallback must exclude `/api/` prefixes.** Worth an explicit note — the gotcha that any unknown `/api/*` path should return 404 JSON, not the SPA shell, should be spec-level, not buried in a decision record.
- **`ARCHITECTURE.md`'s Data Model specifies column types and names but not the shape of the API payloads.** The `ChunkOut.rep_count: int = 0` placeholder pattern (field declared in Phase 1 response shape so Phase 5 is additive) emerged organically. Worth codifying as a repo-wide convention: later phases should not break earlier response shapes; they fill placeholder fields in-place.
- **No `data/` retention policy.** The schema has no TTL for `sessions.transcript` or any `chunk_deployments` purge. Single-user scale doesn't need it yet; but Phase 6+ should explicitly decide (keep indefinitely? cap at N months?). Carry forward to a Phase 5/6 scope discussion.
- **`CI.yml` currently re-installs root deps just to get Prettier.** Cheap, but if the root `package.json` grows, consider co-locating Prettier inside `frontend/` so the frontend job owns it end-to-end.
- **No branch protection / merge policy is defined anywhere.** The deploy workflow runs on `main`; nothing prevents direct pushes. Not a Phase 1 concern but worth noting before the repo matures.

---

## Test Evidence

No automated tests exist yet — the `pytest` harness is scaffolded (`pytest`, `pytest-asyncio`, `httpx`, `asyncio_mode = "auto"` in `pyproject.toml`) but the first real tests land in Phase 5 per ROADMAP. Phase 1 verification was manual. Actual output from the session:

### Lint + format + typecheck

```
$ uv run ruff check
All checks passed!

$ uv run ruff format --check
13 files already formatted

$ uv run pyright
0 errors, 0 warnings, 0 informations
```

### Root-level scripts

```
$ npm run format:check
> prettier --check 'frontend/src/**/*.{js,jsx}' && uv run --directory backend ruff format --check && uv run --directory backend ruff check
Checking formatting...
All matched files use Prettier code style!
13 files already formatted
All checks passed!

$ npm run lint
All checks passed!

$ npm run typecheck
0 errors, 0 warnings, 0 informations
```

### `npm run dev` — both services booting, /api proxied through Vite

```
$ curl -s http://localhost:3000/api/scenarios | python3 -c "import json,sys; d=json.load(sys.stdin); print('count:', len(d), 'slugs:', [s['slug'] for s in d])"
count: 4 slugs: ['bar-de-barrio', 'mercado-tienda', 'casero-vecinos', 'metro-transporte']

$ curl -s http://localhost:3000/api/chunks | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
24

$ curl -s http://localhost:5173/api/scenarios | python3 -c "import json,sys; d=json.load(sys.stdin); print('count via vite proxy:', len(d))"
count via vite proxy: 4
```

### CRUD behavior

```
$ curl -s -X POST http://localhost:3001/api/chunks -H 'content-type: application/json' \
      -d '{"text_es":"vale, gracias","gloss_es":"acuerdo cordial","tags":["social","casual"]}' -w "\nHTTP %{http_code}\n"
{"id":25,"text_es":"vale, gracias","gloss_es":"acuerdo cordial","tags":["social","casual"],"rep_count":0,"created_at":"2026-04-18 14:42:40"}
HTTP 201

$ curl -s -X PUT http://localhost:3001/api/chunks/25 -H 'content-type: application/json' \
      -d '{"text_es":"vale, gracias (edited)","gloss_es":"acuerdo cordial","tags":["social","casual"]}' -w "\nHTTP %{http_code}\n"
{"id":25,"text_es":"vale, gracias (edited)",...}
HTTP 200

$ curl -s -X DELETE http://localhost:3001/api/chunks/25 -w "HTTP %{http_code}\n"
HTTP 204

$ curl -s -X POST http://localhost:3001/api/scenarios -H 'content-type: application/json' \
      -d '{"slug":"Bad Slug!","name":"X","icon":"X","chunk_ids":[]}' -w "\nHTTP %{http_code}\n"
{"detail":[{"type":"string_pattern_mismatch","loc":["body","slug"],...}]}
HTTP 422

$ curl -s -X POST http://localhost:3001/api/scenarios -H 'content-type: application/json' \
      -d '{"slug":"bar-de-barrio","name":"X","icon":"X","chunk_ids":[]}' -w "\nHTTP %{http_code}\n"
{"detail":"slug 'bar-de-barrio' already exists"}
HTTP 409

$ curl -s -X POST http://localhost:3001/api/scenarios -H 'content-type: application/json' \
      -d '{"slug":"ok-scen","name":"X","icon":"X","chunk_ids":[9999]}' -w "\nHTTP %{http_code}\n"
{"detail":"Unknown chunk_ids: [9999]"}
HTTP 400
```

### SPA + unknown-API-path behavior (post-fix)

```
$ curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/topics
{"detail":"Unknown API path: /api/topics"}
HTTP 404

$ curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/unknown
{"detail":"Unknown API path: /api/unknown"}
HTTP 404

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/scenarios
HTTP 200

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/
HTTP 200

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/some/random/spa/route
HTTP 200

$ curl -sI http://localhost:3000/ | head -3
HTTP/1.1 200 OK
date: Sat, 18 Apr 2026 14:45:48 GMT
server: uvicorn
```

### Docker image build + smoke run

```
$ docker build -t habla:phase1 .
...
#27 writing image sha256:dcae9123ffb2ecf3e1ccbf32d199d783c62f9f9cd33f555e7135336b060075b5 done
#27 naming to docker.io/library/habla:phase1 done
#27 DONE 0.4s

$ docker run --rm -d --name habla-phase1-test -p 3100:3000 -v /tmp/habla-data-docker:/data habla:phase1
6bc8453b9b38621461f85f171a029f2c1d1897600ec5f5ee2dbe3d0905480ccf

$ curl -sI http://localhost:3100/ | head -3
HTTP/1.1 200 OK
date: Sat, 18 Apr 2026 14:48:39 GMT
server: uvicorn

$ curl -s http://localhost:3100/api/scenarios | python3 -c "import json,sys; d=json.load(sys.stdin); print('count:', len(d), 'slugs:', [s['slug'] for s in d])"
count: 4 slugs: ['bar-de-barrio', 'mercado-tienda', 'casero-vecinos', 'metro-transporte']

$ curl -s http://localhost:3100/api/chunks | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
24

$ docker logs habla-phase1-test | tail -5
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:3000 (Press CTRL+C to quit)
INFO:     172.17.0.1:61282 - "HEAD / HTTP/1.1" 200 OK
INFO:     172.17.0.1:61286 - "GET /api/scenarios HTTP/1.1" 200 OK
INFO:     172.17.0.1:61302 - "GET /api/chunks HTTP/1.1" 200 OK
```

### Frontend build (Phase 2 rewrite pending, legacy still compiles)

```
$ (cd frontend && npm run build)
vite v6.4.2 building for production...
✓ 30 modules transformed.
dist/index.html                   0.40 kB │ gzip:  0.27 kB
dist/assets/index-CS54qGdx.css    3.36 kB │ gzip:  1.25 kB
dist/assets/index-DnWbFKEG.js   216.39 kB │ gzip: 66.27 kB
✓ built in 944ms
```

### Diff summary

```
$ git diff --stat HEAD
 19 files changed, 175 insertions(+), 1893 deletions(-)
```

Net: −1718 lines. Node backend + legacy `habla_practice.jsx` deleted; Python backend + new spec docs + Madrid seed prompt added (those land as untracked `backend/` and `docs/` trees until staged).
