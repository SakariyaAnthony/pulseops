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


settings = Settings()
