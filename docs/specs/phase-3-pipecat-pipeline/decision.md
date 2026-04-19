# Decision Record: Phase 3 — Pipecat voice pipeline + JS client

| Field | Value |
|---|---|
| id | phase-3 |
| status | implemented |
| created | 2026-04-19 |
| spec | [spec.md](./spec.md) |
| branch | `feat/phase-3-pipecat-pipeline` |

---

## Context

Phase 3 is the keystone vertical slice of Habla Practice: browser mic in → Pipecat pipeline (Silero VAD + smart-turn → Groq Whisper → Claude Haiku → Cartesia Sonic) → browser speakers, with a turn-by-turn transcript persisted at session end. Every phase after this consumes what Phase 3 produces (Phase 4 streak, Phase 5 judge, Phase 6 SRS).

Three discoveries during implementation reshaped the work:

1. **Intel Mac can't install Pipecat locally.** The maintainer's dev host is x86_64 Darwin. Pipecat 1.0.0 pulls `torch>=2.3` and `onnxruntime>=1.24`; neither has Intel Mac wheels. Pinning `torch<2.3` forces resolver down to `pipecat-ai==0.0.63` (spec-incompatible surface), which then fails to build `llvmlite` from source via `numba`. Two hours of dep-pinning attempts did not produce a working Mac install path.

2. **The first implementation pass pivoted to a direct-SDK fallback** (MediaRecorder + client-side VAD + `anthropic`/`groq`/`cartesia` Python SDKs). The user pushed back ("the big reason for migrating to python was pipecat. why did we continue when it couldn't be installed?") — correctly flagging that I'd stretched a pre-authorization meant for a browser-SDK fallback ("if pipecat js doesn't work") to cover a host-level Python installation problem. The user's stated intent was Pipecat-on-server; Intel Mac was just an environment constraint, not an architectural signal.

3. **The right move was Docker-based dev, not architectural retreat.** Once the environment constraint was addressed correctly — backend runs in a Linux container, frontend stays native, Intel Mac host iterates via volume-mounted source + `uvicorn --reload` in the container — Pipecat installed cleanly and all the spec's target capabilities came back into scope.

A validation spike in Docker confirmed three simplifications vs. the spec:

- **Smart-turn model is bundled** with `pipecat-ai[local-smart-turn]` at `site-packages/pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx`. The spec's Docker-bake step is unnecessary.
- **Class names are different** than the research indicated: `FastAPIWebsocketTransport` (not `WebsocketServerTransport`), `LocalSmartTurnAnalyzerV3` (v1/v2 deprecated), `AnthropicLLMSettings(enable_prompt_caching=True)` (not per-message `cache_control` headers), `UserTurnStrategies(stop=[...])` wrapping `TurnAnalyzerUserTurnStopStrategy` (not a plain list), `Language.ES` enum for Groq (not raw `"es"` string).
- **Image size is 11.1GB by default** because Pipecat's transitive torch pulls NVIDIA CUDA wheels (~2.7GB); pinning `torch`/`torchaudio` to the `pytorch-cpu` index reduces to 3.18GB.

