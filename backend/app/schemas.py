from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from .tz import SUPPORTED_ZONES

Zone = Literal["Asia/Kolkata", "Europe/London", "America/New_York"]
assert set(Zone.__args__) == set(SUPPORTED_ZONES)


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["doctor", "patient", "hospital"]
    timezone: Zone
    specialization: str | None = Field(default=None, max_length=120)
    # Hospital accounts register the hospital itself.
    hospital_name: str | None = Field(default=None, max_length=160)
    hospital_city: str | None = Field(default=None, max_length=80)
    hospital_address: str | None = Field(default=None, max_length=255)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class HoursRange(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")
    hospital_id: int | None = None  # None = online-only range


class ScheduleIn(BaseModel):
    slot_minutes: Literal[15, 30, 60]
    specialization: str = Field(min_length=2, max_length=120)
    bio: str = Field(default="", max_length=1000)
    online_fee: int | None = Field(default=None, ge=0, le=1_000_000)
    hours: list[HoursRange] = Field(max_length=50)


class HospitalHoursRange(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^\d{2}:\d{2}$")
    end: str = Field(pattern=r"^\d{2}:\d{2}$")


class HospitalHoursIn(BaseModel):
    hours: list[HospitalHoursRange] = Field(max_length=30)


class AffiliateIn(BaseModel):
    doctor_id: int
    fee: int = Field(ge=0, le=1_000_000)


class FeeIn(BaseModel):
    fee: int = Field(ge=0, le=1_000_000)


class HospitalProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    city: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=255)
    phone: str = Field(default="", max_length=40)


class BlockIn(BaseModel):
    start_local: datetime  # wall-clock time in the doctor's own zone, no offset
    end_local: datetime
    reason: str = Field(default="", max_length=200)


class BookIn(BaseModel):
    doctor_id: int
    start_utc: datetime
    mode: Literal["in_person", "online"] = "in_person"
    reason: str = Field(default="", max_length=1000)


class RescheduleIn(BaseModel):
    start_utc: datetime
    mode: Literal["in_person", "online"] | None = None


class ProposeIn(BaseModel):
    start_utc: datetime
    message: str = Field(default="", max_length=500)


class HospitalIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    city: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=255)


class CancelIn(BaseModel):
    reason: str = Field(default="", max_length=300)


class MedicineItem(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    dosage: str = Field(default="", max_length=80)
    frequency: str = Field(default="", max_length=80)
    duration: str = Field(default="", max_length=80)
    instructions: str = Field(default="", max_length=300)


class PrescriptionIn(BaseModel):
    appointment_id: int
    items: list[MedicineItem] = Field(min_length=1, max_length=20)
    notes: str = Field(default="", max_length=2000)
