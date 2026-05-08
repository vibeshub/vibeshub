from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VIBESHUB_", env_file=".env")

    database_url: str = Field(default="sqlite+aiosqlite:///:memory:")
    blob_dir: Path = Field(default=Path("/tmp/vibeshub-blobs"))
    github_api_base: str = Field(default="https://api.github.com")
    max_trace_bytes: int = Field(default=50 * 1024 * 1024)
    renderer_version: str = Field(default="claude-code-log:v1")


def get_settings() -> Settings:
    return Settings()
