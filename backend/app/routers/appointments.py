import secrets
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, undefer

from ..auth import current_user, require_role
from ..db import get_db
from ..models import Appointment, Attachment, AuditLog, User
from ..schemas import BookIn, CancelIn, ProposeIn, RescheduleIn
from ..scheduling import CANCEL_CUTOFF, HELD_STATUSES, check_bookable, doctor_lock, fee_for
from ..serializers import appointment_out, attachment_out, audit, audit_out
from ..tz import LocalTimeError, ensure_aware_utc, iso

router = APIRouter(tags=["appointments"])

TAKEN = "Sorry, that slot was just taken by someone else. Please pick another time."
ALLOWED_UPLOADS = {"application/pdf", "image/png", "image/jpeg", "image/webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_FILES_PER_APPOINTMENT = 10


def _utc(value: datetime) -> datetime:
    try:
        return ensure_aware_utc(value)
    except LocalTimeError as e:
        raise HTTPException(400, str(e))


def _own_appointment(db: Session, appt_id: int, user: User) -> Appointment:
    """Load an appointment the caller is a party to. Never reveals other people's data."""
    appt = db.get(Appointment, appt_id)
    if appt is None:
        raise HTTPException(404, "Appointment not found.")
    if user.role == "hospital":
        if user.hospital_id is None or appt.hospital_id != user.hospital_id:
            raise HTTPException(403, "This appointment is not at your hospital.")
        return appt
    owner = appt.patient_id if user.role == "patient" else appt.doctor_id
    if owner != user.id:
        raise HTTPException(403, "You can only view or change your own appointments.")
    return appt


def _staff(user: User = Depends(current_user)) -> User:
    """Doctors and hospital front desks can confirm, decline or cancel."""
    if user.role not in ("doctor", "hospital"):
        raise HTTPException(403, "This action is only available to doctors and hospital staff.")
    return user


def _set_fee(db: Session, appt: Appointment, doctor: User) -> None:
    appt.fee_amount, appt.fee_currency = fee_for(db, doctor, appt.hospital_id, appt.mode)


def _require_future(appt: Appointment, what: str) -> None:
    if appt.start_utc <= datetime.now(timezone.utc):
        raise HTTPException(400, f"This appointment has already started or finished, so it can't be {what}.")


def _apply_mode(appt: Appointment, mode: str, hospital_id: int | None) -> None:
    if mode == "in_person" and hospital_id is None:
        raise HTTPException(400, "That time is for online consultations only. Choose “Online video” or another slot.")
    appt.mode = mode
    appt.hospital_id = hospital_id
    if mode == "online" and not appt.meeting_url:
        appt.meeting_url = f"https://meet.jit.si/SlotZero-{secrets.token_hex(8)}"


@router.post("/appointments", status_code=201)
def request_appointment(
    body: BookIn,
    response: Response,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=80),
    patient: User = Depends(require_role("patient")),
    db: Session = Depends(get_db),
):
    """Patient requests a slot. The slot is held immediately; the doctor confirms it."""
    start = _utc(body.start_utc)
    doctor = db.get(User, body.doctor_id)
    if doctor is None or doctor.role != "doctor":
        raise HTTPException(404, "Doctor not found.")

    def replay(existing: Appointment):
        response.status_code = 200
        return {**appointment_out(db, existing, patient), "replayed": True}

    if idempotency_key:
        existing = db.scalar(
            select(Appointment).where(
                Appointment.patient_id == patient.id, Appointment.idempotency_key == idempotency_key
            )
        )
        if existing:
            return replay(existing)

    try:
        with doctor_lock(db, doctor.id):
            dup = db.scalar(
                select(Appointment).where(
                    Appointment.patient_id == patient.id,
                    Appointment.doctor_id == doctor.id,
                    Appointment.start_utc == start,
                    Appointment.status.in_(HELD_STATUSES),
                )
            )
            if dup:
                db.rollback()
                return replay(dup)
            end, hospital_id, error = check_bookable(db, doctor, start)
            if error:
                db.rollback()
                raise HTTPException(409, error)
            appt = Appointment(
                doctor_id=doctor.id,
                patient_id=patient.id,
                start_utc=start,
                end_utc=end,
                status="pending",
                reason=body.reason.strip(),
                idempotency_key=idempotency_key,
            )
            try:
                _apply_mode(appt, body.mode, hospital_id)
            except HTTPException:
                db.rollback()
                raise
            _set_fee(db, appt, doctor)
            db.add(appt)
            db.flush()
            audit(db, patient, "requested", appt, start_utc=iso(start), mode=body.mode)
            db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, TAKEN)
    db.refresh(appt)
    return appointment_out(db, appt, patient)