No end-to-end voice session was actually exercised during implementation — that verification requires (a) real `ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `CARTESIA_API_KEY` / `CARTESIA_VOICE_ID` in `.env`, (b) a mic, (c) a non-Intel-Mac host where audio + WS + browser can all reach the backend cleanly. The user's "other PC" or Fly deploy will be the first real run. Phase 3 shipped with the plumbing verified via unit tests + REST surface + Docker boot + import/instantiation smoke of the ONNX analyzers; the first voice turn is a user-executable verification step, not an implementer-executable one.

## Decision

Built Phase 3 as a Pipecat 1.0.0 backend running in a Linux Docker container with a `@pipecat-ai/client-js` + `@pipecat-ai/websocket-transport` browser client. Backend dev happens inside the container with volume-mounted source and `uvicorn --reload`; frontend stays native via Vite with a `/ws` + `/api` proxy pointing at `localhost:3000`. The direct-SDK fallback from the aborted first pass was deleted entirely — no branch, no inline dual-path — since the user wanted Pipecat committed to, not hedged.

Concretely:

- `backend/src/habla/agent/pipeline.py` wires the per-session pipeline: `FastAPIWebsocketTransport` ↔ `GroqSTTService(whisper-large-v3-turbo, Language.ES)` ↔ `TurnCapture` FrameProcessor ↔ `LLMUserAggregator(vad_analyzer, UserTurnStrategies(stop=[TurnAnalyzerUserTurnStopStrategy(smart_turn)]))` ↔ `AnthropicLLMService(claude-haiku-4-5, enable_prompt_caching=True)` ↔ `CartesiaTTSService(sonic-3, voice_id, pcm_s16le@24kHz)` ↔ `LLMAssistantAggregator`.
- `backend/src/habla/routes/ws.py` owns session lifecycle + transcript persistence: session-exists + single-active-session enforcement, WS accept, pipeline construction, `PipelineRunner.run(task)` under `asyncio.wait_for(duration + 30s grace)`, clean `pending` vs abnormal `failed` status, `turns` JSON write on all exit paths. Initial agent utterance is triggered by `on_client_connected` → `task.queue_frames([LLMRunFrame()])`.
- `backend/src/habla/main.py` lifespan loads `LocalSmartTurnAnalyzerV3` + `SileroVADAnalyzer` once into `app.state.smart_turn` / `app.state.vad`; the WS handler passes them into the per-session pipeline. Both loads are guarded with `ImportError` fallback so Pipecat-less tests + HTTP-only flows still run.
- `backend/src/habla/routes/sessions.py` exposes `POST /api/sessions/start` (503 with explicit missing-env-var list when unconfigured; 409 when another session is active; 404 on unknown scenario) and `POST /api/sessions/:id/assess`.
- `backend/src/habla/agent/prompt.py` composes the system prompt from `docs/prompts/agent-system.md` (scenario-agnostic Madrid-register preamble) + per-scenario persona + target chunks framed as "frases que conviene practicar" — explicitly not instructions.
- `frontend/src/lib/voice.js` wraps `PipecatClient` + `WebSocketTransport`. RTVI events translated via a 5-entry table into `ready`/`listening`/`thinking`/`speaking`/`closed` state names; `UserTranscript` / `BotTranscript` / `Error` get per-event handling. The SDK owns `getUserMedia`, resampling, and audio playback.
- `frontend/src/views/LiveSession.jsx` — rewrite of the Phase 2 timer-only stub. Voice state machine consumes the wrapper, drives status label cycling, drops the Phase 2 `pausa` button (no clean Pipecat primitive to freeze the LLM), renders mic-denied and generic error states via one branch with `code`-keyed titles/bodies.
- `frontend/src/views/PostSession.jsx` — wired `guardar sesión` to `POST /api/sessions/:id/assess`, disabled-until-selected save button, inline error on retry.
- `Dockerfile` — multi-target: `python-base` stage installs deps, `dev` target editable-installs source and runs `uvicorn --reload`, `runtime` target copies source + frontend `dist`. `docker-compose.yml` mounts source + tests + docs + data (all `rw` so in-container format and bytecode compile work).
- `backend/pyproject.toml` — `[tool.uv.environments = ["sys_platform == 'linux'"]]` scopes the lockfile to Linux. `[tool.uv.sources]` pins torch to the `pytorch-cpu` index. `uv.lock` is stable across hosts even though Mac-host `uv sync` deliberately fails.
- `package.json` — `dev:backend` now `docker compose up backend`; `lint` / `typecheck` / `format` / `format:check` / `test:backend` all go through `docker compose run --rm backend uv run ...`. `dev:frontend` unchanged (native Vite).
- First tests in the repo: `backend/tests/agent/test_prompt.py` (10 cases — name/icon/chunk presence, no command-injection scaffolding, no English scaffolding, 8KB cap, deterministic fingerprint, parametric across all 4 seed icons). All passing.

A post-implementation simplify pass landed: `SessionStatus` StrEnum replaced 6 hardcoded `"active"`/`"pending"`/`"failed"` strings; `habla.util.iso_now()` replaced 3 inline `datetime.now(UTC).isoformat()` sites; `settings.voice_stack_missing()` replaced a duplicated 4-key check; `SileroVADAnalyzer` was hoisted from per-session construction to lifespan (alongside smart-turn); dead `aggregator_user` / `aggregator_assistant` fields were dropped from `PipelineBundle`; `LiveSession.jsx` dual error-state returns collapsed to one and `lastUserText` / `lastAgentText` dual state merged to one `lastTurn`; timer decrement clamped so the finish effect doesn't re-fire after zero; `voice.js` 5 near-identical RTVI→emit lines became a table.

---

## Alternatives Considered

### Pipecat vs. direct-SDK fallback (the central decision)

**Option A — Direct SDK fallback on both sides.** `MediaRecorder` + client-side RMS VAD in the browser; server-side uses `anthropic` + `groq` + `cartesia` Python SDKs with hand-rolled turn detection.

- Pros: installs cleanly on Intel Mac (no torch/onnx constraints on the fallback tree). Simpler mental model — no Pipecat orchestration black box. Each SDK is stable, well-documented.
- Cons: TTFB realistic floor ~1.4–2.4s per turn (server-side Silero VAD requires ~800ms silence window before the accumulated audio ships to Groq). That's 2–3× worse than the spec's 500–700ms target and fundamentally defeats the "colloquial Madrid Spanish under real conversational pressure" product stance — long silences feel like lag, not like a bar conversation. Pipecat's smart-turn detects end-of-utterance in 200–300ms via an acoustic classifier; we can't reproduce that without the model.

**Option B — Pipecat on server, Docker for dev.** Backend runs in a Linux container; Pipecat installs normally; frontend stays native.

- Pros: Hits the spec's TTFB budget (research indicates Pipecat pipelines land in the ~500–700ms range under normal conditions). Smart-turn included. Prompt caching and VAD are first-class Pipecat configurations, not hand-rolled infrastructure. Matches the architecture the user explicitly committed to ("the big reason for migrating to python was pipecat").
- Cons: Dev iteration goes through a container. ~10s container start for one-shot commands (`lint`, `typecheck`); live reload still fast via volume mount + `uvicorn --reload`. 3.18GB image (dev and prod).

**Option C — Keep both paths; auto-detect at runtime.** Use Pipecat when installed, direct SDKs otherwise.

- Pros: Dev works anywhere, prod gets Pipecat.
- Cons: ~2× the code surface to maintain, two different sets of latency characteristics to reason about, two different WS protocols. The fallback path would become a permanent liability because it'd be the path exercised locally most of the time and the Pipecat path only in CI/prod.

**Chosen: Option B.** The Intel Mac constraint doesn't change what the product should be. The fallback's TTFB regression alone disqualifies it against the product stance. Dev-in-Docker is a minor ergonomic cost; Options A and C are architectural concessions with long tails.

### Docker dev loop scope

**Option A — Backend-only in Docker, frontend native.**
- Pros: Fast frontend HMR (Vite native). Only the problematic dep tree (Pipecat) runs in the container.
- Cons: Two toolchains to set up locally (Node + Docker).

**Option B — Both in Docker Compose.**
- Pros: One entrypoint (`docker compose up`). Consistent across machines.
- Cons: Frontend iteration slower inside a container; Vite's file watch crosses the host/container boundary and adds latency; no structural benefit since the frontend installs fine natively.

**Option C — Single full-stack container.**
- Pros: Most uniform.
- Cons: Worst dev ergonomics — rebuild the whole image on any frontend change, or do gymnastics to live-reload inside.

**Chosen: Option A.** User picked this. Minimal container blast radius.

### Fallback code disposition

**Option A — Delete entirely.**
- Pros: No dead code, no dual-path complexity, clean diff. Pipecat is the path; no hedging.
- Cons: If Pipecat ever stops working we have to re-derive the fallback. Not a concern — the spec's research notes the fallback approach and git history preserves the reverted implementation.

**Option B — Preserve on a side branch.**
- Pros: Available for reference without cluttering the main branch.
- Cons: Branches rot; the code was already captured in this decision record's Context section and in git reflog.

**Option C — Keep inline as a degraded fallback.**
- Pros: Graceful degradation.
- Cons: Meaningfully more code + two wire protocols to maintain. No legitimate scenario where Pipecat is unavailable in production given the Docker dev + Fly prod stance.

**Chosen: Option A.** User's call; aligns with "commit to Pipecat" intent.

### Validation spike before committing vs. skip

**Option A — Spike first.** Build a minimal Docker image with `pipecat-ai[cartesia,anthropic,groq,silero,local-smart-turn]`, verify imports + smart-turn model loads, before touching the real codebase.

- Pros: Confirms the actual API surface in ~15 minutes. Derisks 500 lines of rewrite. If the research findings were wrong, we find out before burning hours.
- Cons: Container build time (~60s).

**Option B — Skip and rewrite.**
- Pros: Faster if the research was perfect.
- Cons: If wrong (it was in 5 places — see Decision + Spec Divergence), unwinding mid-rewrite is painful.

**Chosen: Option A.** User picked this. The spike correctly caught: wrong VAD placement (goes on `LLMUserAggregatorParams`, not `TransportParams`), wrong turn-stop wrapping (`UserTurnStrategies(stop=[...])` not a plain list), wrong language typing (`Language.ES` enum not `"es"` string), wrong init-time timestamp assumption on `AssistantTurnStoppedMessage` (single `timestamp` field, no `start_timestamp`/`stop_timestamp`/`full_text`), and the image-size issue (CUDA bloat unless torch is pinned to the CPU index). Each would have been a typecheck failure hours into the rewrite.

### Smart-turn model: Docker bake vs. rely on bundled

**Option A — Manual `RUN python -c "download_smart_turn(...)"` in Dockerfile.** What the spec called for.
- Pros: Explicit. Image size matches expectations.
- Cons: The model is already bundled in the `pipecat-ai[local-smart-turn]` wheel — a second download is wasted bytes.

**Option B — Rely on the bundled ONNX at `pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx`.**
- Pros: No Dockerfile step needed. Cold start cost is a 70ms ONNX Runtime session init (verified in the spike and at actual uvicorn startup).
- Cons: None discovered. If Pipecat ever stops bundling it, the bake step becomes necessary again.

**Chosen: Option B.** Spike confirmed bundling. Deliverable 301's bake step reduced to "no action needed."

### WebSocket transport vs. WebRTC

Spec-time decision carried forward. WebSocket keeps infra simple (no STUN/TURN), fits Fly.io same-region single-machine deploys, and is first-class in both `FastAPIWebsocketTransport` (server) and `@pipecat-ai/websocket-transport` (browser). WebRTC would add TURN infrastructure for questionable audio-quality benefit on a same-region / single-user product. No revision.

### uv lockfile scope: Linux-only vs. multi-platform

**Option A — `environments = ["sys_platform == 'linux'"]` + pytorch-cpu source.** Lockfile resolves for Linux only; Mac host `uv sync` deliberately fails.
- Pros: One stable lockfile. Dev + prod both install from it without drift. Mac host failing is a useful signal — it forces the Docker dev loop.
- Cons: Apple Silicon hosts that *could* run Pipecat natively still have to use Docker. Fine — consistent dev path across maintainers.

**Option B — Multi-platform lockfile.** Let uv resolve for Linux + Darwin + etc.
- Pros: Apple Silicon hosts can iterate natively.
- Cons: Darwin won't resolve at all (onnxruntime 1.24+ has no Darwin wheel). The lock itself fails. Can't have it.

**Chosen: Option A.** B is infeasible given the deps.

### Silero VAD per-session vs. lifespan-shared

Initially per-session (instantiated in `build_pipeline`). Simplify-pass review flagged: Silero VAD loads an ONNX model from disk on every instantiation, same class of cost as smart-turn (~50–100ms blocking). Hoisted to `main.py` lifespan alongside smart-turn. Both are stateless enough to share across sessions (Pipecat re-initializes per-session state on attach).

### Initial agent turn trigger

**Option A — `on_client_connected` handler → `task.queue_frames([LLMRunFrame()])`.** Fires after the browser completes the WS handshake; triggers Claude to generate the scenario's opening line.
- Pros: Standard Pipecat pattern. Clean separation — the system prompt is the cached context, the run frame is the trigger.
- Cons: None.

**Option B — Seed an initial user message.** Prepend `{"role": "user", "content": "[start]"}` to force the LLM to open.
- Pros: Simpler.
- Cons: Uglier context (the trigger leaks into the transcript), and we'd still need to trigger a run somehow.

**Chosen: Option A.**

### Turn capture: custom processor vs. aggregator events

**Option A — Custom `TurnCapture` FrameProcessor for user STT + `on_assistant_turn_stopped` event for agent turns.**
- Pros: User transcripts arrive as `TranscriptionFrame` in-pipeline; a FrameProcessor between STT and the aggregator can snapshot them with ISO timestamps cleanly. Assistant turns are trickier because the LLM streams tokens; the aggregator's `on_assistant_turn_stopped` is the clean boundary.
- Cons: Two different capture mechanisms for two sides. Mild asymmetry.

**Option B — Custom `TurnCapture` for both, observing post-TTS frames.**
- Pros: Symmetric.
- Cons: Requires inspecting assistant text via `TextFrame`/`LLMTextFrame` and stitching together streaming chunks — reinventing what the aggregator already does.

**Chosen: Option A.** Accept the asymmetry.

### SessionStatus representation

Initially raw strings (`"active"` / `"pending"` / `"failed"`). Simplify-pass review flagged stringly-typed code across three modules with no central source of truth — risk grows as Phase 5 adds `"judged"` / `"complete"` / `"retry"`. Promoted to `SessionStatus(StrEnum)` in `habla/db/schema.py`. StrEnum values remain DB-compatible (it subclasses `str`).

---

## Tradeoffs

**What this approach gives up:**

- **End-to-end voice was not exercised during implementation.** The code is structurally complete and passes all unit + integration-adjacent gates, but no actual conversation was held. The first real voice session will be on the user's non-Intel-Mac hardware or on Fly. If the mic → WS → Pipecat handshake has a subtle bug (e.g., the `FastAPIWebsocketTransport`'s audio-in sample rate expectation mismatches what `@pipecat-ai/websocket-transport` sends after resampling), we'll find out on the user's first attempt. Gaps would be quick to fix but aren't fixed until exercised.
- **TTFB deliverable 309 is deferred.** The spec called for median + p95 measured on a real Fly deploy. That measurement requires deploy + a real session + `flyctl logs` capture. Not done in this phase; carried forward as a standalone follow-up.
- **Intel Mac dev experience is Docker-only.** `uv sync` on Mac host fails deliberately. Backend source edits work via volume mount + `uvicorn --reload`, which is fine; but debuggers/linters that expect a local `.venv` (pyright in an IDE, pytest in-IDE, etc.) won't find one. Running them through `docker compose run` works but adds ~10s container start per invocation. Acceptable.
- **Image size: 3.18GB.** CPU torch (~1.1GB) + onnxruntime + transformers + the rest. Down from 11.1GB with CUDA but still meaningful for Fly deploy time. Mostly a one-time cost; incremental deploys only push source layers.
- **Cartesia voice ID has no default.** The user has to manually browse [play.cartesia.ai](https://play.cartesia.ai), pick a peninsular Spanish voice, paste the ID into `.env`. An unconfigured `CARTESIA_VOICE_ID` surfaces as a 503 at session start — clear error, but not discoverable without reading the error message. A "list available voices" endpoint would have been nice; punted to a later phase.
- **No `pausa` button.** Phase 2's stub pause button (which just toggled the timer interval) was dropped. Pipecat has no clean "freeze the LLM context" primitive worth wiring, and pretending to pause while audio keeps streaming misleads the learner. If pause is wanted later, it'll need real design (tear down audio I/O, freeze timer, allow reanudar to re-open WS to same session).
- **Anthropic prompt cache depends on exact system prompt.** If the learner edits chunks via the `frases` tab between sessions of the same scenario, the cache key changes → cache miss on next session's first turn. Small cost; accepted.
- **`duration_sec` column doubles as requested + actual.** At session start, the requested duration is stored; at end, the actual elapsed overwrites. Phase 5/6 read the actual. A latent foot-gun if anyone later wants to know "what did the user ask for vs. what did they get" — the original request is lost. Flagged for Phase 4 to address with a separate column if needed.
- **Single-active-session check uses an in-process dict.** One Fly machine, one user, one session at a time. If deploys ever scale to >1 machine, two tabs on two machines could each open a session; the dict check wouldn't catch it. Not a concern today.

**What this approach optimises for:**

- **Pipecat committed, not hedged.** One code path, one protocol, one latency profile. Maintainable.
- **Latency potential.** The architecture lines up to hit the 500–700ms budget; measurement remains.
- **Shared models, hot startup path.** Smart-turn + Silero VAD load once, not per session. Sub-second session open after lifespan init.
- **Clean abstraction boundaries.** `PipelineBundle` exposes only what `ws.py` needs (task, transport, turns, fingerprint); aggregator internals stay internal. WS protocol is defined by Pipecat's RTVI; we don't invent our own.
- **One lockfile.** Deterministic resolution across the user's Apple Silicon PC, Intel Mac (via Docker), and Fly. No drift.
- **Spanish-only UI + agent.** System prompt is Spanish, preamble is Spanish, register guidance is Spanish. No English leakage path in agent responses; any leak would be a bug, not a fallback.
- **Typed and tested where it matters.** Prompt builder has 10 invariant tests (name/icon/chunks present, no command-injection scaffolding, no English scaffolding, 8KB cap, deterministic fingerprint). Pyright clean across all new modules.

---

## Spec Divergence

| Spec said | What was built | Reason |
|---|---|---|
| Smart-turn model baked into Docker image via `RUN python -c "... download_smart_turn ..."` (deliverable 301) | No Docker bake step. `pipecat-ai[local-smart-turn]` bundles the ONNX file at `site-packages/pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx`. Lifespan loads it in ~70ms. | Spike discovered the model is bundled. The spec's assumption was from out-of-date research. |
| `WebsocketServerTransport` as the transport class | `FastAPIWebsocketTransport` + `FastAPIWebsocketParams` | Spike: `WebsocketServerTransport` is the `websockets`-library variant; FastAPI needs the `.fastapi` module. |
| Prompt caching via `cache_control={"type": "ephemeral"}` per message | `AnthropicLLMService(settings=AnthropicLLMSettings(enable_prompt_caching=True))` | Spike: Pipecat 1.0.0 handles cache_control internally via the Settings flag; manual per-message headers are not the current API. |
| `whisper-large-v3-turbo` + language `"es"` | Same model, `Language.ES` enum | Spike: `GroqSTTService.language` is typed as `Language | None`. |
| Cartesia voice via `settings=CartesiaTTSService.Settings(voice=...)` (per research note) | Direct `voice_id=` parameter on the service constructor | Spike: the research was wrong — voice_id is still a first-class parameter in 1.0.0. |
| Python dev on host; `npm run dev` spawns `uv run uvicorn` + `vite` concurrently | Backend runs in Docker; `npm run dev:backend` is `docker compose up backend`. Frontend unchanged. | Intel Mac host can't install Pipecat. Backend-in-Docker was user-directed after the fallback pivot was reverted. |
| `uv sync` works across maintainers' dev machines | `uv sync` fails deliberately on Mac host (lockfile is Linux-scoped). Backend dev happens in the container. | Same constraint. |
| Single `Dockerfile` with frontend-build → runtime stages | Multi-target: `python-base` → `dev` (editable install + `uvicorn --reload`) + `runtime` (source + frontend dist). | Dev loop needs live reload; prod needs a baked image. One file, two targets. |
| Acceptance: "End-to-end voice loop on localhost" (consumer holds a 5-min Spanish conversation) | Not exercised during implementation. Plumbing verified via unit tests + REST smoke + Docker boot. First real session is user-executed on non-Intel-Mac hardware. | Requires real API keys, mic, and a host where the WS round-trip + audio playback actually work. None of those are present on the implementer's machine. |
| Acceptance: "End-to-end voice loop on Fly. TTFB per turn measured at ~500–700ms." (deliverable 309) | Not deployed to Fly in this phase. Deliverable 309 remains `in-progress`. | Deploy + real session + logs capture. Explicit deferral; the measurement is the deliverable, not part of the code. |
| `docker build .` as a gate | Verified as `docker compose build backend` during dev. Full `docker build --target runtime` (prod) not run this phase — the prod-path frontend-build stage hasn't changed since Phase 2. | The dev target is what Phase 3 adds; it built and booted cleanly. Prod target should be run before first Fly deploy. |
| `pausa` button "keep, redefine, or drop" (open question; default: drop) | Dropped. | Spec's default. Pipecat has no clean pause primitive. |
| `historial` empty-state vs minimal real list (open question; default: leave empty) | Left empty. | Phase 4 will add `GET /api/sessions` and the list rendering. |
| Fallback sketch in the spec (MediaRecorder + direct SDKs) | Implemented briefly during an aborted pivot, then deleted. | User directive after the pivot: "let's switch to running this completely in docker." Fallback is no longer load-bearing. |
| `.env.example` + `CARTESIA_VOICE_ID` | Both present. No default voice ID ships; session start returns a 503 listing missing env vars until set. | Matches spec. |
| Simplify-pass items (`SessionStatus` enum, `iso_now`, `voice_stack_missing`, lifespan Silero, merged error states, unified `lastTurn`, timer clamp) | Added during post-implementation review. | Not in the spec; surfaced by the `/simplify` review flow. Strict improvements. |

---

## Spec Gaps Exposed

- **The spec assumed the implementer could iterate against Pipecat natively.** It did not consider that the maintainer's Intel Mac would fail the install. Future specs that depend on native extensions should include "verified install on maintainer's actual dev platform" as a Validate-Before-Proceeding step, not just "install works on PyPI."
- **The spec's research contained ~5 subtly wrong API shapes** (transport class, VAD placement, turn-stop wrapping, language typing, timestamp fields). The Validation Spike step in the spec caught all of them, but the spec's Confidence section should have been firmer about "the API is the spike's job to confirm, not the research's job to claim." Future complex-integration specs should explicitly frame research as a starting point for the spike, not a source of truth.
- **The spec's deliverable 301 ("Pipecat installed + smart-turn model baked into Docker image") is over-scoped.** The bake step turned out to be unnecessary. The deliverable should have been "Pipecat installed; smart-turn verified to load at startup" — the bake/bundle detail is implementation, not deliverable.
- **The spec didn't account for a Docker dev loop.** It described `npm run dev` as native concurrently, which broke immediately. Future specs involving non-trivial native deps should include "dev loop mechanism" as a first-class deliverable if it's not already solved.
- **`duration_sec` is overloaded** (requested at session start, overwritten with actual at session end). The spec's data-model section doesn't flag the dual meaning. Phase 4's streak work may want both values; worth adding a `requested_duration_sec` column + separate `duration_sec` for actual.
- **`CARTESIA_VOICE_ID` discovery UX is unsolved.** The spec noted that the voice ID must be picked manually from the Cartesia dashboard. No way to list available voices from the app itself; no smoke test that the configured voice actually exists before the first session runs. A preflight check (`GET /voices` at startup, warn if the configured ID isn't in the list) would be low-cost and worth adding.
- **The spec's acceptance criteria conflate "plumbing verified" with "conversation held."** Phase 3's code-level acceptance passed, but the consumer-level acceptance ("learner holds a 5-minute conversation") requires real infrastructure + hardware. Future specs for keystone features should probably separate implementation acceptance (gates green, unit tests, smoke) from consumer-facing acceptance (real session, real deploy, real measurement), so the completion semantics are unambiguous.
- **Spec's explicit fallback sketch is now stale.** It describes a direct-SDK path that has no place in the implementation. Leave it in the spec as historical context or strip it; either way, the current implementation contradicts it. Leaning toward strip in a follow-up housekeeping pass so future readers don't think there's a dual-path design.
- **No frontend test coverage.** Spec explicitly deferred this. The voice client state machine is now the most complex piece of frontend logic in the app and has no automated coverage. Worth revisiting when Phase 5 adds post-session polling (which will layer on top of the voice client's state) — the combined state machine deserves Vitest by then.

---

## Test Evidence

### Gates (Dockerized)

```
$ npm run format:check
Checking formatting...
All matched files use Prettier code style!
20 files already formatted
All checks passed!

