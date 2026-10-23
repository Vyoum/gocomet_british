import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import service
from .config import cors_origins, redis_url
from .db import SessionLocal
from .errors import HttpError, issues_from_pydantic
from .events import bus, redis_relay
from .schemas import BidIn, RfqIn
from .serialize import iso

log = logging.getLogger("rfq")
PING_SECONDS = 20


class Viewer:
    """DEMO roles only — NOT authentication. Headers are trusted as sent by the client.
    No X-Role header = legacy behaviour (everything allowed). Real auth would replace this
    dependency with one that verifies a JWT and reads role/supplier from its claims."""

    def __init__(self, role: str | None, supplier: str | None):
        self.role, self.supplier = role, supplier


def get_viewer(
    x_role: str | None = Header(default=None, alias="X-Role"),
    x_supplier: str | None = Header(default=None, alias="X-Supplier"),
) -> Viewer:
    role = (x_role or "").strip().lower() or None
    if role not in (None, "buyer", "supplier"):
        raise HttpError(400, "X-Role must be 'buyer' or 'supplier'")
    supplier = (x_supplier or "").strip() or None
    if role == "supplier" and supplier is None:
        raise HttpError(400, "X-Supplier header is required when X-Role is 'supplier'")
    return Viewer(role, supplier if role == "supplier" else None)


def forbid_supplier(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    # Runs before body validation, so a supplier gets 403 even for an invalid payload.
    if viewer.role == "supplier":
        raise HttpError(403, "Suppliers cannot create RFQs")
    return viewer


def forbid_buyer(viewer: Viewer = Depends(get_viewer)) -> Viewer:
    if viewer.role == "buyer":
        raise HttpError(403, "Buyers cannot submit bids")
    return viewer


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as s:
        yield s


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Only when REDIS_URL / CELERY_BROKER_URL is set: relay events published by the Celery worker to SSE clients.
        task = asyncio.create_task(redis_relay()) if redis_url() else None
        try:
            yield
        finally:
            if task:
                task.cancel()

    app = FastAPI(title="RFQ British Auction API", lifespan=lifespan)
    # CORS_ORIGIN: comma-separated allowed origins (e.g. the Vercel URL). Unset = allow all.
    origins = cors_origins()
    app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["Idempotent-Replayed"])

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        errs = exc.errors()
        if any(e.get("type") == "json_invalid" for e in errs):
            return JSONResponse({"error": "Malformed JSON body"}, status_code=400)
        return JSONResponse({"error": "Validation failed", "details": issues_from_pydantic(errs)}, status_code=400)

    @app.exception_handler(HttpError)
    async def _http(_: Request, exc: HttpError):
        body = {"error": exc.message}
        if exc.details is not None:
            body["details"] = exc.details
        return JSONResponse(body, status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _starlette(_: Request, exc: StarletteHTTPException):
        return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        code = getattr(exc.orig, "sqlstate", None)
        if code == "23505":
            return JSONResponse({"error": "Duplicate value for unique field"}, status_code=409)
        if code == "23503":
            return JSONResponse({"error": "Referenced record does not exist"}, status_code=400)
        if code == "23514":
            return JSONResponse({"error": "Constraint violated"}, status_code=400)
        log.exception("integrity error", exc_info=exc)
        return JSONResponse({"error": "Internal server error"}, status_code=500)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse({"error": "Internal server error"}, status_code=500)

    @app.get("/api/health")
    async def health():
        return {"ok": True, "time": iso(service.utcnow())}

    @app.get("/api/suppliers")
    async def suppliers(s: AsyncSession = Depends(get_session)):
        return await service.list_suppliers(s)

    @app.post("/api/suppliers")
    async def ensure_supplier(body: dict, s: AsyncSession = Depends(get_session)):
        # Demo helper: get-or-create a carrier by name (lets the role switcher add a new carrier).
        name = body.get("name") if isinstance(body, dict) else None
        if not isinstance(name, str):
            raise HttpError(400, "Validation failed", [{"code": "invalid_type", "path": ["name"], "message": "Required"}])
        return await service.ensure_supplier(s, name)

    @app.get("/api/rfqs")
    async def rfqs(s: AsyncSession = Depends(get_session), viewer: Viewer = Depends(get_viewer)):
        return await service.list_rfqs(s, viewer=viewer.supplier)

    @app.post("/api/rfqs", status_code=201)
    async def create_rfq(body: RfqIn, s: AsyncSession = Depends(get_session), _: Viewer = Depends(forbid_supplier)):
        return await service.create_rfq(s, body)

    @app.get("/api/rfqs/{rfq_id}")
    async def rfq_details(rfq_id: str, s: AsyncSession = Depends(get_session)):
        return await service.get_rfq_details(s, rfq_id)

    @app.post("/api/rfqs/{rfq_id}/bids", status_code=201)
    async def place_bid(
        rfq_id: str,
        body: BidIn,
        response: Response,
        s: AsyncSession = Depends(get_session),
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
        viewer: Viewer = Depends(forbid_buyer),
    ):
        # A replay of an earlier Idempotency-Key returns the original 201 body unchanged, flagged by a header.
        result = await service.place_bid(s, rfq_id, body, idempotency_key=idempotency_key, acting_supplier=viewer.supplier)
        if idempotency_key is not None:
            response.headers["Idempotent-Replayed"] = "true" if result.replayed else "false"
        return dict(result)

    # Server-Sent Events: emits {rfqId} whenever any RFQ changes; clients refetch. Comment pings keep proxies happy.
    @app.get("/api/events")
    async def events(request: Request):
        q = bus.subscribe()

        async def stream():
            try:
                yield ": connected\n\n"
                while not await request.is_disconnected():
                    try:
                        rfq_id = await asyncio.wait_for(q.get(), timeout=PING_SECONDS)
                        yield f"data: {json.dumps({'rfqId': rfq_id}, separators=(',', ':'))}\n\n"
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
            finally:
                bus.unsubscribe(q)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
