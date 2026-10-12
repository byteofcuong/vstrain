from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường có tiền tố VS_."""

    model_config = SettingsConfigDict(env_prefix="VS_")

    database_url: str = "postgresql+psycopg://vietstrain:vietstrain@db:5432/vietstrain"
    data_dir: str = "/data"
    work_dir: str = "/work"  # thư mục làm việc của job, nằm trên volume của Docker cho nhanh
    tool_threads: int = 8  # số luồng cho Nextclade và IQ-TREE; bằng số CPU đã dùng khi đo baseline


settings = Settings()