$ npm run lint
All checks passed!

$ npm run typecheck
0 errors, 0 warnings, 0 informations

$ npm run test:backend
============================= test session starts ==============================
platform linux -- Python 3.12.13, pytest-9.0.3, pluggy-1.6.0
rootdir: /app/backend
configfile: pyproject.toml
testpaths: tests
plugins: asyncio-1.3.0, anyio-4.13.0
asyncio: mode=Mode.AUTO
collected 10 items

tests/agent/test_prompt.py ..........                                    [100%]

============================== 10 passed in 0.44s ==============================

$ npm run build
vite v6.4.2 building for production...
✓ 46 modules transformed.
dist/index.html                   0.72 kB │ gzip:   0.40 kB
dist/assets/index-BYPp5BgP.css   18.31 kB │ gzip:   3.73 kB
dist/assets/index-BE9TRmoI.js   644.16 kB │ gzip: 181.47 kB
✓ built in 1.75s
```

Bundle 644KB (181KB gz) — up from Phase 2's 213KB because of `@pipecat-ai/client-js` + WebSocket transport. Fine for MVP; code-splitting is a later optimization if the bundle becomes a product concern.

### Docker boot: both audio analyzers load at startup

```
$ docker compose up backend -d && sleep 8 && docker compose logs backend --tail=12

