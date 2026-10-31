from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores instants as naive UTC and always hands back tz-aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Refusing to store a naive datetime")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(10))  # "doctor" | "patient" | "hospital"
    timezone: Mapped[str] = mapped_column(String(64))
    # Set only for hospital administrator accounts.
    hospital_id: Mapped[int | None] = mapped_column(ForeignKey("hospitals.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    doctor_profile: Mapped["DoctorProfile | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    hospital: Mapped["Hospital | None"] = relationship(foreign_keys=[hospital_id])


class DoctorProfile(Base):
    __tablename__ = "doctor_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    specialization: Mapped[str] = mapped_column(String(120), default="General Physician")
    bio: Mapped[str] = mapped_column(Text, default="")
    slot_minutes: Mapped[int] = mapped_column(Integer, default=30)
    # Fee for online consultations, in the currency of the doctor's zone.
    online_fee: Mapped[int] = mapped_column(Integer, default=50)
    currency: Mapped[str] = mapped_column(String(3), default="GBP")
    # Bumped inside every booking transaction; the UPDATE takes a row/write lock
    # so concurrent bookings for the same doctor are serialised.
    lock_version: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="doctor_profile")


class Hospital(Base):
    """A hospital or clinic. Doctors can work at several; each working range names one."""

    __tablename__ = "hospitals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    city: Mapped[str] = mapped_column(String(80), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/London")
    currency: Mapped[str] = mapped_column(String(3), default="GBP")
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class HospitalDoctor(Base):
    """A doctor's affiliation with a hospital, with the in-person fee the hospital charges."""

    __tablename__ = "hospital_doctors"
    __table_args__ = (UniqueConstraint("hospital_id", "doctor_id", name="uq_hospital_doctor"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    fee: Mapped[int] = mapped_column(Integer, default=0)  # whole units of the hospital's currency
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    hospital: Mapped["Hospital"] = relationship()
    doctor: Mapped[User] = relationship()


class WorkingHours(Base):
    __tablename__ = "working_hours"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Monday
    start_local: Mapped[str] = mapped_column(String(5))  # "HH:MM" in doctor's zone
    end_local: Mapped[str] = mapped_column(String(5))
    # None = online-only consultations for this range.
    hospital_id: Mapped[int | None] = mapped_column(ForeignKey("hospitals.id"), nullable=True)


class BlockedPeriod(Base):
    __tablename__ = "blocked_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    start_utc: Mapped[datetime] = mapped_column(UTCDateTime)
    end_utc: Mapped[datetime] = mapped_column(UTCDateTime)
    reason: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        UniqueConstraint("patient_id", "idempotency_key", name="uq_patient_idempotency"),
        Index("ix_appt_doctor_start", "doctor_id", "start_utc"),
        # Last line of defence: two slot-holding appointments can never share a start.
        Index(
            "uq_active_doctor_start",
            "doctor_id",
            "start_utc",
            unique=True,
            sqlite_where=text("status IN ('pending', 'proposed', 'confirmed')"),
            postgresql_where=text("status IN ('pending', 'proposed', 'confirmed')"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    hospital_id: Mapped[int | None] = mapped_column(ForeignKey("hospitals.id"), nullable=True)
    start_utc: Mapped[datetime] = mapped_column(UTCDateTime)
    end_utc: Mapped[datetime] = mapped_column(UTCDateTime)
    # pending (patient requested) | proposed (doctor suggested a new time) | confirmed
    # | declined | cancelled. The first three hold the slot.
    status: Mapped[str] = mapped_column(String(12), default="pending")
    mode: Mapped[str] = mapped_column(String(12), default="in_person")  # in_person | online
    meeting_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str] = mapped_column(String(1000), default="")  # patient's note / symptoms
    doctor_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Fee snapshot at booking time, so later price changes don't rewrite history.
    fee_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fee_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    # Cached AI pre-visit brief for the doctor (note + document summaries).
    ai_brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_brief_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(10), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    doctor: Mapped[User] = relationship(foreign_keys=[doctor_id])
    patient: Mapped[User] = relationship(foreign_keys=[patient_id])
    hospital: Mapped[Hospital | None] = relationship()
    attachments: Mapped[list["Attachment"]] = relationship(
        order_by="Attachment.id", lazy="selectin", cascade="all, delete-orphan"
    )


class Attachment(Base):
    """Past reports / prescriptions a patient (or doctor) shares on an appointment."""

    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), index=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    # Cached AI summaries: clinical for the doctor, plain-language for the patient.
    ai_summary_doctor: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_summary_patient: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    uploader: Mapped[User] = relationship()


class Prescription(Base):
    __tablename__ = "prescriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    appointment_id: Mapped[int | None] = mapped_column(ForeignKey("appointments.id"), nullable=True)
    items: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    # Optional original (PDF or photo of a handwritten prescription).
    file_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    file_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    file_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    doctor: Mapped[User] = relationship(foreign_keys=[doctor_id])
    patient: Mapped[User] = relationship(foreign_keys=[patient_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    actor_role: Mapped[str] = mapped_column(String(10))
    action: Mapped[str] = mapped_column(String(40))
    appointment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doctor_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    patient_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    hospital_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    actor: Mapped[User] = relationship(foreign_keys=[actor_id])
