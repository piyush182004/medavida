from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import Appointment, Attachment, AuditLog, BlockedPeriod, Hospital, Prescription, User
from .scheduling import CANCEL_CUTOFF, HELD_STATUSES, busy_intervals, within_working_hours
from .tz import iso


def user_out(u: User) -> dict:
    out = {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "timezone": u.timezone}
    if u.role == "doctor" and u.doctor_profile:
        out["specialization"] = u.doctor_profile.specialization
        out["slot_minutes"] = u.doctor_profile.slot_minutes
    if u.role == "hospital" and u.hospital:
        out["hospital"] = hospital_out(u.hospital)
    return out


def hospital_out(h: Hospital | None) -> dict | None:
    if h is None:
        return None
    return {
        "id": h.id, "name": h.name, "city": h.city, "address": h.address,
        "phone": h.phone, "timezone": h.timezone, "currency": h.currency,
    }


def attachment_out(a: Attachment) -> dict:
    return {
        "id": a.id,
        "filename": a.filename,
        "content_type": a.content_type,
        "size": a.size,
        "uploaded_by": {"name": a.uploader.name, "role": a.uploader.role},
        "created_at": iso(a.created_at),
    }


def attachment_out_for(a: Attachment, viewer: User) -> dict:
    out = attachment_out(a)
    out["ai_summary"] = a.ai_summary_doctor if viewer.role == "doctor" else a.ai_summary_patient
    return out


def appointment_out(db: Session, a: Appointment, viewer: User) -> dict:
    now = datetime.now(timezone.utc)
    future = a.start_utc > now
    held = a.status in HELD_STATUSES
    out = {
        "id": a.id,
        "start_utc": iso(a.start_utc),
        "end_utc": iso(a.end_utc),
        "status": a.status,
        "mode": a.mode,
        # The video room is only revealed once the doctor has confirmed.
        "meeting_url": a.meeting_url if a.status == "confirmed" and a.mode == "online" else None,
        "reason": a.reason,
        "doctor_note": a.doctor_note,
        "cancelled_by": a.cancelled_by,
        "cancel_reason": a.cancel_reason,
        "created_at": iso(a.created_at),
        "hospital": hospital_out(a.hospital),
        "fee": {"amount": a.fee_amount, "currency": a.fee_currency} if a.fee_amount is not None else None,
        "attachments": [attachment_out_for(x, viewer) for x in a.attachments],
        "ai_brief": a.ai_brief if viewer.role == "doctor" else None,
        "doctor": {
            "id": a.doctor.id,
            "name": a.doctor.name,
            "timezone": a.doctor.timezone,
            "specialization": a.doctor.doctor_profile.specialization if a.doctor.doctor_profile else "",
        },
        "patient": {"id": a.patient.id, "name": a.patient.name, "timezone": a.patient.timezone},
    }
    if viewer.role == "patient":
        outside_cutoff = a.start_utc - now >= CANCEL_CUTOFF
        out["can_cancel"] = held and future and (a.status != "confirmed" or outside_cutoff)
        out["can_reschedule"] = held and future and outside_cutoff
        out["can_accept"] = a.status == "proposed" and future
    elif viewer.role == "hospital":
        # Front desk sees who/when/where, never the patient's medical note or files.
        out["patient"]["email"] = a.patient.email
        out["reason"] = ""
        out["attachments"] = []
        out["attachment_count"] = len(a.attachments)
        out["can_confirm"] = a.status == "pending" and future
        out["can_decline"] = a.status in ("pending", "proposed") and future
        out["can_propose"] = False
        out["can_cancel"] = a.status == "confirmed" and future
        out["warnings"] = []
    else:
        out["patient"]["email"] = a.patient.email
        out["can_confirm"] = a.status == "pending" and future
        out["can_decline"] = a.status in ("pending", "proposed") and future
        out["can_propose"] = a.status in ("pending", "confirmed") and future
        out["can_cancel"] = a.status == "confirmed" and future
        warnings = []
        if held and future:
            blocks, _ = busy_intervals(db, a.doctor_id, a.start_utc, a.end_utc)
            if blocks:
                warnings.append("Overlaps a blocked period — still booked. Cancel or contact the patient.")
            if not within_working_hours(db, a.doctor, a.start_utc, a.end_utc):
                warnings.append("Now outside your working hours — still booked.")
        out["warnings"] = warnings
    return out


def block_out(b: BlockedPeriod) -> dict:
    return {"id": b.id, "start_utc": iso(b.start_utc), "end_utc": iso(b.end_utc), "reason": b.reason}


def prescription_out(p: Prescription) -> dict:
    return {
        "id": p.id,
        "appointment_id": p.appointment_id,
        "items": p.items,
        "notes": p.notes,
        "has_file": bool(p.file_name),
        "file_name": p.file_name,
        "created_at": iso(p.created_at),
        "doctor": {"id": p.doctor.id, "name": p.doctor.name},
        "patient": {"id": p.patient.id, "name": p.patient.name, "timezone": p.patient.timezone},
    }


def audit(db: Session, actor: User, action: str, appt: Appointment | None = None, **details) -> None:
    db.add(
        AuditLog(
            actor_id=actor.id,
            actor_role=actor.role,
            action=action,
            appointment_id=appt.id if appt else None,
            doctor_id=appt.doctor_id if appt else details.pop("doctor_id", None),
            patient_id=appt.patient_id if appt else details.pop("patient_id", None),
            hospital_id=appt.hospital_id if appt else details.pop("hospital_id", None),
            details=details,
        )
    )


def audit_out(log: AuditLog) -> dict:
    return {
        "id": log.id,
        "action": log.action,
        "actor": {"name": log.actor.name, "role": log.actor_role},
        "appointment_id": log.appointment_id,
        "details": log.details,
        "created_at": iso(log.created_at),
    }