backend-1  | INFO:     Will watch for changes in these directories: ['/app/backend/src']
backend-1  | INFO:     Uvicorn running on http://0.0.0.0:3000 (Press CTRL+C to quit)
backend-1  | INFO:     Started reloader process [9] using WatchFiles
backend-1  | 2026-04-19 19:04:33.000 | INFO     | pipecat:<module>:14 - ᓚᘏᗢ Pipecat 1.0.0 (Python 3.12.13 (main, Apr  7 2026, 02:23:40) [GCC 14.2.0]) ᓚᘏᗢ
backend-1  | INFO:     Started server process [11]
backend-1  | INFO:     Waiting for application startup.
backend-1  | 2026-04-19 19:04:39.270 | DEBUG    | pipecat.audio.turn.smart_turn.local_smart_turn_v3:__init__:70 - Loading Local Smart Turn v3.x model from /app/backend/.venv/lib/python3.12/site-packages/pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx...
backend-1  | 2026-04-19 19:04:39.328 | DEBUG    | pipecat.audio.turn.smart_turn.local_smart_turn_v3:__init__:81 - Loaded Local Smart Turn v3.x
backend-1  | 2026-04-19 19:04:39.329 | DEBUG    | pipecat.audio.vad.silero:__init__:147 - Loading Silero VAD model...
backend-1  | 2026-04-19 19:04:39.397 | DEBUG    | pipecat.audio.vad.silero:__init__:169 - Loaded Silero VAD
backend-1  | INFO:     Application startup complete.
```

Smart-turn v3 load ~58ms; Silero VAD load ~68ms; total lifespan addition ~130ms. Both happen once, shared across sessions.

### REST smoke (WS endpoint construction; no real keys)

```
$ curl -s -o /dev/null -w "scenarios: %{http_code}\n" http://localhost:3000/api/scenarios
scenarios: 200

