from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Cấu hình đọc từ biến môi trường có tiền tố VS_."""

    model_config = SettingsConfigDict(env_prefix="VS_")

    database_url: str = "postgresql+psycopg://vietstrain:vietstrain@db:5432/vietstrain"
    data_dir: str = "/data"
    work_dir: str = "/work"  # thư mục làm việc của job, nằm trên volume của Docker cho nhanh
    tool_threads: int = 8  # số luồng cho Nextclade và IQ-TREE; bằng số CPU đã dùng khi đo baseline
    work_retention_days: int = 7  # thư mục làm việc của job đã kết thúc được giữ bấy nhiêu ngày để tìm lỗi
    # Dòng nhật ký hành động cũ hơn thế bị xoá khi dọn định kỳ. Ít nhất một ngày: 0 sẽ xoá sạch nhật ký.
    audit_retention_days: int = Field(365, ge=1)
    # Bản publish đã bị thay thế và build cũ được giữ thêm bấy nhiêu ngày, để trình duyệt đang mở chúng còn tải được
    # các cột chưa tải. Ít nhất một ngày.
    publication_retention_days: int = Field(7, ge=1)
    # Số build mới nhất được giữ lại ngoài build hiện hành của mỗi dataset; 0 là chỉ giữ build hiện hành.
    keep_builds: int = Field(5, ge=0)
    cookie_secure: bool = False  # cookie phiên chỉ đi qua HTTPS; bật khi triển khai sau HTTPS


settings = Settings()
