"""Hospital administrator workspace: doctors, fees, schedules at this hospital, and analytics.

Every endpoint is scoped to the admin's own hospital on the server.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..auth import require_role
from ..db import get_db
from ..models import Appointment, Hospital, HospitalDoctor, User, WorkingHours
from ..schemas import AffiliateIn, FeeIn, HospitalHoursIn, HospitalProfileIn
from ..scheduling import HELD_STATUSES, parse_hhmm, ranges_error, within_working_hours
from ..serializers import appointment_out, hospital_out
from ..tz import LocalTimeError, zone

router = APIRouter(prefix="/hospital", tags=["hospital"])


def _my_hospital(user: User) -> Hospital:
    if user.hospital is None:
        raise HTTPException(400, "This account isn't linked to a hospital.")
    return user.hospital


def _affiliation(db: Session, hospital_id: int, doctor_id: int) -> HospitalDoctor:
    aff = db.scalar(
        select(HospitalDoctor).where(HospitalDoctor.hospital_id == hospital_id, HospitalDoctor.doctor_id == doctor_id)
    )
    if aff is None:
        raise HTTPException(404, "That doctor isn't on your hospital's roster.")
    return aff


def _hours_here(db: Session, doctor_id: int, hospital_id: int) -> list[dict]:
    rows = db.scalars(
        select(WorkingHours)
        .where(WorkingHours.doctor_id == doctor_id, WorkingHours.hospital_id == hospital_id)
        .order_by(WorkingHours.weekday, WorkingHours.start_local)
    ).all()
    return [{"weekday": r.weekday, "start": r.start_local, "end": r.end_local} for r in rows]


def _other_hours(db: Session, doctor_id: int, hospital_id: int) -> list[dict]:
    """The doctor's commitments elsewhere, so the admin can see why a time is unavailable."""
    names = {h.id: h.name for h in db.scalars(select(Hospital)).all()}
    rows = db.scalars(
        select(WorkingHours)
        .where(WorkingHours.doctor_id == doctor_id, (WorkingHours.hospital_id != hospital_id) | WorkingHours.hospital_id.is_(None))
        .order_by(WorkingHours.weekday, WorkingHours.start_local)
    ).all()
    return [
        {"weekday": r.weekday, "start": r.start_local, "end": r.end_local,
         "where": names.get(r.hospital_id, "Online") if r.hospital_id else "Online"}
        for r in rows
    ]


@router.get("/me")
def me(admin: User = Depends(require_role("hospital"))):
    return hospital_out(_my_hospital(admin))


