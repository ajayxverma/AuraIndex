from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import jobs, vectorstore
from ..config import get_settings
from ..db import Document, User, get_db
from ..loaders import SUPPORTED_TYPES, file_extension
from ..security import get_current_user

router = APIRouter(prefix="/api/files", tags=["files"])
settings = get_settings()


class DocumentOut(BaseModel):
    id: str
    filename: str
    file_type: str
    size_bytes: int
    chunk_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadResult(BaseModel):
    jobs: list[dict]
    errors: list[dict]


@router.get("", response_model=list[DocumentOut])
def list_files(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (db.query(Document).filter(Document.user_id == user.id)
            .order_by(Document.created_at.desc()).all())


@router.get("/stats")
def stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (db.query(Document.file_type, func.count(Document.id), func.sum(Document.size_bytes),
                     func.sum(Document.chunk_count))
            .filter(Document.user_id == user.id).group_by(Document.file_type).all())
    return {
        "total_files": sum(r[1] for r in rows),
        "total_bytes": sum(r[2] or 0 for r in rows),
        "total_chunks": sum(r[3] or 0 for r in rows),
        "by_type": {r[0]: r[1] for r in rows},
    }


@router.post("", response_model=UploadResult, status_code=202)
async def upload(files: list[UploadFile], user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """Queues files for background indexing; poll GET /api/files/jobs for progress."""
    max_bytes = settings.max_upload_mb * 1024 * 1024
    queued, errors = [], []
    in_progress = jobs.active_hashes(user.id)
    for f in files:
        name = (f.filename or "unnamed")[:512]
        ext = file_extension(name)
        if ext not in SUPPORTED_TYPES:
            errors.append({"filename": name, "error": f"Unsupported type '.{ext}'"})
            continue
        data = await f.read(max_bytes + 1)
        if len(data) > max_bytes:
            errors.append({"filename": name, "error": f"Exceeds {settings.max_upload_mb} MB"})
            continue
        digest = jobs.content_hash(data)
        existing = db.query(Document).filter(Document.user_id == user.id,
                                             Document.content_hash == digest).first()
        if existing:
            errors.append({"filename": name,
                           "error": f"Already uploaded as '{existing.filename}'"})
            continue
        if digest in in_progress:
            errors.append({"filename": name, "error": "Same file is already being indexed"})
            continue
        in_progress.add(digest)
        queued.append(jobs.submit(user.id, name, ext, data, digest).public())
    return UploadResult(jobs=queued, errors=errors)


@router.get("/jobs")
def list_jobs(user: User = Depends(get_current_user)):
    return [j.public() for j in jobs.list_jobs(user.id)]


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, user: User = Depends(get_current_user)):
    job = jobs.cancel(user.id, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job.public()


@router.delete("/{document_id}", status_code=204)
def delete(document_id: str, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == document_id,
                                    Document.user_id == user.id).first()
    if not doc:
        raise HTTPException(404, "File not found")
    vectorstore.delete_document(doc.id)
    db.delete(doc)
    db.commit()
