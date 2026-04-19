from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from fastapi import WebSocket
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    Frame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    AssistantTurnStoppedMessage,
    LLMAssistantAggregator,
    LLMUserAggregator,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi.observer import RTVIObserver
from pipecat.processors.frameworks.rtvi.processor import RTVIProcessor
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.anthropic.llm import AnthropicLLMService, AnthropicLLMSettings
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.groq.stt import GroqSTTService
from pipecat.transcriptions.language import Language
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import (
    TurnAnalyzerUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from habla.agent.prompt import build_system_prompt, system_prompt_fingerprint
from habla.config import settings as app_settings
from habla.routes.scenarios import ScenarioOut
from habla.util import iso_now

log = logging.getLogger(__name__)

Role = Literal["user", "agent"]

HAIKU_MODEL = "claude-haiku-4-5"
SONIC_MODEL = "sonic-3"
WHISPER_MODEL = "whisper-large-v3-turbo"
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000


@dataclass
class Turn:
    role: Role
    text: str
    started_at: str
    ended_at: str


@dataclass
class PipelineBundle:
    task: PipelineTask
    transport: FastAPIWebsocketTransport
    turns: list[Turn]
    system_prompt_fingerprint: str


class TurnCapture(FrameProcessor):
    def __init__(self, turns: list[Turn]):
        super().__init__()
        self._turns = turns
        self._user_turn_start: str | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            now = iso_now()
            self._turns.append(
                Turn(
                    role="user",
                    text=frame.text.strip(),
                    started_at=self._user_turn_start or now,
                    ended_at=now,
                )
            )
            self._user_turn_start = None
        await self.push_frame(frame, direction)


class TTSAudioTrace(FrameProcessor):
    """Logs the TTS→transport audio path so we can tell if the server is producing audio
    when the browser hears nothing. Cheap enough to leave on during Phase 3."""

    def __init__(self) -> None:
        super().__init__()
        self._bytes = 0
        self._chunks = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSStartedFrame):
            self._bytes = 0
            self._chunks = 0
            log.info("tts: started")
        elif isinstance(frame, TTSAudioRawFrame):
            self._bytes += len(frame.audio)
            self._chunks += 1
            if self._chunks == 1:
                log.info("tts: first audio chunk (%d bytes)", len(frame.audio))
        elif isinstance(frame, TTSStoppedFrame):
            log.info("tts: stopped — %d chunks, %d bytes total", self._chunks, self._bytes)
        await self.push_frame(frame, direction)


def build_pipeline(
    *,
    websocket: WebSocket,
    scenario: ScenarioOut,
    vad: SileroVADAnalyzer,
    smart_turn: LocalSmartTurnAnalyzerV3,
    session_timeout_secs: int,
) -> PipelineBundle:
    assert app_settings.anthropic_api_key
    assert app_settings.groq_api_key
    assert app_settings.cartesia_api_key
    assert app_settings.cartesia_voice_id

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=INPUT_SAMPLE_RATE,
            audio_out_sample_rate=OUTPUT_SAMPLE_RATE,
            add_wav_header=False,
            session_timeout=session_timeout_secs,
            # The @pipecat-ai/websocket-transport browser client speaks Pipecat's
            # protobuf frame protocol. Without this, the WS handshake succeeds
            # but bot-side RTVI events never reach the browser.
            serializer=ProtobufFrameSerializer(),
        ),
    )

    stt = GroqSTTService(
        api_key=app_settings.groq_api_key,
        model=WHISPER_MODEL,
        language=Language.ES,
    )
    llm = AnthropicLLMService(
        api_key=app_settings.anthropic_api_key,
        model=HAIKU_MODEL,
        settings=AnthropicLLMSettings(enable_prompt_caching=True),
    )
    tts = CartesiaTTSService(
        api_key=app_settings.cartesia_api_key,
        voice_id=app_settings.cartesia_voice_id,
        model=SONIC_MODEL,
        sample_rate=OUTPUT_SAMPLE_RATE,
    )

    system_prompt = build_system_prompt(scenario)
    fp = system_prompt_fingerprint(system_prompt)
    context = LLMContext(messages=[{"role": "system", "content": system_prompt}])

    turn_stop = TurnAnalyzerUserTurnStopStrategy(turn_analyzer=smart_turn)
    aggregator_user = LLMUserAggregator(
        context=context,
        params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(stop=[turn_stop]),
            vad_analyzer=vad,
        ),
    )
    aggregator_assistant = LLMAssistantAggregator(context=context)

    turns: list[Turn] = []
    turn_capture = TurnCapture(turns)

    @aggregator_assistant.event_handler("on_assistant_turn_stopped")
    async def _on_assistant_turn_stopped(
        _aggregator: LLMAssistantAggregator, msg: AssistantTurnStoppedMessage
    ) -> None:
        content = msg.content or ""
        text = content.strip() if isinstance(content, str) else str(content).strip()
        if not text:
            return
        # Aggregator only exposes a single timestamp; we treat it as turn end.
        ts = msg.timestamp or iso_now()
        turns.append(Turn(role="agent", text=text, started_at=ts, ended_at=ts))

    rtvi = RTVIProcessor(transport=transport)

    pipeline = Pipeline(
        [
            transport.input(),
            rtvi,
            stt,
            turn_capture,
            aggregator_user,
            llm,
            tts,
            TTSAudioTrace(),
            transport.output(),
            aggregator_assistant,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=INPUT_SAMPLE_RATE,
            audio_out_sample_rate=OUTPUT_SAMPLE_RATE,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        observers=[RTVIObserver(rtvi)],
    )

    return PipelineBundle(task=task, transport=transport, turns=turns, system_prompt_fingerprint=fp)
