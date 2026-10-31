"""Slot generation and conflict checks. Availability is always derived from
working hours, blocked periods and slot-holding appointments — never stored."""

import threading
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .db import IS_SQLITE
from .models import Appointment, BlockedPeriod, DoctorProfile, Hospital, HospitalDoctor, User, WorkingHours
from .tz import LocalTimeError, local_status, to_utc, zone

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
ZONE_CURRENCY = {"Asia/Kolkata": "INR", "Europe/London": "GBP", "America/New_York": "USD"}
ALLOWED_SLOT_MINUTES = (15, 30, 60)
CANCEL_CUTOFF = timedelta(hours=2)
# A request waiting for the doctor, a doctor's proposed time and a confirmed
# appointment all reserve the slot, so two patients can never hold the same time.
HELD_STATUSES = ("pending", "proposed", "confirmed")

Range = tuple[time, time, int | None]  # start, end, hospital_id (None = online only)
Slot = tuple[datetime, datetime, int | None]


def parse_hhmm(value: str) -> time:
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except (ValueError, AttributeError):
        raise LocalTimeError(f"'{value}' is not a valid time. Use HH:MM, e.g. 09:00.")


def hours_by_weekday(db: Session, doctor_id: int) -> dict[int, list[Range]]:
    rows = db.scalars(select(WorkingHours).where(WorkingHours.doctor_id == doctor_id)).all()
    out: dict[int, list[Range]] = defaultdict(list)
    for r in rows:
        out[r.weekday].append((parse_hhmm(r.start_local), parse_hhmm(r.end_local), r.hospital_id))
    for ranges in out.values():
        ranges.sort(key=lambda x: x[0])
    return out


def ranges_error(ranges: list[tuple[int, time, time, int | None]], slot_minutes: int, names: dict[int, str]) -> str | None:
    """Validate one doctor's whole week across every hospital. Returns a plain message or None.

    A doctor can't be in two places at once, so ranges on the same weekday may not
    overlap even when they belong to different hospitals.
    """
    label = lambda h: names.get(h, "hospital") if h else "online"  # noqa: E731
    by_day: dict[int, list[tuple[time, time, int | None]]] = defaultdict(list)
    for wd, s, e, h in ranges:
        if s >= e:
            return f"{WEEKDAYS[wd]}: start {s:%H:%M} must be before end {e:%H:%M}."
        if datetime.combine(date.min, e) - datetime.combine(date.min, s) < timedelta(minutes=slot_minutes):
            return f"{WEEKDAYS[wd]} {s:%H:%M}–{e:%H:%M} is shorter than one {slot_minutes}-minute appointment."
        by_day[wd].append((s, e, h))
    for wd, day in by_day.items():
        day.sort(key=lambda x: x[0])
        for (s1, e1, h1), (s2, e2, h2) in zip(day, day[1:]):
            if s2 < e1:
                return (
                    f"{WEEKDAYS[wd]}: {s1:%H:%M}–{e1:%H:%M} ({label(h1)}) overlaps "
                    f"{s2:%H:%M}–{e2:%H:%M} ({label(h2)}). A doctor can't be in two places at once."
                )
    return None


def fee_for(db: Session, doctor: User, hospital_id: int | None, mode: str) -> tuple[int, str]:
    """Online consults use the doctor's own fee; in-person visits use the hospital's fee."""
    p = doctor.doctor_profile
    if mode == "online" or hospital_id is None:
        return p.online_fee, p.currency
    hospital = db.get(Hospital, hospital_id)
    aff = db.scalar(
        select(HospitalDoctor).where(HospitalDoctor.hospital_id == hospital_id, HospitalDoctor.doctor_id == doctor.id)
    )
    return (aff.fee if aff else p.online_fee), (hospital.currency if hospital else p.currency)


def ensure_affiliation(db: Session, doctor: User, hospital_id: int) -> None:
    exists = db.scalar(
        select(HospitalDoctor.id).where(HospitalDoctor.hospital_id == hospital_id, HospitalDoctor.doctor_id == doctor.id)
    )
    if not exists:
        db.add(HospitalDoctor(hospital_id=hospital_id, doctor_id=doctor.id, fee=doctor.doctor_profile.online_fee))


def slots_for_local_date(tz_name: str, ranges: list[Range], day: date, minutes: int) -> list[Slot]:
    """Every slot that fits completely inside a working range on one local date.

    Wall-clock slots that do not exist (DST gap) are skipped; ambiguous ones
    (DST overlap) are offered once, at their first occurrence.
    """
    step = timedelta(minutes=minutes)
    slots = []
    for start_t, end_t, hospital_id in ranges:
        cur = datetime.combine(day, start_t)
        end = datetime.combine(day, end_t)
        while cur + step <= end:
            if local_status(cur, tz_name) != "nonexistent":
                s = to_utc(cur, tz_name)
                slots.append((s, s + step, hospital_id))
            cur += step
    return slots


def _overlaps(a_start, a_end, b_start, b_end) -> bool:
    # Half-open intervals: 10:00-10:30 and 10:30-11:00 do NOT overlap.
    return a_start < b_end and b_start < a_end


