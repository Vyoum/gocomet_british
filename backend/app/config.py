import os


def database_url(raw: str | None = None) -> str:
    """Accept postgres:// / postgresql:// (Render, Heroku style) and force the psycopg v3 driver."""
    url = raw if raw is not None else os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/rfq")
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGIN", "")
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


def redis_url() -> str | None:
    """Redis is optional. Set REDIS_URL (or CELERY_BROKER_URL) to enable the Celery auto-close job + event relay."""
    return os.environ.get("CELERY_BROKER_URL") or os.environ.get("REDIS_URL") or None


def close_sweep_seconds() -> float:
    return float(os.environ.get("CLOSE_SWEEP_SECONDS", "15"))
