"""In-process background indexing with progress tracking and cancellation."""
import hashlib
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from . import vectorstore
from .config import get_settings
from .db import Document, SessionLocal
from .loaders import chunk_text, extract_text

EMBED_BATCH = 32
RETAIN_SECONDS = 600
ACTIVE = {"queued", "extracting", "embedding", "saving"}
log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


@dataclass
class Job:
    user_id: int
    filename: str
    file_type: str
    size_bytes: int
    content_hash: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    document_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "queued"
    progress: float = 0.0
    chunks_total: int = 0
    chunks_done: int = 0
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)

    def public(self) -> dict:
        return {
            "id": self.id, "filename": self.filename, "file_type": self.file_type,
            "size_bytes": self.size_bytes, "status": self.status,
            "progress": round(self.progress, 1), "chunks_total": self.chunks_total,
            "chunks_done": self.chunks_done, "error": self.error,
            "document_id": self.document_id if self.status == "done" else None,
        }


_jobs: dict[str, Job] = {}
_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="indexer")


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _purge() -> None:
    cutoff = time.time() - RETAIN_SECONDS
    for jid in [j.id for j in _jobs.values() if j.finished_at and j.finished_at < cutoff]:
        del _jobs[jid]


def submit(user_id: int, filename: str, ext: str, data: bytes, digest: str) -> Job:
    job = Job(user_id=user_id, filename=filename, file_type=ext, size_bytes=len(data),
              content_hash=digest)
    with _lock:
        _purge()
        _jobs[job.id] = job
    _executor.submit(_run, job, data)
    return job


def list_jobs(user_id: int) -> list[Job]:
    with _lock:
        _purge()
        return sorted((j for j in _jobs.values() if j.user_id == user_id),
                      key=lambda j: j.created_at, reverse=True)


def active_hashes(user_id: int) -> set[str]:
    with _lock:
        return {j.content_hash for j in _jobs.values()
                if j.user_id == user_id and j.status in ACTIVE}


def cancel(user_id: int, job_id: str) -> Job | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.user_id != user_id:
            return None
        job.cancel_event.set()
        if job.status == "queued":
            _finish(job, "cancelled")
        return job


def cancel_all(user_id: int | None, timeout: float = 30.0) -> None:
    """Cancel a user's active jobs (or everyone's when user_id is None) and wait for cleanup."""
    with _lock:
        targets = [j for j in _jobs.values()
                   if j.status in ACTIVE and (user_id is None or j.user_id == user_id)]
    for job in targets:
        cancel(job.user_id, job.id)
    deadline = time.time() + timeout
    while time.time() < deadline and any(j.status in ACTIVE for j in targets):
        time.sleep(0.2)


def _finish(job: Job, status: str, error: str | None = None) -> None:
    job.status, job.error, job.finished_at = status, error, time.time()


def _check(job: Job) -> None:
    if job.cancel_event.is_set():
        raise Cancelled


def _run(job: Job, data: bytes) -> None:
    with _lock:
        if job.status != "queued":  # cancelled while waiting in the queue
            return
        job.status, job.progress = "extracting", 2
    s = get_settings()
    try:
        text = extract_text(data, job.file_type)
        del data
        _check(job)
        chunks = chunk_text(text, s.chunk_size, s.chunk_overlap)
        if not chunks:
            raise ValueError("No extractable text")
        job.chunks_total, job.status, job.progress = len(chunks), "embedding", 5
        for i in range(0, len(chunks), EMBED_BATCH):
            _check(job)
            batch = chunks[i : i + EMBED_BATCH]
            vectorstore.add_chunks(job.user_id, job.document_id, job.filename, batch, start=i)
            job.chunks_done = i + len(batch)
            job.progress = 5 + 90 * job.chunks_done / job.chunks_total
        _check(job)
        job.status, job.progress = "saving", 97
        with SessionLocal() as db:
            db.add(Document(id=job.document_id, user_id=job.user_id, filename=job.filename,
                            file_type=job.file_type, size_bytes=job.size_bytes,
                            chunk_count=len(chunks), content_hash=job.content_hash))
            db.commit()
        job.progress = 100
        _finish(job, "done")
    except Cancelled:
        _cleanup(job)
        _finish(job, "cancelled")
    except Exception as e:
        _cleanup(job)
        _finish(job, "failed", str(e)[:300])


def _cleanup(job: Job) -> None:
    try:
        vectorstore.delete_document(job.document_id)
    except Exception:
        log.exception("Failed to remove chunks for cancelled/failed job %s", job.id)
