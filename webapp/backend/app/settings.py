from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VIBESHUB_", env_file=".env")

    database_url: str = Field(default="sqlite+aiosqlite:///:memory:")
    blob_dir: Path = Field(default=Path("/tmp/vibeshub-blobs"))
    azure_storage_account_url: str | None = Field(default=None)
    azure_storage_connection_string: str | None = Field(default=None)
    azure_blob_container: str | None = Field(default=None)
    github_api_base: str = Field(default="https://api.github.com")
    max_trace_bytes: int = Field(default=50 * 1024 * 1024)
    renderer_version: str = Field(default="claude-code-log:v1")
    public_base_url: str = Field(default="https://vibeshub.app")


def get_settings() -> Settings:
    return Settings()
