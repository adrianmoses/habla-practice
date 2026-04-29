from datetime import UTC, datetime
from pathlib import Path


def iso_now() -> str:
    return datetime.now(UTC).isoformat()


def load_prompt_body(path: Path, marker: str = "---") -> str:
    """Read a prompt artefact and return the body after the first horizontal-rule marker.

    Authored prompt files keep an explanatory header above a `---` rule; only the
    text below is the actual system prompt. If no marker is present, return the
    entire file (stripped). Used by `habla.agent.prompt` and `habla.analysis.judge`.
    """
    raw = path.read_text(encoding="utf-8")
    parts = raw.split(f"\n{marker}\n", 1)
    body = parts[1] if len(parts) == 2 else raw
    return body.strip()
