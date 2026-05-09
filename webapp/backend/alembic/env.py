from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import make_url

from app.settings import get_settings
# Base is defined in Phase B (Task B1). Alembic isn't invoked until then,
# so this dangling import is intentional — it'll resolve when B1 lands.
from app.storage.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
# Strip async driver suffixes; keep psycopg3 as the sync driver too
# (postgresql+psycopg works for both sync and async).
_url = make_url(settings.database_url)
_drivername_map = {
    "sqlite+aiosqlite": "sqlite",
    "postgresql+psycopg_async": "postgresql+psycopg",
    # bare "postgresql" defaults to psycopg2 in SQLAlchemy; force psycopg3
    "postgresql": "postgresql+psycopg",
    "postgres": "postgresql+psycopg",
}
_sync_drv = _drivername_map.get(_url.drivername, _url.drivername)
config.set_main_option(
    "sqlalchemy.url",
    str(_url.set(drivername=_sync_drv)),
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
