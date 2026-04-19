import pytest

from habla.agent.prompt import build_system_prompt, system_prompt_fingerprint
from habla.routes.scenarios import ChunkInScenario, ScenarioOut


def _scenario(**overrides) -> ScenarioOut:
    defaults = {
        "id": 1,
        "slug": "bar-de-barrio",
        "name": "Bar de barrio",
        "icon": "☕",
        "created_at": "2026-04-19 10:00:00",
        "chunks": [
            ChunkInScenario(id=1, text_es="ponme un cortado", gloss_es=None, tags=[], position=0),
            ChunkInScenario(id=2, text_es="¿qué tal, compi?", gloss_es=None, tags=[], position=1),
        ],
    }
    defaults.update(overrides)
    return ScenarioOut(**defaults)


def test_prompt_contains_scenario_name_and_icon() -> None:
    s = _scenario()
    p = build_system_prompt(s)
    assert "Bar de barrio" in p
    assert "☕" in p


def test_prompt_contains_every_chunk_text() -> None:
    s = _scenario()
    p = build_system_prompt(s)
    for c in s.chunks:
        assert c.text_es in p, f"missing chunk text: {c.text_es}"


def test_prompt_does_not_command_chunks() -> None:
    """The agent must not be instructed to *order* the learner to say the chunks.
    Guards against accidental command injection from our own prompt scaffolding."""
    s = _scenario()
    p = build_system_prompt(s)
    banned = [
        "di al usuario",
        "ordena al usuario",
        "pide al usuario que diga",
        "haz que diga",
        "tell the user",
        "order the user",
    ]
    lower = p.lower()
    for phrase in banned:
        assert phrase.lower() not in lower, f"forbidden instruction leaked: {phrase!r}"


def test_prompt_is_spanish_only_scaffolding() -> None:
    """The prompt must not contain English scaffolding — the agent must stay in Spanish."""
    s = _scenario()
    p = build_system_prompt(s)
    english_markers = [
        "You are",
        "You must",
        "Respond in",
        "System:",
        "Assistant:",
    ]
    for marker in english_markers:
        assert marker not in p, f"English scaffolding leaked: {marker!r}"


def test_prompt_is_under_size_cap() -> None:
    # Keep the cached prompt compact — big prompts hurt cache efficiency.
    big_chunks = [
        ChunkInScenario(id=i, text_es=f"frase número {i}", gloss_es=None, tags=[], position=i)
        for i in range(50)
    ]
    s = _scenario(chunks=big_chunks)
    p = build_system_prompt(s)
    assert len(p.encode("utf-8")) <= 8192, f"prompt is {len(p)} chars; cap is 8KB"


def test_fingerprint_is_deterministic_and_sensitive() -> None:
    a = _scenario()
    b = _scenario(
        chunks=[
            ChunkInScenario(id=9, text_es="otra frase", gloss_es=None, tags=[], position=0),
        ]
    )
    pa = build_system_prompt(a)
    pb = build_system_prompt(b)
    assert system_prompt_fingerprint(pa) == system_prompt_fingerprint(pa)
    assert system_prompt_fingerprint(pa) != system_prompt_fingerprint(pb)


@pytest.mark.parametrize("icon", ["☕", "🏪", "🏠", "🚇"])
def test_prompt_handles_all_seed_icons(icon: str) -> None:
    s = _scenario(icon=icon)
    p = build_system_prompt(s)
    assert icon in p
