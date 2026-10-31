from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user, require_role
from ..db import get_db
from ..models import Appointment, Prescription, User
from ..schemas import PrescriptionIn
from ..serializers import audit, prescription_out

router = APIRouter(prefix="/prescriptions", tags=["prescriptions"])


@router.post("", status_code=201)
def create_prescription(body: PrescriptionIn, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    appt = db.get(Appointment, body.appointment_id)
    if appt is None:
        raise HTTPException(404, "Appointment not found.")
    if appt.doctor_id != doc.id:
        raise HTTPException(403, "You can only prescribe for your own patients.")
    rx = Prescription(
        doctor_id=doc.id,
        patient_id=appt.patient_id,
        appointment_id=appt.id,
        items=[i.model_dump() for i in body.items],
        notes=body.notes.strip(),
    )
    db.add(rx)
    db.flush()
    audit(db, doc, "prescribed", appt, prescription_id=rx.id, medicines=[i.name for i in body.items])
    db.commit()
    db.refresh(rx)
    return prescription_out(rx)


@router.get("/mine")
def my_prescriptions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    col = Prescription.patient_id if user.role == "patient" else Prescription.doctor_id
    rows = db.scalars(select(Prescription).where(col == user.id).order_by(Prescription.id.desc())).all()
    return [prescription_out(p) for p in rows]
