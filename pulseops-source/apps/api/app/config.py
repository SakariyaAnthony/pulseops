from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://pulseops:pulseops@127.0.0.1:54329/pulseops"
    redis_url: str = "redis://127.0.0.1:63799/0"
    jwt_secret: str = "dev-pulseops-local-signing-key-32b"
    access_ttl_seconds: int = 900
    refresh_ttl_seconds: int = 60 * 60 * 24 * 7
    api_port: int = 47322
    rate_limit_per_minute: int = 6000
    scan_roots: str = Field(default="", validation_alias="PULSEOPS_SCAN_ROOTS")
    scan_inline: bool = Field(default=False, validation_alias="PULSEOPS_SCAN_INLINE")
    allow_registration: bool = Field(default=True, validation_alias="PULSEOPS_ALLOW_REGISTRATION")
    register_limit_per_hour: int = Field(default=10, validation_alias="PULSEOPS_REGISTER_LIMIT")
    lighthouse_bin: str = Field(default="", validation_alias="PULSEOPS_LIGHTHOUSE_BIN")
    chrome_path: str = Field(default="", validation_alias="PULSEOPS_CHROME_PATH")


settings = Settings()
