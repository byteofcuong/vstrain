from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# hide_parameters: thông báo lỗi của SQLAlchemy không chép lại giá trị gửi kèm câu lệnh. Thông báo đó đi vào log và
# vào `job.error`, còn giá trị có thể là email vừa thử đăng nhập hay cả một genome. (Phần thông báo do chính
# PostgreSQL viết thì không bị ảnh hưởng.)
engine = create_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Một session cho mỗi request."""
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