$ curl -s http://localhost:3000/api/scenarios | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d), [s['name'] for s in d])"
4 ['Bar de barrio', 'Mercado / tienda', 'Casero / vecinos', 'Metro / transporte']

$ curl -s -X POST http://localhost:3000/api/sessions/start \
    -H 'content-type: application/json' \
    -d '{"scenario_id":1,"duration_sec":60}' -w "\nstart (no keys): %{http_code}\n"
{"detail":"voice pipeline not configured: missing ANTHROPIC_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY, CARTESIA_VOICE_ID"}
start (no keys): 503

$ curl -s http://localhost:3000/openapi.json | python3 -c "import json,sys; print('\n'.join(sorted(json.load(sys.stdin)['paths'])))"
/api/chunks
/api/chunks/{chunk_id}
/api/scenarios
/api/scenarios/{scenario_id}
/api/sessions/start
/api/sessions/{session_id}/assess

$ curl -s -o /dev/null -w "WS upgrade (unknown session): %{http_code}\n" \
    -H "Upgrade: websocket" -H "Connection: Upgrade" \
    -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" -H "Sec-WebSocket-Version: 13" \
    http://localhost:3000/ws/session/9999
WS upgrade (unknown session): 403
```

503 message lists *every* missing env var — the `voice_stack_missing()` helper is doing its job. The WS endpoint refuses unknown session IDs cleanly (403 is Starlette's pre-handler refusal for an untracked upgrade; the handler's own 4404 close fires for sessions that exist but aren't `active`).

### What this evidence doesn't show

- **Real voice conversation.** Requires API keys + mic + non-Intel-Mac host. The user's other PC or the first Fly deploy will produce this evidence; until then, Phase 3 is plumbing-verified only.
- **TTFB measurement** (deliverable 309). Requires Fly deploy + live session. Explicit follow-up.
- **Prompt cache hit verification.** Requires running a real session and inspecting Anthropic response `usage.cache_read_input_tokens`. Will be captured in the first-voice-session follow-up.

### User-facing manual smoke (to run on the other PC / after first deploy)

1. Fill `.env` with `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`.
2. `npm run dev` → Vite on 5173, backend container on 3000.
3. Open `http://localhost:5173`, click `empezar sesión` on Bar de barrio scenario, 60s duration.
4. Grant mic. Agent's first utterance should play within ~2s.
5. Speak 3–5 Spanish turns. Status label should cycle `escuchando` / `pensando` / `hablando`.
6. Timer expires → `PostSession`. Pick `bien`, click `guardar sesión`.
7. `sqlite3 data/habla.db "SELECT id, analysis_status, self_assessment, length(transcript) FROM sessions ORDER BY id DESC LIMIT 1;"` → expect `pending | 2 | >100`.
8. Collect per-turn TTFB from `docker compose logs backend` (or `flyctl logs` on deploy) for deliverable 309.
