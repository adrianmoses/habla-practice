from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    data_dir: Path = Path("./data")
    port: int = 3000

    groq_api_key: str | None = None
    anthropic_api_key: str | None = None
    cartesia_api_key: str | None = None
    # Pick a peninsular voice from the Cartesia dashboard and set in .env.
    # Empty by default — session start returns 503 until set.
    cartesia_voice_id: str = ""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "habla.db"

    def voice_stack_missing(self) -> list[str]:
        return [
            name
            for name, value in (
                ("ANTHROPIC_API_KEY", self.anthropic_api_key),
                ("GROQ_API_KEY", self.groq_api_key),
                ("CARTESIA_API_KEY", self.cartesia_api_key),
                ("CARTESIA_VOICE_ID", self.cartesia_voice_id),
            )
            if not value
        ]


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
