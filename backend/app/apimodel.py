"""Lớp gốc cho mọi kiểu dữ liệu mà API nhận và trả."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """JSON dùng camelCase (quy ước của phía TypeScript); mã Python vẫn dùng snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)
