"""Doctor directory (any logged-in user) and doctor self-service (doctors only)."""

from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..auth import current_user, require_role
from ..db import get_db
from ..models import Appointment, BlockedPeriod, Hospital, HospitalDoctor, User, WorkingHours
from ..schemas import BlockIn, HospitalIn, ScheduleIn
from ..scheduling import HELD_STATUSES, WEEKDAYS, ZONE_CURRENCY, available_slots, ensure_affiliation, parse_hhmm, ranges_error, within_working_hours
from ..serializers import appointment_out, block_out, hospital_out
from ..tz import LocalTimeError, iso, to_utc, zone

router = APIRouter(tags=["doctors"])



def _get_doctor(db: Session, doctor_id: int) -> User:
    doc = db.get(User, doctor_id)
    if doc is None or doc.role != "doctor":
        raise HTTPException(404, "Doctor not found.")
    return doc


def _local_day_bounds(day: date, tz_name: str) -> tuple[datetime, datetime]:
    tz = zone(tz_name)
    start = datetime.combine(day, time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    return start, end


def _hours_summary(db: Session, doctor_id: int) -> list[dict]:
    rows = db.scalars(
        select(WorkingHours)
        .where(WorkingHours.doctor_id == doctor_id)
        .order_by(WorkingHours.weekday, WorkingHours.start_local)
    ).all()
    names = _hospital_names(db)
    return [
        {"weekday": r.weekday, "start": r.start_local, "end": r.end_local,
         "hospital_id": r.hospital_id, "hospital_name": names.get(r.hospital_id) if r.hospital_id else None}
        for r in rows
    ]


def _hospital_names(db: Session) -> dict[int, str]:
    return {h.id: h.name for h in db.scalars(select(Hospital)).all()}


def _doctor_hospitals(db: Session, doctor_id: int) -> list[dict]:
    rows = db.scalars(
        select(Hospital)
        .join(WorkingHours, WorkingHours.hospital_id == Hospital.id)
        .where(WorkingHours.doctor_id == doctor_id)
        .distinct()
        .order_by(Hospital.name)
    ).all()
    return [hospital_out(h) for h in rows]


def _fees(db: Session, doc: User) -> dict:
    p = doc.doctor_profile
    rows = db.execute(
        select(HospitalDoctor, Hospital)
        .join(Hospital, Hospital.id == HospitalDoctor.hospital_id)
        .where(HospitalDoctor.doctor_id == doc.id)
        .order_by(Hospital.name)
    ).all()
    return {
        "online": {"amount": p.online_fee, "currency": p.currency},
        "hospitals": [
            {"hospital_id": h.id, "name": h.name, "amount": a.fee, "currency": h.currency} for a, h in rows
        ],
    }


def _doctor_card(db: Session, doc: User, next_slot: datetime | None) -> dict:
    p = doc.doctor_profile
    return {
        "fees": _fees(db, doc),
        "id": doc.id,
        "name": doc.name,
        "specialization": p.specialization,
        "bio": p.bio,
        "timezone": doc.timezone,
        "slot_minutes": p.slot_minutes,
        "hours": _hours_summary(db, doc.id),
        "hospitals": _doctor_hospitals(db, doc.id),
        "next_available_utc": iso(next_slot),
    }


@router.get("/doctors")
def list_doctors(
    q: str = "",
    specialization: str = "",
    available_on: date | None = Query(None, description="YYYY-MM-DD in the viewer's zone"),
    hospital_id: int | None = None,
    tz: str = "Europe/London",
    db: Session = Depends(get_db),
    _: User = Depends(current_user),
):
    try:
        zone(tz)
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    now = datetime.now(timezone.utc)
    docs = db.scalars(select(User).where(User.role == "doctor").order_by(User.name)).all()
    out = []
    for d in docs:
        if q and q.lower() not in d.name.lower():
            continue
        if specialization and specialization.lower() != d.doctor_profile.specialization.lower():
            continue
        if hospital_id and not db.scalar(
            select(WorkingHours.id).where(WorkingHours.doctor_id == d.id, WorkingHours.hospital_id == hospital_id).limit(1)
        ):
            continue
        if available_on:
            frm, to = _local_day_bounds(available_on, tz)
            if not available_slots(db, d, frm, to, now):
                continue
        upcoming = available_slots(db, d, now, now + timedelta(days=14), now)
        out.append(_doctor_card(db, d, upcoming[0][0] if upcoming else None))
    return out


@router.get("/doctors/specializations")
def specializations(db: Session = Depends(get_db), _: User = Depends(current_user)):
    docs = db.scalars(select(User).where(User.role == "doctor")).all()
    return sorted({d.doctor_profile.specialization for d in docs})


@router.get("/doctors/{doctor_id}/slots")
def doctor_slots(
    doctor_id: int,
    day: date = Query(..., alias="date", description="YYYY-MM-DD in the viewer's zone"),
    tz: str = "Europe/London",
    exclude: int | None = Query(None, description="Appointment id to ignore (when moving it)"),
    db: Session = Depends(get_db),
    viewer: User = Depends(current_user),
):
    doc = _get_doctor(db, doctor_id)
    try:
        frm, to = _local_day_bounds(day, tz)
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    now = datetime.now(timezone.utc)
    if to <= now:
        raise HTTPException(400, "That date is in the past. Please choose today or a later date.")
    if frm - now > timedelta(days=90):
        raise HTTPException(400, "You can book up to 90 days ahead.")
    if exclude is not None:
        appt = db.get(Appointment, exclude)
        owns = appt is not None and viewer.id in (appt.patient_id, appt.doctor_id) and appt.doctor_id == doc.id
        exclude = exclude if owns else None
    slots = available_slots(db, doc, frm, to, now, exclude_id=exclude)
    names = _hospital_names(db)
    return {
        "doctor": _doctor_card(db, doc, slots[0][0] if slots else None),
        "date": day.isoformat(),
        "viewer_timezone": tz,
        "slots": [
            {"start_utc": iso(s), "end_utc": iso(e),
             "hospital": {"id": h, "name": names.get(h, "")} if h else None}
            for s, e, h in slots
        ],
    }


# ---------------------------------------------------------------- doctor only

@router.get("/doctor/schedule")
def get_schedule(doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    p = doc.doctor_profile
    return {
        "slot_minutes": p.slot_minutes,
        "specialization": p.specialization,
        "bio": p.bio,
        "timezone": doc.timezone,
        "online_fee": p.online_fee,
        "currency": p.currency,
        "fees": _fees(db, doc),
        "hours": _hours_summary(db, doc.id),
    }


@router.put("/doctor/schedule")
def put_schedule(body: ScheduleIn, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    known = _hospital_names(db)
    ranges: list[tuple[int, time, time, int | None]] = []
    try:
        for r in body.hours:
            if r.hospital_id is not None and r.hospital_id not in known:
                raise LocalTimeError(f"{WEEKDAYS[r.weekday]}: unknown hospital. Add it under Hospitals & clinics first.")
            ranges.append((r.weekday, parse_hhmm(r.start), parse_hhmm(r.end), r.hospital_id))
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    error = ranges_error(ranges, body.slot_minutes, known)
    if error:
        raise HTTPException(400, error)

    p = doc.doctor_profile
    p.slot_minutes = body.slot_minutes
    p.specialization = body.specialization.strip()
    p.bio = body.bio.strip()
    if body.online_fee is not None:
        p.online_fee = body.online_fee
    db.execute(delete(WorkingHours).where(WorkingHours.doctor_id == doc.id))
    for wd, st, en, h in ranges:
        db.add(WorkingHours(doctor_id=doc.id, weekday=wd, start_local=f"{st:%H:%M}", end_local=f"{en:%H:%M}", hospital_id=h))
        if h is not None:
            ensure_affiliation(db, doc, h)
    db.commit()

    # Existing bookings are never dropped; report the ones now outside hours.
    now = datetime.now(timezone.utc)
    upcoming = db.scalars(
        select(Appointment).where(
            Appointment.doctor_id == doc.id, Appointment.status.in_(HELD_STATUSES), Appointment.start_utc > now
        )
    ).all()
    affected = [appointment_out(db, a, doc) for a in upcoming if not within_working_hours(db, doc, a.start_utc, a.end_utc)]
    return {**get_schedule(doc, db), "affected_appointments": affected}


@router.get("/doctor/blocks")
def list_blocks(doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        select(BlockedPeriod)
        .where(BlockedPeriod.doctor_id == doc.id, BlockedPeriod.end_utc > now)
        .order_by(BlockedPeriod.start_utc)
    ).all()
    return [block_out(b) for b in rows]


@router.post("/doctor/blocks", status_code=201)
def add_block(body: BlockIn, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    try:
        start = to_utc(body.start_local.replace(tzinfo=None), doc.timezone, prefer="earlier")
        end = to_utc(body.end_local.replace(tzinfo=None), doc.timezone, prefer="later")
    except LocalTimeError as e:
        raise HTTPException(400, str(e))
    if end <= start:
        raise HTTPException(400, "The block must end after it starts.")
    if end <= datetime.now(timezone.utc):
        raise HTTPException(400, "That period is already in the past.")
    if end - start > timedelta(days=60):
        raise HTTPException(400, "A single block can be at most 60 days long.")
    block = BlockedPeriod(doctor_id=doc.id, start_utc=start, end_utc=end, reason=body.reason.strip())
    db.add(block)
    db.commit()
    clashing = db.scalars(
        select(Appointment).where(
            Appointment.doctor_id == doc.id,
            Appointment.status.in_(HELD_STATUSES),
            Appointment.start_utc < end,
            Appointment.end_utc > start,
        )
    ).all()
    return {"block": block_out(block), "affected_appointments": [appointment_out(db, a, doc) for a in clashing]}


@router.delete("/doctor/blocks/{block_id}")
def remove_block(block_id: int, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    block = db.get(BlockedPeriod, block_id)
    if block is None or block.doctor_id != doc.id:
        raise HTTPException(404, "Blocked period not found.")
    db.delete(block)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ hospitals

@router.get("/hospitals")
def list_hospitals(db: Session = Depends(get_db), _: User = Depends(current_user)):
    counts = dict(
        db.execute(
            select(WorkingHours.hospital_id, func.count(func.distinct(WorkingHours.doctor_id)))
            .where(WorkingHours.hospital_id.is_not(None))
            .group_by(WorkingHours.hospital_id)
        ).all()
    )
    rows = db.scalars(select(Hospital).order_by(Hospital.name)).all()
    return [{**hospital_out(h), "doctor_count": counts.get(h.id, 0)} for h in rows]


@router.post("/hospitals", status_code=201)
def add_hospital(body: HospitalIn, doc: User = Depends(require_role("doctor")), db: Session = Depends(get_db)):
    name, city = body.name.strip(), body.city.strip()
    existing = db.scalar(
        select(Hospital).where(func.lower(Hospital.name) == name.lower(), func.lower(Hospital.city) == city.lower())
    )
    if existing:
        return hospital_out(existing)
    h = Hospital(
        name=name, city=city, address=body.address.strip(), created_by=doc.id,
        timezone=doc.timezone, currency=ZONE_CURRENCY[doc.timezone],
    )
    db.add(h)
    db.commit()
    return hospital_out(h)
