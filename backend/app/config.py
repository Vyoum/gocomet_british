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
