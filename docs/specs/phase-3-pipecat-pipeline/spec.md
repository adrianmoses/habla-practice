---
name: Phase 3 — Pipecat voice pipeline + JS client
description: Bundled spec for ROADMAP features 301–309 — Pipecat backend pipeline (Silero VAD + smart-turn → Groq STT → Claude Haiku → Cartesia TTS), WS endpoint per session, sessions REST routes, frontend voice client wrapper, LiveSession/PostSession integration, and TTFB budget verification on Fly
type: spec
---

# Spec: Phase 3 — Pipecat voice pipeline end-to-end

| Field | Value |
|---|---|
| id | phase-3 |
| status | approved |
| created | 2026-04-19 |
| roadmap | [ROADMAP.md §Phase 3](../ROADMAP.md#phase-3--pipecat-voice-pipeline-end-to-end) — features 301–309 |

---

## Why

Habla Practice exists to put a learner under real conversational pressure in colloquial Madrid Spanish. Phases 1 and 2 produced the data model, the CRUD surface, and the three-tab UI shell, but the product's **central interaction** — picking a scenario and actually *speaking Spanish to an agent that talks back* — does not exist yet. The `empezar sesión` button currently routes to a timer-only stub. Until Phase 3 lands, there is no product, only scaffolding.

Phase 3 wires the keystone vertical slice: browser mic in → Pipecat pipeline (smart-turn VAD → Groq Whisper STT → Claude Haiku LLM → Cartesia Sonic TTS) → browser speakers out, with a structured turn-by-turn transcript captured live and persisted on session end. Everything the rest of the roadmap depends on (Phases 4–6 — streak, judge, SRS) consumes that transcript. Without Phase 3, those phases have nothing to read.

This is also where the cost curve and the latency curve start. The `ARCHITECTURE.md` time-to-first-agent-audio budget (~500–700ms per turn) is the spec we'll measure against on a real Fly machine — anything substantially worse means a config issue (cache miss, wrong model, REST instead of WS endpoint) and the phase isn't done until it's in budget.

### Consumer Impact

The solo learner gets the *actual product* for the first time:

- **A real role-play.** Picks a scenario, hits `empezar sesión`, grants mic permission, and immediately hears the agent open the conversation in Madrid Spanish. Speaks back; agent responds with sub-second latency. Holds a 5–20 minute conversation under genuine conversational pressure — no translation panel, no English, no hint mode (per `OVERVIEW.md` non-goals).
- **Session persistence.** The conversation is saved as a structured transcript JSON the moment it ends. The learner can verify their session exists in the historial tab as a row (deployment ratio still pending until Phase 5).
- **A coherent post-session loop.** After the timer expires (or `terminar`), they self-rate (difícil / regular / bien / fluido), see chunks marked `⏳ pendiente`, and the assessment is stored against the session row. Judging itself doesn't run yet — chunks stay `⏳` — but the data flow that Phase 5 will read is in place.
- **A working agent persona.** The agent speaks in colloquial Madrid register, knows what scenario it's playing (bartender, casero, etc.), and tries to *elicit* the target chunks naturally without commanding the learner to say them. The persona quality is iterable in `docs/prompts/agent-system.md` without code changes.

### Roadmap Fit

- **Depends on Phase 1**: scenarios + chunks schema, seeded scenarios, `aiosqlite` connection, FastAPI lifespan. The new `sessions` table already exists in schema (per `db/schema.py:27-39`) — Phase 3 starts writing to it.
- **Depends on Phase 2**: `LiveSession.jsx` and `PostSession.jsx` exist as components plumbed into `App.jsx`'s overlay state machine. Phase 3 swaps the timer-only body of `LiveSession` for a real Pipecat client and points `PostSession`'s `guardar sesión` at `POST /api/sessions/:id/assess`. No app-shell or routing changes.
- **Blocks Phase 4** (streak/dashboard): Phase 4's `GET /api/streak` reads `sessions.ended_at` to compute the daily streak and weekly grid. With no real sessions being persisted, Phase 4 has nothing to count.
- **Blocks Phase 5** (judge): Phase 5's analysis worker reads `sessions.transcript` (JSON) and writes `chunk_deployments`. Until Phase 3 produces real transcripts, Phase 5 has no input. The `analysis_status='pending'` transition that Phase 5 polls for is what Phase 3 sets when the WS handler tears down.
- **Blocks Phase 6** (SRS): Phase 6's SM-2 update is triggered after judging, which is gated on Phase 5, which is gated on Phase 3. Same chain.
- **Defers post-session UI completion to Phase 5**: chunks stay `⏳ pendiente` forever in Phase 3 — the `⏳ → ✓/✗` transition lives in Phase 5 because the judge doesn't exist yet.
- **Defers cost caps**: per `ARCHITECTURE.md`'s "Cost shape" note ("No spend caps in code yet — call out as Phase 3 follow-up if it becomes a concern"), Phase 3 ships without spend caps. Will be flagged in the decision record if usage during Phase 3 dev shows it's load-bearing.

---

## What

### Acceptance Criteria

From the consumer's perspective:

- [ ] **End-to-end voice loop on localhost.** Learner clicks `empezar sesión` on a seeded scenario → browser prompts for mic → mic granted → agent's first utterance plays through speakers within ~2 seconds of granting permission → learner speaks → agent responds within the per-turn budget. Holds a continuous 5-minute conversation in Spanish with no manual reconnects.
- [ ] **End-to-end voice loop on Fly.** Same as above, deployed to `fra` region. Time-to-first-agent-audio per turn measured at ~500–700ms (per `ARCHITECTURE.md` budget). Measurement procedure documented and the actual number captured in the decision record.
- [ ] **Spanish-only agent.** Agent only speaks colloquial Madrid Spanish. No English ever leaks into agent output, even if the learner says English. (Verified by running a session and inspecting the transcript JSON.)
- [ ] **Scenario-aware persona.** Agent's tone + topical openings match the picked scenario (bartender greets at the bar, casero at the door, market vendor calling out wares). Target chunks are *attempted to be elicited* naturally, never commanded ("no me digas que digas X" — the agent should never namedrop the chunks).
- [ ] **Live transcript capture.** Every finalized user STT and every assistant LLM completion is captured into a `turns` list with `started_at` / `ended_at` ISO timestamps as the conversation happens (no post-session transcription pass).
- [ ] **Session persistence on normal end.** Timer expires or learner clicks `terminar` → backend persists `transcript` JSON to `sessions.transcript`, sets `analysis_status='pending'`, `ended_at`, and `duration_sec`. Verifiable: `SELECT id, scenario_id, length(transcript), analysis_status FROM sessions ORDER BY id DESC LIMIT 5`.
- [ ] **Session persistence on abnormal end.** WebSocket drops mid-session (network blip, browser tab close) → backend persists *whatever turns it captured up to that point* and marks `analysis_status='failed'`. No session is ever silently dropped without a row.
- [ ] **Self-assessment storage.** `PostSession`'s `guardar sesión` POSTs to `/api/sessions/:id/assess` with `{self_assessment: 0|1|2|3}`. Backend persists to `sessions.self_assessment`. UI returns to `sesión` tab afterward.
- [ ] **Single active session enforcement.** Backend refuses a `WS /ws/session/{id}` connection if (a) the session doesn't exist, (b) `status != 'active'`, (c) any other WS for any session is already open, or (d) the same session already has a connection. Refusal is a clean WS close with a code/reason, not a crash.
- [ ] **Mic permission denied is graceful.** If the learner denies the mic prompt (or there's no mic), `LiveSession` shows a Spanish error state and lets the learner abandon the session cleanly (which marks the row `failed`).
- [ ] **No browser-side API keys.** `git grep` of `frontend/src/` finds no Anthropic / Groq / Cartesia keys, no provider-direct WebSocket URLs, no calls to anything but `/api/*` and `/ws/session/*`. All third-party traffic is server-side.
- [ ] **Smart-turn model is baked into the Docker image.** Cold starts on Fly do not pay a Hugging Face download. Verifiable: `flyctl ssh console` → `ls` the cache path → file present, mtime older than the deploy time.
- [ ] **Anthropic prompt caching is hitting** on the scenario system prompt. Verifiable: enable Anthropic API request logging on the second+ turn of a session and confirm `cache_read_input_tokens > 0`.
- [ ] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build`, and `docker build .` all pass.

### Non-Goals

- **No LLM-as-judge, no rep counting, no SRS.** Chunks stay `⏳ pendiente` in `PostSession` forever in Phase 3. The `⏳ → ✓/✗` transition, the rep-count circle wiring, and the SM-2 due-state surfacing all land in Phases 5/6.
- **No streak, no weekly grid, no dashboard counters.** Even though sessions are now real, the home-screen stats tiles and the historial weekly grid still render placeholder dashes — `GET /api/streak` doesn't exist yet (lands in Phase 4).
- **No `historial` tab session list yet.** A session is persisted to the `sessions` table, but the `historial` view does not call a `GET /api/sessions` route in Phase 3 — that's Phase 4's deliverable. (Verifying a session was persisted is via DB inspection or curl to a one-off list endpoint, not via the UI.) **Open question:** if the `historial` empty state feels jarring once real sessions exist in the DB, may add a minimal `GET /api/sessions` + list rendering in Phase 3 — see Open Questions.
- **No barge-in / interruption handling.** If the learner starts speaking while the agent is mid-utterance, the spec is "agent finishes; STT picks up the learner's turn after." Pipecat supports interruption with extra wiring; Phase 3 leaves it for a follow-up if the lack of barge-in feels broken in practice.
- **No mid-session pause that retains agent state.** The `pausa` button from the Phase 2 stub *can* stay (silences the timer + tears down the audio I/O) but resuming starts a fresh agent turn — there's no Pipecat-side "freeze the LLM context" primitive worth wiring. **Open question:** alternatively, drop `pausa` from `LiveSession` entirely in Phase 3 since it has no real-world meaning when the agent is talking. See Open Questions.
- **No session auto-end on prolonged silence.** Only the timer or explicit `terminar` ends a session. (Idle-disconnect behavior is fine because the WS is kept alive by Pipecat's audio frames; if the learner walks away, the timer still expires.)
- **No spend caps, no token budget enforcement.** Per `ARCHITECTURE.md` cost-shape note: deferred. Will record actual per-session cost in the decision record from real test sessions.
- **No multi-user, no auth.** Single-user assumption preserved. No CSRF / rate limiting on the WS endpoint beyond the single-active-session check.
- **No frontend test framework.** Vitest still deferred. Manual click-through + a backend pytest sanity test for the prompt builder is the verification.
- **No `transcript` shape versioning.** First version of the JSON is what we ship. If the shape changes later, that's a migration concern for whichever phase introduces the change.
- **No `agent_prompt_hash` returned from `POST /api/sessions/start`.** `ARCHITECTURE.md` mentions it as part of the start response, but it's only useful for prompt-cache observability. Phase 3 logs the hash server-side instead of plumbing it to the client.
- **No measurement instrumentation in the UI.** Time-to-first-agent-audio is measured by attaching to Pipecat's frame timestamps server-side (or via the browser SDK's event timings if exposed) — not by adding bespoke `performance.now()` calls in the React tree. Goal is the *measurement*, not a permanent observability surface.
- **No structured agent output / function calling.** The agent is a plain conversational LLM. It doesn't emit chunk-deployment guesses or anything else for the judge to consume — that's the judge's whole job in Phase 5.
- **No CORS / non-same-origin support.** Frontend is served by FastAPI in prod and proxied by Vite in dev. The WS endpoint inherits the same-origin assumption.

### Open Questions

- **Pipecat browser client transport: WebSocket vs WebRTC.** `OVERVIEW.md` and `ARCHITECTURE.md` both spec a Pipecat WebSocket transport (`WebsocketServerTransport` on the backend). The trade-off vs. WebRTC: WebSocket is simpler (no STUN/TURN, no SDP exchange, native browser API), and `pipecat-ai` exposes a WebSocket transport on both sides. WebRTC has slightly better audio characteristics (built-in jitter buffer, packet loss concealment, Opus by default) but adds infrastructure (TURN server) for cross-NAT use. Given single-user / same-origin / Fly-only deployment, **WebSocket is the right call.** Confirm during implementation that `pipecat-ai`'s browser SDK still ships a first-class WebSocket transport — if it has been deprecated in favor of WebRTC-only, escalate as a re-spec. **Default: WebSocket.**
- **Browser audio encoding.** Pipecat's WebSocket transport expects PCM16 frames at a specific sample rate (typically 16 kHz mono). Browser `getUserMedia` produces float32 at 48 kHz; the browser SDK should handle the resample + conversion via an AudioWorklet. **Validate: confirm the SDK does this transparently;** if it doesn't, we own the AudioWorklet code in `lib/voice.js`.
- **Cartesia voice ID for Madrid Spanish.** `ARCHITECTURE.md` says "Madrid Spanish voice ID lives in `agent/pipeline.py` (carry over from previous Cartesia integration)." There is no previous Cartesia integration in this clean-break Python project — that line is stale (it referenced the deleted Node backend). **Decide during implementation:** browse Cartesia's voice library, pick a Spain-Spanish (preferably Madrid-leaning) voice, hardcode the ID. If no Madrid-specific voice exists, pick the closest peninsular Spanish and document the choice. Falls back to env var `CARTESIA_VOICE_ID` so we don't need a code change to swap.
- **Smart-turn model: download path, loader API, image bake mechanics.** The spec calls for baking the model into the Docker image at build time. Concrete details to nail down: (a) the exact `pipecat-ai[smart-turn]` extra name in current Pipecat, (b) the model identifier (Hugging Face repo or Pipecat-hosted), (c) the env var or constructor arg that points the runtime at a pre-downloaded path so it doesn't re-download. **Validate via a 10-line spike** before adding the `RUN python -c …` step to the Dockerfile.
- **Anthropic prompt cache invalidation.** Cache TTL is 1 hour. If a learner runs back-to-back sessions of the same scenario, turns 2+ of the second session benefit. If the scenario's chunks are edited via the `frases` tab between sessions, the system prompt content changes → cache miss. **Decision: accept this**, since editing chunks is rare relative to running sessions, and the first-turn cost increase is small.
- **Session lifecycle states + analysis_status overlap.** The schema's `analysis_status` column carries values `active|ended|pending|judged|complete|failed` (per `ARCHITECTURE.md` data model). Phase 3 only writes `active` (on `POST /api/sessions/start`), `pending` (on clean WS close after `self_assessment` is set), and `failed` (on WS drop without `self_assessment`). There's no separate `status` column — `analysis_status` doubles as session lifecycle and analysis lifecycle. **Decision: keep the single column** to avoid a migration; document the multi-purpose role in the decision record.
- **`historial` empty-state vs minimal real list.** Once Phase 3 starts persisting real sessions, the `historial` tab will *still* show "aún no hay sesiones" because there's no `GET /api/sessions` route. This is an honest reflection of "no view wired yet" but might feel like a regression. **Default: leave it.** Phase 4 brings the streak + dashboard wiring and is the natural place to add a minimal session list. If it feels broken during Phase 3 dev, escalate.
- **`pausa` button: keep, redefine, or drop.** Phase 2's stub `pausa` toggled the timer interval. With a real Pipecat pipeline, "pause" is ambiguous — the LLM has no sleep state, the WS is stream-active, etc. **Default: drop the button** in Phase 3 to avoid implying a behavior we don't deliver. If the user wants it back later, define it as "tear down audio I/O, freeze timer, allow `reanudar` to re-open the WS to the same session" — non-trivial.
- **WS auth.** Single-user, no auth. The session_id in the URL acts as a capability token. Anyone who can reach the FastAPI server can open a session by guessing IDs (autoincrement → trivial). **Acceptable** because the deploy is private and single-user. Worth a one-line comment in `routes/ws.py` so future-us doesn't think this is an oversight.
- **Whisper model variant.** `ARCHITECTURE.md` says `whisper-large-v3-turbo` "or current equivalent". Confirm Groq's currently best model name during implementation; if the API surface has shifted, pick the lowest-latency Spanish-capable model.
- **Anthropic SDK version + Pipecat compatibility.** Pipecat's Anthropic processor wraps the SDK. Pin a Pipecat version that supports Claude Haiku (the latest small model — confirm exact ID at impl time) and prompt caching. Worst case, we own a thin wrapper that calls the SDK directly with caching headers. **Validate via the spike** with the selected Pipecat version.

---

## How

### Approach

Phase 3 is the deepest cross-stack phase so far. The work is naturally three slices: **(A) backend pipeline factory + WS endpoint**, **(B) sessions REST routes**, **(C) frontend voice client + LiveSession/PostSession integration**. They can be developed in roughly that order — A is the most independent, B is small and depends on the schema, C waits on A's WS handshake being verifiable end-to-end (curl + a tiny throwaway browser test page if needed).

#### Slice A — Backend pipeline + WS endpoint

**`backend/pyproject.toml` deps**:

```toml
"pipecat-ai[cartesia,anthropic,groq,silero,smart-turn]>={current}",
"anthropic>={current}",   # also a top-level dep for the Phase 5 judge; pinning here is fine
```

(Exact extra names + version pin determined during the validation spike — Pipecat's extras have shifted historically.)

**`backend/src/habla/agent/prompt.py`** — pure function:

```python
def build_system_prompt(scenario: Scenario) -> str: ...
def system_prompt_hash(prompt: str) -> str: ...   # for log correlation, prompt-cache observability
```

The system prompt is composed of:
1. A scenario-agnostic preamble loaded from `docs/prompts/agent-system.md` (see deliverable below) — Madrid register guidance, "never reveal you're an AI in Spanish or English", "never command the learner to use specific phrases", target turn length, etc.
2. A scenario-specific section: persona statement (`"Eres camarero/a en un bar de barrio en Lavapiés."` etc., generated from `scenario.name + scenario.icon` plus a small per-scenario blurb — initially derived from the scenario's existing `name` only; if the seed needs richer persona text, add a `persona_blurb` column in a follow-up).
3. The list of target chunks as `### Frases que conviene practicar` — explicitly framed as "try to elicit naturally if the topic comes up; do not name them".

The full prompt is always identical across the session (no per-turn variability) so it can be marked `cache_control={"type": "ephemeral"}` for Anthropic prompt caching.

**`docs/prompts/agent-system.md`** — the scenario-agnostic preamble, authored as part of this phase. Living doc; tweaks to tone/persona happen here, not in code.

**`backend/src/habla/agent/pipeline.py`** — pipeline factory:

```python
def build_pipeline(
    scenario: ScenarioOut,
    transport: WebsocketServerTransport,
    on_turn: Callable[[Turn], None],
) -> Pipeline:
    """
    Wires Silero VAD + smart-turn → Groq Whisper STT → Anthropic Claude Haiku → Cartesia Sonic TTS.
    The custom on_turn callback is called every time a finalized user STT or assistant LLM
    completion is observed, with {role, text, started_at, ended_at}.
    """
```

Key wiring details:
- **VAD**: `SileroVADAnalyzer` (Pipecat's standard) + `LocalSmartTurnAnalyzer` (loaded from the pre-baked image path). Smart-turn classifier loaded once at app startup (in `main.py` lifespan) and shared across pipelines, not re-instantiated per session.
- **STT**: `GroqSTTService` with `whisper-large-v3-turbo` (or current best), language hint `es`.
- **LLM**: `AnthropicLLMService` with `claude-haiku-4-5-20251001`, streaming on, system prompt cached via `cache_control`. Conversation history maintained per-session by Pipecat's standard context aggregator.
- **TTS**: `CartesiaTTSService` over Cartesia's WebSocket endpoint, voice ID from env `CARTESIA_VOICE_ID` (with a hardcoded peninsular-Spanish default), streaming.
- **Frame sink**: a small custom `FrameProcessor` that observes `TranscriptionFrame` (user-side) and `TTSStartedFrame`/`TextFrame` (assistant-side) — exact frame names to confirm against the Pipecat version. Each finalized turn appends `{role, text, started_at, ended_at}` to a per-pipeline `turns: list[Turn]`. Timestamps from the frame metadata if available, else `datetime.now(UTC).isoformat()`.

**`backend/src/habla/routes/ws.py`** — WS endpoint:

```python
@router.websocket("/ws/session/{session_id}")
async def session_ws(websocket: WebSocket, session_id: int): ...
```

Behaviour:
1. Look up the session in `sessions` table. If missing or `analysis_status != 'active'`, close with code 4404.
2. Check the per-app singleton `app.state.active_ws: dict[int, WebSocket]`. If non-empty (any session has an active WS), close with code 4409. (Single-active-session policy.)
3. Accept the WS, register in `app.state.active_ws[session_id]`.
4. Build the agent system prompt from the scenario, instantiate the Pipecat `WebsocketServerTransport` bound to this WS, build the pipeline, run it.
5. On clean teardown (Pipecat's `EndFrame` / WS close from client / timer-driven server-side close):
   - Persist `turns` JSON to `sessions.transcript`.
   - Update `sessions`: `ended_at = now`, `duration_sec = (ended_at - started_at).seconds`, `analysis_status = 'pending'`.
6. On exception or abnormal close:
   - Best-effort persist of whatever `turns` we captured.
   - Set `analysis_status = 'failed'`, `ended_at = now`.
7. Always: pop from `app.state.active_ws`.

**Server-driven session end**: the timer is *client-driven* (browser counts down and closes the WS when it hits zero), but the server also enforces a max-duration ceiling = `duration_sec + 30s` to handle a runaway client. The 30s slack absorbs network + Pipecat teardown.

**`backend/src/habla/main.py`** — additions in lifespan:
- Load smart-turn model once into `app.state.smart_turn_model`. (Cold start cost paid here, not per session.)
- Initialize `app.state.active_ws: dict[int, WebSocket] = {}`.

#### Slice B — Sessions REST routes

**`backend/src/habla/routes/sessions.py`**:

```python
@router.post("/sessions/start", status_code=201)
async def start_session(payload: SessionStart, conn: DbDep) -> SessionStartOut:
    # Validates scenario_id exists, refuses if any other session is currently 'active'
    # (consistent with single-active-session policy at the WS layer).
    # Inserts row: status=active, started_at=now, duration_sec=payload.duration_sec.
    # Returns {session_id, ws_url}

@router.post("/sessions/{session_id}/assess", status_code=204)
async def assess_session(session_id: int, payload: SessionAssess, conn: DbDep): ...
    # Updates self_assessment on the row. Validates 0..3.
    # Idempotent (last write wins).
```

Pydantic models:
```python
class SessionStart(BaseModel):
    scenario_id: int
    duration_sec: int = Field(ge=60, le=1800)

class SessionStartOut(BaseModel):
    session_id: int
    ws_url: str   # "/ws/session/{id}"

class SessionAssess(BaseModel):
    self_assessment: int = Field(ge=0, le=3)
```

**Note on `duration_sec` storage**: the row gets `duration_sec` *requested* at creation time, then *overwritten* with the actual `(ended_at - started_at)` on session end. The actual is what Phases 4/5/6 read; the requested is what the WS handler uses for the server-side max-duration ceiling.

#### Slice C — Frontend voice client + UI integration

**`frontend/package.json`** adds:

```json
"@pipecat-ai/client-js": "^X.X.X",
"@pipecat-ai/websocket-transport": "^X.X.X"
```

(Exact package names confirmed during the validation spike. If `client-js` already includes a WebSocket transport, the second dep is unnecessary.)

**`frontend/src/lib/api.js`** — append:

```js
export function startSession({scenario_id, duration_sec}) { /* POST /api/sessions/start */ }
export function assessSession(id, {self_assessment})       { /* POST /api/sessions/:id/assess */ }
```

**`frontend/src/lib/voice.js`** — Pipecat browser client wrapper. Class-based or factory; consumer's view is a small state-machine API:

```js
export function createVoiceSession({wsUrl}) {
  return {
    start: async () => {/* getUserMedia, open WS, hand to Pipecat client */},
    end: async () => {/* close WS gracefully */},
    on: (event, cb) => {/* events: 'connecting', 'listening', 'speaking', 'thinking', 'turn', 'error', 'closed' */},
  };
}
```

The `'turn'` event fires on every finalized user/assistant turn (mirrored from the server-side frame sink — Pipecat's browser SDK exposes frame events too). LiveSession can use it for a chunk-pill highlight effect if desired (probably not in Phase 3 since the spec calls for "chunk pills (always visible, never highlighted during the session)").

Mic permission handling: `getUserMedia({audio: true})` — on rejection, `error` event with a `code: 'mic-denied'`. `LiveSession` catches and renders the Spanish error state.

**`frontend/src/views/LiveSession.jsx`** — replace timer-only stub. The component still owns the timer + `terminar`, but additionally:
- On mount: call `startSession({scenario_id, duration_sec})` → get `{session_id, ws_url}` → call `createVoiceSession({wsUrl}).start()`.
- `LiveSession` props gain `onEnd(sessionId)` so the post screen knows which session_id to attach the assessment to.
- Status label cycles per `voice.on('listening' | 'speaking' | 'thinking')` — `escuchando…`, `hablando…`, `pensando…`.
- Drop or redefine `pausa` per the open question. **Default: drop.** `terminar` and timer-expiry both call `voice.end()` and then `onEnd(sessionId)`.
- Mic-denied state: full-overlay Spanish error message with a `cerrar` button that calls `onEnd(null)` → `App.jsx` clears the overlay without going to PostSession (since there was no real session).

**`frontend/src/views/PostSession.jsx`** — wire `guardar sesión`:
- Props gain `sessionId`. If `sessionId == null` (mic-denied path), the overlay either skips PostSession entirely (App-side decision) or shows a "sesión no iniciada" variant.
- `guardar sesión` calls `assessSession(sessionId, {self_assessment})` then `onSave()`.
- Disable the button until an assessment is selected.
- On API error, show inline error and let the learner retry.

**`frontend/src/App.jsx`** — overlay state machine:
- `live` overlay state gains `sessionId: number | null` (set after `startSession` resolves).
- `post` overlay state gains `sessionId: number`.
- `handleLiveEnd(sessionId)` transitions live → post (or closes overlay if `sessionId == null`).
- Refetch scenarios after `handlePostSave` (so any future `due_at` changes from Phase 6 will refresh; harmless in Phase 3).

**`frontend/vite.config.js`** — add WS proxy:

```js
server: {
  proxy: {
    "/api": "http://localhost:3000",
    "/ws":  { target: "ws://localhost:3000", ws: true },
  },
},
```

**Latency measurement (deliverable 309)**:

After deploy to Fly, run a real session and capture per-turn TTFB. Approach:
- Add temporary timing logs in `agent/pipeline.py`'s frame processor: on `UserStoppedSpeakingFrame`, capture `t0`; on the first `TTSAudioRawFrame` of the agent's response, capture `t1`. Log `(t1 - t0).total_seconds()` per turn.
- Run a 5-minute session; collect per-turn timings; report median + p95 in the decision record.
- If median > 1s, debug (likely cache miss → confirm Anthropic returns `cache_read_input_tokens > 0` from turn 2 onward; or wrong Cartesia transport → confirm WS not REST; or wrong Whisper model).
- Remove (or downgrade to debug-level) the timing logs before merging.

#### Dockerfile changes (deliverable 301)

Add a smart-turn-model bake step in the runtime stage, after `uv sync`:

```dockerfile
# Pre-download the smart-turn model into the image so cold starts don't pay the network round-trip.
ENV PIPECAT_SMART_TURN_MODEL_DIR=/opt/models/smart-turn
RUN mkdir -p $PIPECAT_SMART_TURN_MODEL_DIR && \
    uv run --no-sync python -c "from pipecat... import download_smart_turn; download_smart_turn('$PIPECAT_SMART_TURN_MODEL_DIR')"
```

(Exact import path determined during the spike. Falls back to manually `wget`-ing the model files from the Hugging Face repo into the image if Pipecat doesn't expose a clean download function.)

`agent/pipeline.py` reads `PIPECAT_SMART_TURN_MODEL_DIR` at startup and passes it to `LocalSmartTurnAnalyzer`. Falls back to default cache for local dev.

**Volume**: the smart-turn model lives in the image (`/opt/models/...`), not the volume (`/data`). The volume is exclusively for `habla.db`. (`ARCHITECTURE.md` mentioned the volume hosts the model cache; that was a spec-time guess — baking into the image is cleaner because it avoids a cold-start penalty on a fresh volume.)

#### Config / env

`backend/src/habla/config.py` adds:
- `cartesia_voice_id: str = "<peninsular-spanish-default>"` (TBD in spike)
- `pipecat_smart_turn_model_dir: Path | None = None`

The three API keys (`groq_api_key`, `anthropic_api_key`, `cartesia_api_key`) are *currently optional* in `config.py:12-14`. Phase 3 changes this:
- Keys remain `str | None` in the Settings model (so the app can still boot in dev without them — useful for the CRUD-only flows).
- `routes/sessions.py:start_session` checks all three are set; if any is missing, returns 503 `{"detail": "voice pipeline not configured: missing FOO_API_KEY"}`. This way `npm run dev` still works for Phase 1/2-style flows (CRUD on scenarios/chunks) without API keys, and only the start-session call fails loudly with a clear message.

`.env.example` (if absent, create) lists all three keys + `CARTESIA_VOICE_ID`.

#### File layout summary

Net-new + modified:

```
backend/src/habla/
├── main.py                          ← MOD: lifespan loads smart-turn model + initialises active_ws dict
├── config.py                        ← MOD: cartesia_voice_id, pipecat_smart_turn_model_dir
├── agent/
│   ├── prompt.py                    ← NEW: build_system_prompt(scenario) → str
│   └── pipeline.py                  ← NEW: build_pipeline(scenario, transport, on_turn) → Pipeline
├── routes/
│   ├── sessions.py                  ← NEW: /api/sessions/start, /api/sessions/:id/assess
│   └── ws.py                        ← NEW: WS /ws/session/{id} per-connection pipeline
docs/prompts/
└── agent-system.md                  ← NEW: scenario-agnostic Madrid persona preamble

frontend/
├── vite.config.js                   ← MOD: add /ws proxy
├── package.json                     ← MOD: add @pipecat-ai/client-js (+ ws transport pkg)
└── src/
    ├── App.jsx                      ← MOD: overlay state carries sessionId
    ├── lib/
    │   ├── api.js                   ← MOD: startSession + assessSession
    │   └── voice.js                 ← NEW: Pipecat client wrapper
    └── views/
        ├── LiveSession.jsx          ← REWRITE: voice client + status cycling + mic-denied state
        └── PostSession.jsx          ← MOD: POST assessSession on guardar

Dockerfile                            ← MOD: bake smart-turn model into image
backend/pyproject.toml                ← MOD: add pipecat-ai + extras + anthropic
.env.example                          ← NEW (if absent): list required keys + voice id
```

### Confidence

**Level:** Medium

**Rationale:**

- **Phase 1+2 backbone is solid.** Schema, FastAPI lifespan, aiosqlite, frontend overlay-state machine, dev proxy — all known and exercised. Slice B (sessions REST) and the App.jsx wiring are mechanical extensions and high-confidence on their own.
- **Pipecat is the genuine unknown.** The framework's exact version, extras, frame names, browser SDK package names, and smart-turn loader API have all shifted historically. The architecture spec hedges (`@pipecat-ai/client-js or equivalent`, "exact extras pinned to what Pipecat publishes"). We need a small spike before committing to a final dependency manifest and pipeline construction code.
- **Latency budget (~500–700ms TTFB) is ambitious but achievable.** Anthropic prompt caching + Groq Whisper + Cartesia WS are individually fast. Compounding them at this budget assumes everything is configured correctly. The risk is not "can it be done" but "did we configure it right" — and the only way to know is to run a real session on Fly and measure.
- **Browser audio plumbing has known sharp edges.** Resampling 48kHz float32 → 16kHz PCM16 in real-time is a solved problem but a tedious one if Pipecat's browser SDK doesn't handle it. We may end up writing AudioWorklet code; that's manageable but slower than wishlist scenarios.
- **Cartesia voice ID for Madrid Spanish is a content question.** Picking the right voice is half the product feel. If no peninsular voice is available, the agent will sound Latin American — acceptable for shipping but a regression on the product's "colloquial Madrid" promise. May warrant a small follow-up to evaluate alternatives.

**Validate before proceeding** (~half-day spike before full implementation):

1. **Pipecat version + extras**: `uv add 'pipecat-ai[cartesia,anthropic,groq,silero,smart-turn]'`; verify the package installs cleanly, inspect what extras actually ship under those names. Lock the version.
2. **Smart-turn model loader API**: import the smart-turn analyzer; confirm a clean way to point it at a pre-downloaded directory; identify the model identifier so the Dockerfile bake step is concrete.
3. **Hello-world pipeline**: write a 50-line Pipecat pipeline that takes mic in (CLI-side via a test harness Pipecat ships) and echoes a TTS response. Verifies the imports + frame plumbing + Anthropic + Cartesia keys work locally.
4. **Browser SDK package names + transport**: `npm view @pipecat-ai/client-js versions`; check Pipecat's docs for the current browser SDK + WebSocket transport package names. Confirm WebSocket transport is still first-class (vs. WebRTC-only).
5. **Cartesia voice picker**: list Cartesia's Spanish voices via their API; pick the most peninsular-sounding one; record the voice_id.

If any of the above turn up a blocker (e.g., WebSocket transport is gone from the browser SDK; Cartesia has no Spanish voices) — escalate before writing implementation code.

### Key Decisions

- **WebSocket transport, not WebRTC.** Lower infra cost (no TURN), simpler client code, sufficient audio quality for single-user same-origin same-region. If audio quality becomes a complaint, revisit.
- **Single connection per process.** Backend refuses overlapping WS connections via an in-process `app.state.active_ws` dict. Matches the single-user product stance and avoids needing a real session-locking mechanism.
- **Smart-turn model in the image, not the volume.** The volume is durable cross-deploy state (the DB); the model is build-time content. Image-baked = no cold-start penalty on a fresh volume.
- **System prompt is fully cached.** Built deterministically from `scenario` content, never includes per-turn variability, marked `cache_control={"type": "ephemeral"}`. First turn pays full cost; turns 2+ hit cache. If chunks change between sessions, scenario fingerprint changes → cache miss; accepted.
- **`analysis_status` doubles as session lifecycle.** No separate `status` column. Phase 3 writes `active`, `pending`, `failed`. Documented.
- **No `pausa` button in Phase 3.** Drop it from `LiveSession`. Pipecat doesn't have a clean "freeze the LLM" primitive worth wiring; pretending we do via the timer-toggle stub from Phase 2 misleads the learner.
- **Voice ID via env var with a hardcoded default.** `CARTESIA_VOICE_ID` overrides; default is the best peninsular voice we can find. Lets us tweak the voice without a code deploy.
- **No backend tests for the pipeline itself in this phase.** Pipecat's pipeline is mostly third-party orchestration; testing it via mocks would test our mocking, not the pipeline. We *do* add a small pytest for `agent/prompt.py:build_system_prompt` (pure function, deterministic, asserts the scenario name + chunks land in the prompt) since that's where our content lives. The pipeline itself is verified by running real sessions.
- **API keys remain optional in `Settings`, gating happens at session-start.** Lets `npm run dev` boot with no keys for non-voice work; produces a clean 503 when a voice session is attempted without keys.
- **Frontend voice client is a thin wrapper, not a custom audio stack.** Lean on `@pipecat-ai/client-js` for everything Pipecat exposes (mic capture, WS handshake, audio playback, state events). Only own the React glue in `LiveSession`.
- **Server-driven max-duration ceiling = requested duration + 30s.** Defends against runaway clients. 30s absorbs Pipecat teardown latency + network blips.

### Testing Approach

Per `OVERVIEW.md`, the formal pytest harness lands in Phase 5. Phase 3 adds *one* small pytest (the prompt-builder unit test) and otherwise relies on manual + measurement-based verification.

**Automated (lands this phase):**

- `backend/tests/agent/test_prompt.py` — `build_system_prompt(scenario)` snapshot + invariants:
  - Contains the scenario name.
  - Contains every chunk's `text_es`.
  - Does NOT include a string instructing the agent to say the chunks (anti-prompt-injection of our own content — guards against accidentally telling the agent "tell the learner to say X").
  - Length ≤ a sane cap (8KB) — the cache-control benefit shrinks if the prompt is huge.

**Gates (must pass before merge):**

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `cd backend && uv run pytest`
- `docker build .` (validates the smart-turn model bake step in CI)

**Manual verification (captured in decision record with timings):**

1. **Cold local boot**: `npm run dev` → uvicorn loads smart-turn model in lifespan; log line confirms model loaded from local path. No errors.
2. **Session start**: Browser → click `empezar sesión` → Network tab shows `POST /api/sessions/start` 201 → WebSocket to `/ws/session/{id}` opened. Mic permission prompt appears.
3. **First agent utterance**: Within ~2s of mic grant, agent speaks. Transcript JSON in DB (`SELECT transcript FROM sessions ORDER BY id DESC LIMIT 1`) shows the agent's first turn after the session ends.
4. **Multi-turn conversation**: Hold a 5-turn Spanish exchange. Confirm:
   - Status label cycles through `escuchando`, `pensando`, `hablando` correctly.
   - Per-turn TTFB measured server-side via the temporary timing logs; medians + p95 captured.
   - On turn 2+, Anthropic API response includes `cache_read_input_tokens > 0` (verifiable via temporary log of the response usage).
5. **Clean end (timer)**: Set duration to 60s, wait it out. WS closes server-side. DB row shows `analysis_status='pending'`, `transcript` populated, `ended_at` set, `duration_sec` = ~60.
6. **Clean end (terminar)**: New session, hit `terminar` after 30s. Same DB invariants.
7. **Mid-session WS drop**: Force-close the browser tab during a session. DB row shows `analysis_status='failed'`, `transcript` populated with whatever turns were captured.
8. **Self-assessment persistence**: From a clean-end session → PostSession → pick `bien` → `guardar sesión`. DB row shows `self_assessment=2`.
9. **Mic denied**: Block mic permission in browser → click `empezar sesión` → Spanish error state, `cerrar` returns to home. DB row exists with `analysis_status='failed'`.
10. **Single-active-session**: Open two browser tabs, start a session in tab A, try `empezar sesión` in tab B → 409 from `POST /api/sessions/start` (or the WS connect is rejected, depending on which check triggers first). Spanish error surfaces.
11. **Spanish-only**: After a session, scan transcript JSON for any English (`/the\b|\bthe\b|\band\b/i` regex). Should find none. (If the learner intentionally said English, agent's response should still be Spanish.)
12. **API contract grep**: `git grep -E "(api\.)?(anthropic|groq|cartesia)\.com" frontend/src/` → no matches. `git grep -E "(GROQ|ANTHROPIC|CARTESIA)_API_KEY" frontend/` → no matches.

**Fly verification (captured in decision record):**

13. After deploy, repeat steps 4–6 against the production URL. TTFB measurements from a live `flyctl logs` capture during a session. Compare median + p95 against the 500–700ms budget. Document if out of budget + the diagnostic step taken.
14. `flyctl ssh console` → confirm smart-turn model present at the baked path with mtime older than the deploy time (proves it's image-baked, not runtime-downloaded).

**Cost capture (informational, decision record):**

- After the Fly verification session, fetch token usage from the Anthropic console and Cartesia dashboard for the test session. Record approximate $/session/min as a baseline. Flag if it points to a near-term spend cap need.

---

## Completion Criteria

- [ ] All required sections populated.
- [ ] Validation spike (5 items above) completed and findings recorded inline before implementation begins.
- [ ] Open questions resolved or explicitly deferred with a default in the decision record.
- [ ] Status flipped from `draft` → `approved` after human review.
- [ ] `ROADMAP.md` features 301–309 status flipped from `planned` → `in-progress`.
