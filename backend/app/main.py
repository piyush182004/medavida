import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy import text

from .db import IS_SQLITE, Base, SessionLocal, engine
from .routers import ai, appointments, auth, doctors, hospital, meta, prescriptions
from .seed import seed_demo

log = logging.getLogger("slotzero")
SETUP_LOCK_ID = 7_302_001  # arbitrary, app-wide


def setup_database() -> None:
    def run():
        Base.metadata.create_all(engine)
        if os.getenv("SEED_DEMO", "true").lower() == "true":
            with SessionLocal() as db:
                seed_demo(db)

    if IS_SQLITE:
        run()
        return
    # Several workers/instances start at once: a Postgres advisory lock makes
    # exactly one of them create tables and seed, the rest wait and then skip.
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": SETUP_LOCK_ID})
        try:
            run()
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SETUP_LOCK_ID})
            conn.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_database()
    yield


app = FastAPI(
    title="SlotZero API",
    version="1.0.0",
    description="Conflict-free doctor appointment scheduler",
    lifespan=lifespan,
)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


FIELD_NAMES = {"start_utc": "Start time", "start_local": "Start", "end_local": "End", "date": "Date"}


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    """Turn pydantic errors into one plain-language sentence."""
    err = exc.errors()[0]
    field = next((str(p) for p in reversed(err.get("loc", [])) if isinstance(p, str) and p not in ("body", "query")), "")
    label = FIELD_NAMES.get(field, field.replace("_", " ").capitalize())
    msg = err.get("msg", "is invalid").removeprefix("Value error, ")
    return JSONResponse(status_code=422, content={"detail": f"{label}: {msg}" if label else msg})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception):
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


@app.get("/")
def root():
    return {"name": "SlotZero API", "docs": "/docs", "health": "/health"}


for r in (meta.router, auth.router, doctors.router, hospital.router, appointments.router, prescriptions.router, ai.router):
    app.include_router(r)
