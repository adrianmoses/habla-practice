from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    data_dir: Path = Path("./data")
    port: int = 3000

    groq_api_key: str | None = None
    anthropic_api_key: str | None = None
    cartesia_api_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "habla.db"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
