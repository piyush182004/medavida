"""Demo data for judges: accounts, fictional hospitals, fees and editable working
hours. Never appointments or slots — those are always created through the app."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import hash_password
from .models import DoctorProfile, Hospital, HospitalDoctor, User, WorkingHours
from .scheduling import ZONE_CURRENCY

DEMO_PASSWORD = "demo1234"

# key: (name, city, zone, admin email, admin name). All fictional.
HOSPITALS = {
    "citycare": ("CityCare Clinic", "London", "Europe/London", "citycare@slotzero.dev", "CityCare Front Desk"),
    "riverside": ("Riverside General Hospital", "London", "Europe/London", "riverside@slotzero.dev", "Riverside Admin"),
    "hudson": ("Hudson Heart Center", "New York", "America/New_York", "hudson@slotzero.dev", "Hudson Front Desk"),
    "eastside": ("Eastside Family Health", "New York", "America/New_York", "eastside@slotzero.dev", "Eastside Admin"),
    "lotus": ("Lotus Grove Hospital", "Kolkata", "Asia/Kolkata", "lotus@slotzero.dev", "Lotus Grove Reception"),
}

MON_FRI = range(5)


def week(*blocks):
    """blocks: (weekdays, start, end, hospital key or None for online)."""
    out: dict[int, list] = {}
    for days, s, e, h in blocks:
        for wd in days:
            out.setdefault(wd, []).append((s, e, h))
    return out


# name, email, zone, specialization, bio, slot minutes, online fee, {hospital: in-person fee}, week
DOCTORS = [
    ("Meera Shah", "meera@slotzero.dev", "Europe/London", "General Physician",
     "Family medicine and preventive care. Sees patients at two London clinics and online.",
     30, 40, {"citycare": 60, "riverside": 75},
     week(((0, 2), "09:00", "12:00", "citycare"), ((0, 2), "13:00", "17:00", "citycare"),
          ((1, 3), "09:00", "12:00", "riverside"), ((1, 3), "13:00", "17:00", None),
          ((4,), "09:00", "13:00", "citycare"))),
    ("James Whitfield", "james@slotzero.dev", "Europe/London", "Paediatrics",
     "Children's health from newborns to teens, vaccinations and development checks.",
     30, 35, {"citycare": 70, "riverside": 65},
     week(((1, 3), "09:00", "13:00", "citycare"), ((0, 2, 4), "09:00", "13:00", "riverside"),
          (MON_FRI, "14:00", "17:00", None))),
    ("Alex Carter", "alex@slotzero.dev", "America/New_York", "Cardiology",
     "Heart health, blood pressure and cholesterol management.",
     30, 120, {"hudson": 180, "eastside": 160},
     week(((0, 1, 2, 4), "09:00", "13:00", "hudson"), ((3,), "09:00", "13:00", "eastside"),
          (MON_FRI, "14:00", "17:00", None))),
    ("Sofia Ramirez", "sofia@slotzero.dev", "America/New_York", "Psychiatry",
     "Anxiety, depression and sleep. Longer 60-minute sessions, in person or by video.",
     60, 110, {"eastside": 150},
     week(((0, 1, 2, 3), "10:00", "14:00", "eastside"), (MON_FRI, "16:00", "19:00", None))),
    ("Priya Nair", "priya@slotzero.dev", "Asia/Kolkata", "Dermatology",
     "Skin, hair and nail conditions, acne and allergy care.",
     30, 600, {"lotus": 1000},
     week(((0, 1, 2, 3, 4, 5), "10:00", "13:00", "lotus"), (MON_FRI, "17:00", "20:00", None))),
]

PATIENTS = [
    ("Asha Rao", "asha@slotzero.dev", "Asia/Kolkata"),
    ("Sam Miller", "sam@slotzero.dev", "America/New_York"),
]


def seed_demo(db: Session) -> None:
    if db.scalar(select(User).limit(1)):
        return
    pw = hash_password(DEMO_PASSWORD)
    hospitals: dict[str, Hospital] = {}
    for key, (name, city, tz, email, admin) in HOSPITALS.items():
        h = Hospital(name=name, city=city, address=f"Demo address, {city}", timezone=tz, currency=ZONE_CURRENCY[tz])
        db.add(h)
        db.flush()
        hospitals[key] = h
        db.add(User(name=admin, email=email, password_hash=pw, role="hospital", timezone=tz, hospital_id=h.id))

    for name, email, tz, spec, bio, slot, online_fee, fees, plan in DOCTORS:
        u = User(name=name, email=email, password_hash=pw, role="doctor", timezone=tz)
        u.doctor_profile = DoctorProfile(
            specialization=spec, bio=bio, slot_minutes=slot, online_fee=online_fee, currency=ZONE_CURRENCY[tz]
        )
        db.add(u)
        db.flush()
        for key, fee in fees.items():
            db.add(HospitalDoctor(hospital_id=hospitals[key].id, doctor_id=u.id, fee=fee))
        for wd, ranges in plan.items():
            for s, e, h in ranges:
                db.add(WorkingHours(doctor_id=u.id, weekday=wd, start_local=s, end_local=e,
                                    hospital_id=hospitals[h].id if h else None))

    for name, email, tz in PATIENTS:
        db.add(User(name=name, email=email, password_hash=pw, role="patient", timezone=tz))
    db.commit()
