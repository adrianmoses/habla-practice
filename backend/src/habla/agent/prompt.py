import hashlib
from pathlib import Path

from habla.routes.scenarios import ScenarioOut

_PREAMBLE_PATH = Path(__file__).resolve().parents[3].parent / "docs" / "prompts" / "agent-system.md"

_PREAMBLE_MARKER = "---"


def _load_preamble() -> str:
    raw = _PREAMBLE_PATH.read_text(encoding="utf-8")
    # The authored file has a meta-explanation block at the top separated by a horizontal rule.
    # Only the body after the first `---` is the actual system prompt.
    parts = raw.split(f"\n{_PREAMBLE_MARKER}\n", 1)
    body = parts[1] if len(parts) == 2 else raw
    return body.strip()


_PREAMBLE = _load_preamble()


def build_system_prompt(scenario: ScenarioOut) -> str:
    chunk_lines = "\n".join(f"- {c.text_es}" for c in scenario.chunks)
    return (
        f"{_PREAMBLE}\n\n"
        f"## Escenario\n\n"
        f"{scenario.icon} {scenario.name}\n\n"
        f"## Frases que conviene practicar\n\n"
        f"{chunk_lines}\n"
    )


def system_prompt_fingerprint(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:12]