@router.get("/appointments/mine")
def my_appointments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "hospital":
        cond = Appointment.hospital_id == user.hospital_id
    else:
        cond = (Appointment.patient_id if user.role == "patient" else Appointment.doctor_id) == user.id
    rows = db.scalars(select(Appointment).where(cond).order_by(Appointment.start_utc)).all()
    return [appointment_out(db, a, user) for a in rows]


@router.get("/appointments/{appt_id}")
def get_appointment(appt_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return appointment_out(db, _own_appointment(db, appt_id, user), user)


# ------------------------------------------------------------- doctor actions

@router.post("/appointments/{appt_id}/confirm")
def confirm(appt_id: int, doc: User = Depends(_staff), db: Session = Depends(get_db)):
    appt = _own_appointment(db, appt_id, doc)
    _require_future(appt, "confirmed")
    if appt.status != "pending":
        raise HTTPException(409, f"Only pending requests can be confirmed (this one is {appt.status}).")
    appt.status = "confirmed"
    audit(db, doc, "confirmed", appt, start_utc=iso(appt.start_utc))
    db.commit()
    return appointment_out(db, appt, doc)


@router.post("/appointments/{appt_id}/decline")
def decline(appt_id: int, body: CancelIn | None = None, doc: User = Depends(_staff), db: Session = Depends(get_db)):
    appt = _own_appointment(db, appt_id, doc)
    if appt.status not in ("pending", "proposed"):
        raise HTTPException(409, "Only open requests can be declined. Use Cancel for confirmed appointments.")
    appt.status = "declined"
    appt.cancelled_by = doc.role
    appt.cancel_reason = (body.reason.strip() if body else "") or None
    audit(db, doc, "declined", appt, start_utc=iso(appt.start_utc), reason=appt.cancel_reason)
    db.commit()
    return appointment_out(db, appt, doc)


@router.post("/appointments/{appt_id}/propose")
def propose(appt_id: int, body: ProposeIn, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    """Doctor suggests a different free time. The new slot is held; the patient accepts or declines."""
    appt = _own_appointment(db, appt_id, doc)
    _require_future(appt, "moved")
    if appt.status not in ("pending", "confirmed"):
        raise HTTPException(409, f"You can't propose a new time for a {appt.status} appointment.")
    new_start = _utc(body.start_utc)
    if new_start == appt.start_utc:
        raise HTTPException(400, "Pick a different time from the current one.")
    old_start = appt.start_utc
    try:
        with doctor_lock(db, doc.id):
            end, hospital_id, error = check_bookable(db, doc, new_start, exclude_id=appt.id)
            if error:
                db.rollback()
                raise HTTPException(409, f"{error} Nothing was changed.")
            appt.start_utc, appt.end_utc = new_start, end
            # A proposal to an online-only slot turns an in-person visit into a video consult.
            _apply_mode(appt, "online" if hospital_id is None else appt.mode, hospital_id)
            _set_fee(db, appt, doc)
            appt.status = "proposed"
            appt.doctor_note = body.message.strip() or None
            audit(db, doc, "proposed", appt, from_utc=iso(old_start), to_utc=iso(new_start), message=appt.doctor_note)
            db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, TAKEN)
    return appointment_out(db, appt, doc)


# ------------------------------------------------------------ patient actions

@router.post("/appointments/{appt_id}/accept")
def accept_proposal(appt_id: int, patient: User = Depends(require_role("patient")), db: Session = Depends(get_db)):
    appt = _own_appointment(db, appt_id, patient)
    _require_future(appt, "accepted")
    if appt.status != "proposed":
        raise HTTPException(409, "There is no proposed time to accept on this appointment.")
    appt.status = "confirmed"
    audit(db, patient, "accepted", appt, start_utc=iso(appt.start_utc))
    db.commit()
    return appointment_out(db, appt, patient)


@router.post("/appointments/{appt_id}/cancel")
def cancel(appt_id: int, body: CancelIn | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    appt = _own_appointment(db, appt_id, user)
    now = datetime.now(timezone.utc)
    if appt.status not in HELD_STATUSES:
        raise HTTPException(409, f"This appointment is already {appt.status}.")
    _require_future(appt, "cancelled")
    if user.role == "patient" and appt.status == "confirmed" and appt.start_utc - now < CANCEL_CUTOFF:
        raise HTTPException(
            400,
            "Confirmed appointments can only be cancelled up to 2 hours before they start. "
            "Please contact the clinic directly.",
        )
    appt.status = "cancelled"
    appt.cancelled_by = user.role
    appt.cancel_reason = (body.reason.strip() if body else "") or None
    audit(db, user, "cancelled", appt, start_utc=iso(appt.start_utc), reason=appt.cancel_reason)
    db.commit()
    return appointment_out(db, appt, user)


@router.post("/appointments/{appt_id}/reschedule")
def reschedule(
    appt_id: int,
    body: RescheduleIn,
    patient: User = Depends(require_role("patient")),
    db: Session = Depends(get_db),
):
    """Move to a new slot. It goes back to the doctor as a request; on failure nothing changes."""
    appt = _own_appointment(db, appt_id, patient)
    new_start = _utc(body.start_utc)
    now = datetime.now(timezone.utc)
    if appt.status not in HELD_STATUSES:
        raise HTTPException(409, "Only active appointments can be rescheduled.")
    if appt.start_utc - now < CANCEL_CUTOFF:
        raise HTTPException(400, "Appointments can only be rescheduled up to 2 hours before they start.")
    if new_start == appt.start_utc:
        raise HTTPException(400, "That is already the time of this appointment.")

    old_start = appt.start_utc
    try:
        with doctor_lock(db, appt.doctor_id):
            # Validate the new slot BEFORE anything changes; any failure rolls back.
            end, hospital_id, error = check_bookable(db, appt.doctor, new_start, exclude_id=appt.id)
            if error:
                db.rollback()
                raise HTTPException(409, f"{error} Your original appointment is unchanged.")
            try:
                _apply_mode(appt, body.mode or appt.mode, hospital_id)
            except HTTPException as e:
                db.rollback()
                raise HTTPException(e.status_code, f"{e.detail} Your original appointment is unchanged.")
            appt.start_utc, appt.end_utc = new_start, end
            _set_fee(db, appt, appt.doctor)
            appt.status = "pending"
            appt.doctor_note = None
            audit(db, patient, "rescheduled", appt, from_utc=iso(old_start), to_utc=iso(new_start))
            db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That slot was just taken. Your original appointment is unchanged.")
    return appointment_out(db, appt, patient)


# ---------------------------------------------------------------- attachments

@router.post("/appointments/{appt_id}/attachments", status_code=201)
def upload_attachment(
    appt_id: int,
    file: UploadFile = File(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Share a past report or prescription (PDF or image) with the other party."""
    if user.role == "hospital":
        raise HTTPException(403, "Medical documents are shared only between the patient and the doctor.")
    appt = _own_appointment(db, appt_id, user)
    if appt.status in ("cancelled", "declined"):
        raise HTTPException(400, "You can't add files to a cancelled or declined appointment.")
    if file.content_type not in ALLOWED_UPLOADS:
        raise HTTPException(400, "Only PDF, PNG, JPG or WEBP files can be shared.")
    if len(appt.attachments) >= MAX_FILES_PER_APPOINTMENT:
        raise HTTPException(400, f"An appointment can have at most {MAX_FILES_PER_APPOINTMENT} files.")
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Files must be 5 MB or smaller.")
    if not data:
        raise HTTPException(400, "That file is empty.")
    att = Attachment(
        appointment_id=appt.id,
        uploader_id=user.id,
        filename=(file.filename or "document")[-200:],
        content_type=file.content_type,
        size=len(data),
        data=data,
    )
    db.add(att)
    db.flush()
    audit(db, user, "shared_file", appt, filename=att.filename)
    db.commit()
    db.refresh(att)
    return attachment_out(att)


@router.get("/attachments/{att_id}")
def download_attachment(att_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    att = db.scalar(select(Attachment).options(undefer(Attachment.data)).where(Attachment.id == att_id))
    if att is None:
        raise HTTPException(404, "File not found.")
    if user.role == "hospital":
        raise HTTPException(403, "Medical documents are shared only between the patient and the doctor.")
    _own_appointment(db, att.appointment_id, user)
    return Response(
        content=att.data,
        media_type=att.content_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(att.filename)}"},
    )


@router.get("/audit/mine")
def my_audit(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "hospital":
        cond = or_(AuditLog.hospital_id == user.hospital_id, AuditLog.actor_id == user.id)
    else:
        col = AuditLog.patient_id if user.role == "patient" else AuditLog.doctor_id
        cond = or_(col == user.id, AuditLog.actor_id == user.id)
    rows = db.scalars(select(AuditLog).where(cond).order_by(AuditLog.id.desc()).limit(100)).all()
    return [audit_out(r) for r in rows]
