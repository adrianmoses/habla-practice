import hashlib
from pathlib import Path

from habla.routes.scenarios import ScenarioOut
from habla.util import load_prompt_body

_PREAMBLE_PATH = Path(__file__).resolve().parents[3].parent / "docs" / "prompts" / "agent-system.md"

_PREAMBLE = load_prompt_body(_PREAMBLE_PATH)


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
