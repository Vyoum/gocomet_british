import asyncio
import json
import logging
from typing import AsyncIterator

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import service
from .config import cors_origins
from .db import SessionLocal
from .errors import HttpError, issues_from_pydantic
from .events import bus
from .schemas import BidIn, RfqIn
from .serialize import iso

log = logging.getLogger("rfq")
PING_SECONDS = 20


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as s:
        yield s


def create_app() -> FastAPI:
    app = FastAPI(title="RFQ British Auction API")
    # CORS_ORIGIN: comma-separated allowed origins (e.g. the Vercel URL). Unset = allow all.
    origins = cors_origins()
    app.add_middleware(CORSMiddleware, allow_origins=origins or ["*"], allow_methods=["*"], allow_headers=["*"])

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

    @app.get("/api/rfqs")
    async def rfqs(s: AsyncSession = Depends(get_session)):
        return await service.list_rfqs(s)

    @app.post("/api/rfqs", status_code=201)
    async def create_rfq(body: RfqIn, s: AsyncSession = Depends(get_session)):
        return await service.create_rfq(s, body)

    @app.get("/api/rfqs/{rfq_id}")
    async def rfq_details(rfq_id: str, s: AsyncSession = Depends(get_session)):
        return await service.get_rfq_details(s, rfq_id)

    @app.post("/api/rfqs/{rfq_id}/bids", status_code=201)
    async def place_bid(rfq_id: str, body: BidIn, s: AsyncSession = Depends(get_session)):
        return await service.place_bid(s, rfq_id, body)

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
