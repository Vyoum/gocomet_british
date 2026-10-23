import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .config import database_url

_kwargs = {"poolclass": NullPool} if os.environ.get("DB_NULLPOOL") == "1" else {"pool_pre_ping": True}
engine = create_async_engine(database_url(), **_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
