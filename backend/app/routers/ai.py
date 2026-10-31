"""AI endpoints. Summaries are cached so each document is only sent to the model once.

Privacy: hospital accounts never reach these endpoints — medical content stays
between the patient and their doctor.
"""

from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from .. import ai
from ..auth import current_user, require_role
from ..db import get_db
from ..models import Appointment, Attachment, Prescription, User
from ..serializers import audit
from ..tz import iso
from .appointments import ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, _own_appointment

router = APIRouter(tags=["ai"])


def _no_hospital(user: User) -> None:
    if user.role == "hospital":
        raise HTTPException(403, "Medical documents are shared only between the patient and the doctor.")


async def _call(fn, *args):
    try:
        return await run_in_threadpool(fn, *args)
    except ai.AIError as e:
        raise HTTPException(e.status, e.message)


def _read_upload(file: UploadFile) -> bytes:
    if file.content_type not in ALLOWED_UPLOADS:
        raise HTTPException(400, "Only PDF, PNG, JPG or WEBP files can be used.")
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Files must be 5 MB or smaller.")
    if not data:
        raise HTTPException(400, "That file is empty.")
    return data


@router.get("/ai/status")
def status(_: User = Depends(current_user)):
    cfg = ai.config()
    return {"enabled": bool(cfg["key"]), "model": cfg["model"]}


@router.post("/attachments/{att_id}/summary")
async def summarize_attachment(att_id: int, refresh: bool = False, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Doctor gets a clinical summary; the patient gets a plain-language one."""
    _no_hospital(user)
    att = db.scalar(select(Attachment).options(undefer(Attachment.data)).where(Attachment.id == att_id))
    if att is None:
        raise HTTPException(404, "File not found.")
    _own_appointment(db, att.appointment_id, user)
    audience = "doctor" if user.role == "doctor" else "patient"
    field = "ai_summary_doctor" if audience == "doctor" else "ai_summary_patient"
    if getattr(att, field) and not refresh:
        return {"summary": getattr(att, field), "cached": True}
    summary = await _call(ai.summarize_document, att.data, att.content_type, att.filename, audience)
    setattr(att, field, summary)
    db.commit()
    return {"summary": summary, "cached": False}


@router.post("/appointments/{appt_id}/brief")
async def appointment_brief(appt_id: int, refresh: bool = False, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    """Pre-visit brief from the patient's note plus every shared document."""
    appt = _own_appointment(db, appt_id, doc)
    if appt.ai_brief and not refresh:
        return {"brief": appt.ai_brief, "generated_at": iso(appt.ai_brief_at), "cached": True}
    if not appt.reason.strip() and not appt.attachments:
        raise HTTPException(400, "There's nothing to summarise yet — the patient hasn't added a note or any documents.")
    summaries = []
    for att in appt.attachments:
        if not att.ai_summary_doctor:
            data = db.scalar(select(Attachment.data).where(Attachment.id == att.id))
            att.ai_summary_doctor = await _call(ai.summarize_document, data, att.content_type, att.filename, "doctor")
        summaries.append((att.filename, att.ai_summary_doctor))
    brief = await _call(ai.appointment_brief, appt.reason, summaries, appt.patient.name)
    appt.ai_brief, appt.ai_brief_at = brief, datetime.now(timezone.utc)
    db.commit()
    return {"brief": brief, "generated_at": iso(appt.ai_brief_at), "cached": False}


@router.post("/prescriptions/extract")
async def extract_prescription(file: UploadFile = File(...), _: User = Depends(require_role("doctor"))):
    """Read a PDF or handwritten prescription into medicine rows for the doctor to review."""
    data = _read_upload(file)
    return await _call(ai.extract_prescription, data, file.content_type)


@router.post("/prescriptions/{rx_id}/file", status_code=201)
def attach_prescription_file(rx_id: int, file: UploadFile = File(...), doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    rx = db.get(Prescription, rx_id)
    if rx is None or rx.doctor_id != doc.id:
        raise HTTPException(404, "Prescription not found.")
    rx.file_data = _read_upload(file)
    rx.file_name = (file.filename or "prescription")[-200:]
    rx.file_type = file.content_type
    audit(db, doc, "prescription_file", None, doctor_id=doc.id, patient_id=rx.patient_id, filename=rx.file_name)
    db.commit()
    return {"ok": True, "file_name": rx.file_name}


@router.get("/prescriptions/{rx_id}/file")
def get_prescription_file(rx_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _no_hospital(user)
    rx = db.scalar(select(Prescription).options(undefer(Prescription.file_data)).where(Prescription.id == rx_id))
    if rx is None or user.id not in (rx.doctor_id, rx.patient_id):
        raise HTTPException(404, "Prescription not found.")
    if not rx.file_data:
        raise HTTPException(404, "No original file was attached to this prescription.")
    return Response(
        content=rx.file_data,
        media_type=rx.file_type or "application/octet-stream",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(rx.file_name or 'prescription')}"},
    )
