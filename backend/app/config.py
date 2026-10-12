from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường có tiền tố VS_."""

    model_config = SettingsConfigDict(env_prefix="VS_")

    database_url: str = "postgresql+psycopg://vietstrain:vietstrain@db:5432/vietstrain"
    data_dir: str = "/data"


settings = Settings()