@router.put("/me")
def update_me(body: HospitalProfileIn, admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    h = _my_hospital(admin)
    h.name, h.city, h.address, h.phone = body.name.strip(), body.city.strip(), body.address.strip(), body.phone.strip()
    db.commit()
    return hospital_out(h)


@router.get("/doctors")
def roster(admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    h = _my_hospital(admin)
    rows = db.scalars(select(HospitalDoctor).where(HospitalDoctor.hospital_id == h.id)).all()
    out = []
    for aff in sorted(rows, key=lambda a: a.doctor.name):
        d = aff.doctor
        out.append({
            "id": d.id,
            "name": d.name,
            "email": d.email,
            "specialization": d.doctor_profile.specialization,
            "timezone": d.timezone,
            "slot_minutes": d.doctor_profile.slot_minutes,
            "fee": aff.fee,
            "currency": h.currency,
            "hours": _hours_here(db, d.id, h.id),
            "other_hours": _other_hours(db, d.id, h.id),
        })
    return out


@router.post("/doctors", status_code=201)
def add_doctor(body: AffiliateIn, admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    h = _my_hospital(admin)
    doc = db.get(User, body.doctor_id)
    if doc is None or doc.role != "doctor":
        raise HTTPException(404, "Doctor not found.")
    aff = db.scalar(select(HospitalDoctor).where(HospitalDoctor.hospital_id == h.id, HospitalDoctor.doctor_id == doc.id))
    if aff:
        raise HTTPException(409, f"Dr. {doc.name} is already on your roster.")
    db.add(HospitalDoctor(hospital_id=h.id, doctor_id=doc.id, fee=body.fee))
    db.commit()
    return {"ok": True}


@router.patch("/doctors/{doctor_id}")
def set_fee(doctor_id: int, body: FeeIn, admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    h = _my_hospital(admin)
    aff = _affiliation(db, h.id, doctor_id)
    aff.fee = body.fee
    db.commit()
    return {"ok": True, "fee": aff.fee, "currency": h.currency}


@router.delete("/doctors/{doctor_id}")
def remove_doctor(doctor_id: int, admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    h = _my_hospital(admin)
    aff = _affiliation(db, h.id, doctor_id)
    now = datetime.now(timezone.utc)
    upcoming = db.scalars(
        select(Appointment).where(
            Appointment.hospital_id == h.id, Appointment.doctor_id == doctor_id,
            Appointment.status.in_(HELD_STATUSES), Appointment.start_utc > now,
        )
    ).all()
    db.execute(delete(WorkingHours).where(WorkingHours.doctor_id == doctor_id, WorkingHours.hospital_id == h.id))
    db.delete(aff)
    db.commit()
    # Bookings are never silently dropped; the admin is told how many remain.
    return {"ok": True, "upcoming_kept": len(upcoming)}


@router.put("/doctors/{doctor_id}/hours")
def set_hours(doctor_id: int, body: HospitalHoursIn, admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    """Replace this doctor's weekly hours AT THIS HOSPITAL. Their other commitments are kept and
    the combined week is validated, so a doctor is never scheduled in two places at once."""
    h = _my_hospital(admin)
    _affiliation(db, h.id, doctor_id)
    doc = db.get(User, doctor_id)
    names = {x.id: x.name for x in db.scalars(select(Hospital)).all()}
    try:
        mine = [(r.weekday, parse_hhmm(r.start), parse_hhmm(r.end), h.id) for r in body.hours]
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    others = [
        (r.weekday, parse_hhmm(r.start_local), parse_hhmm(r.end_local), r.hospital_id)
        for r in db.scalars(select(WorkingHours).where(WorkingHours.doctor_id == doctor_id)).all()
        if r.hospital_id != h.id
    ]
    error = ranges_error(others + mine, doc.doctor_profile.slot_minutes, names)
    if error:
        raise HTTPException(400, error)
    db.execute(delete(WorkingHours).where(WorkingHours.doctor_id == doctor_id, WorkingHours.hospital_id == h.id))
    for wd, s, e, _ in mine:
        db.add(WorkingHours(doctor_id=doctor_id, weekday=wd, start_local=f"{s:%H:%M}", end_local=f"{e:%H:%M}", hospital_id=h.id))
    db.commit()
    now = datetime.now(timezone.utc)
    upcoming = db.scalars(
        select(Appointment).where(
            Appointment.hospital_id == h.id, Appointment.doctor_id == doctor_id,
            Appointment.status.in_(HELD_STATUSES), Appointment.start_utc > now,
        )
    ).all()
    affected = [appointment_out(db, a, admin) for a in upcoming if not within_working_hours(db, doc, a.start_utc, a.end_utc)]
    return {"hours": _hours_here(db, doctor_id, h.id), "affected_appointments": affected}


@router.get("/stats")
def stats(admin: User = Depends(require_role("hospital")), db: Session = Depends(get_db)):
    """Appointment volume and revenue per doctor. Revenue uses the fee saved on each booking."""
    h = _my_hospital(admin)
    tz = zone(h.timezone)
    now = datetime.now(timezone.utc)
    appts = db.scalars(select(Appointment).where(Appointment.hospital_id == h.id)).all()
    roster_ids = set(db.scalars(select(HospitalDoctor.doctor_id).where(HospitalDoctor.hospital_id == h.id)).all())

    def blank():
        return {"upcoming": 0, "requests": 0, "completed": 0, "cancelled": 0,
                "revenue_earned": 0, "revenue_booked": 0, "revenue_pipeline": 0}

    per: dict[int, dict] = defaultdict(blank)
    totals = blank()
    today = now.astimezone(tz).date()
    next7 = {(today + timedelta(days=i)).isoformat(): 0 for i in range(7)}
    month_start = today.replace(day=1)
    revenue_month = 0
    for a in appts:
        fee = (a.fee_amount or 0) if a.fee_currency in (None, h.currency) else 0
        future = a.start_utc > now
        row = per[a.doctor_id]
        if a.status in ("cancelled", "declined"):
            key = "cancelled"
        elif a.status == "confirmed" and not future:
            key, money = "completed", "revenue_earned"
            row[money] += fee
            totals[money] += fee
            if a.start_utc.astimezone(tz).date() >= month_start:
                revenue_month += fee
        elif a.status == "confirmed":
            key, money = "upcoming", "revenue_booked"
            row[money] += fee
            totals[money] += fee
        elif future:
            key = "requests"
            row["revenue_pipeline"] += fee
            totals["revenue_pipeline"] += fee
        else:
            continue  # an expired request
        row[key] += 1
        totals[key] += 1
        if future and a.status in HELD_STATUSES:
            k = a.start_utc.astimezone(tz).date().isoformat()
            if k in next7:
                next7[k] += 1

    doctors = {d.id: d for d in db.scalars(select(User).where(User.id.in_(roster_ids | set(per)))).all()}
    by_doctor = [
        {"doctor_id": did, "name": doctors[did].name, "specialization": doctors[did].doctor_profile.specialization,
         "on_roster": did in roster_ids, **per.get(did, blank())}
        for did in sorted(doctors, key=lambda i: doctors[i].name)
    ]
    return {
        "currency": h.currency,
        "timezone": h.timezone,
        "totals": {**totals, "doctors": len(roster_ids), "revenue_month": revenue_month},
        "by_doctor": by_doctor,
        "next_7_days": [{"date": k, "count": v} for k, v in next7.items()],
    }