def busy_intervals(db: Session, doctor_id: int, frm: datetime, to: datetime, exclude_id: int | None = None):
    blocks = db.scalars(
        select(BlockedPeriod).where(
            BlockedPeriod.doctor_id == doctor_id,
            BlockedPeriod.start_utc < to,
            BlockedPeriod.end_utc > frm,
        )
    ).all()
    q = select(Appointment).where(
        Appointment.doctor_id == doctor_id,
        Appointment.status.in_(HELD_STATUSES),
        Appointment.start_utc < to,
        Appointment.end_utc > frm,
    )
    if exclude_id is not None:
        q = q.where(Appointment.id != exclude_id)
    appts = db.scalars(q).all()
    return blocks, appts


def available_slots(
    db: Session,
    doctor: User,
    frm: datetime,
    to: datetime,
    now: datetime | None = None,
    exclude_id: int | None = None,
) -> list[Slot]:
    now = now or datetime.now(timezone.utc)
    frm = max(frm, now)
    if frm >= to:
        return []
    tz = zone(doctor.timezone)
    profile = doctor.doctor_profile
    hours = hours_by_weekday(db, doctor.id)
    candidates: list[Slot] = []
    day = frm.astimezone(tz).date()
    last = to.astimezone(tz).date()
    while day <= last:
        if hours.get(day.weekday()):
            candidates += slots_for_local_date(doctor.timezone, hours[day.weekday()], day, profile.slot_minutes)
        day += timedelta(days=1)
    candidates = [c for c in candidates if frm <= c[0] < to]
    if not candidates:
        return []
    blocks, appts = busy_intervals(db, doctor.id, candidates[0][0], candidates[-1][1], exclude_id=exclude_id)
    busy = [(b.start_utc, b.end_utc) for b in blocks] + [(a.start_utc, a.end_utc) for a in appts]
    return [c for c in candidates if not any(_overlaps(c[0], c[1], b0, b1) for b0, b1 in busy)]


def check_bookable(
    db: Session, doctor: User, start: datetime, exclude_id: int | None = None
) -> tuple[datetime, int | None, str | None]:
    """Re-validate a requested start on the server. Returns (end, hospital_id, error)."""
    now = datetime.now(timezone.utc)
    minutes = doctor.doctor_profile.slot_minutes
    end = start + timedelta(minutes=minutes)
    if start <= now:
        return end, None, "That time has already passed. Please choose a future slot."
    if start - now > timedelta(days=90):
        return end, None, "Appointments can be requested up to 90 days ahead."
    local_day = start.astimezone(zone(doctor.timezone)).date()
    ranges = hours_by_weekday(db, doctor.id).get(local_day.weekday(), [])
    valid = slots_for_local_date(doctor.timezone, ranges, local_day, minutes)
    match = next((v for v in valid if v[0] == start and v[1] == end), None)
    if match is None:
        return end, None, (
            f"That time is not one of Dr. {doctor.name}'s {minutes}-minute slots. "
            "The schedule may have changed — please pick from the latest list."
        )
    blocks, appts = busy_intervals(db, doctor.id, start, end, exclude_id=exclude_id)
    if blocks:
        return end, None, f"Dr. {doctor.name} is unavailable at that time."
    if appts:
        return end, None, "Sorry, that slot was just taken by someone else. Please pick another time."
    return end, match[2], None


def within_working_hours(db: Session, doctor: User, start: datetime, end: datetime) -> bool:
    tz = zone(doctor.timezone)
    ls = start.astimezone(tz).replace(tzinfo=None)
    le = end.astimezone(tz).replace(tzinfo=None)
    for r_start, r_end, _ in hours_by_weekday(db, doctor.id).get(ls.weekday(), []):
        if datetime.combine(ls.date(), r_start) <= ls and le <= datetime.combine(ls.date(), r_end):
            return True
    return False


_process_locks: dict[int, threading.Lock] = defaultdict(threading.Lock)
_registry_lock = threading.Lock()


@contextmanager
def doctor_lock(db: Session, doctor_id: int):
    """Serialise booking changes for one doctor.

    The real guarantee is an UPDATE on the doctor's profile row inside the open
    transaction. On PostgreSQL that is a row lock held until commit, so a second
    transaction for the same doctor — from any worker or server instance — waits,
    then sees the first booking when it re-checks the slot. Other doctors are not
    blocked. On SQLite (local dev only) a process lock is added because SQLite
    has a single database-wide writer.

    Callers must commit (or roll back) before leaving the block.
    """
    def take_row_lock():
        db.execute(
            update(DoctorProfile)
            .where(DoctorProfile.user_id == doctor_id)
            .values(lock_version=DoctorProfile.lock_version + 1)
            .execution_options(synchronize_session=False)
        )

    if not IS_SQLITE:
        take_row_lock()
        yield
        return
    with _registry_lock:
        lock = _process_locks[doctor_id]
    with lock:
        take_row_lock()
        yield
