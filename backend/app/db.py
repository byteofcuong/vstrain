from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Một session cho mỗi request."""
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
