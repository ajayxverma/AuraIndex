from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import vectorstore
from .config import get_settings
from .db import init_db
from .mcp_server import mcp_app, server
from .routers import admin, auth, chat, files, keys, public, vectordb

log = logging.getLogger("uvicorn.error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if not vectorstore.heartbeat():
        s = get_settings()
        log.warning("ChromaDB not reachable at %s:%s (mode=%s). Start it with ./run.sh.",
                    s.chroma_host, s.chroma_port, s.chroma_mode)
    async with server.session_manager.run():
        yield


settings = get_settings()
app = FastAPI(title="RAG Knowledge Base API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(files.router)
app.include_router(chat.router)
app.include_router(vectordb.router)
app.include_router(admin.router)
app.include_router(keys.router)
app.include_router(public.router)
app.mount("/mcp", mcp_app)


@app.get("/health")
def health():
    return {"status": "ok", "chroma": "up" if vectorstore.heartbeat() else "down"}
