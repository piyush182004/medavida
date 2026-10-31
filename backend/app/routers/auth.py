from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_token, current_user, hash_password, verify_password
from ..db import get_db
from ..models import DoctorProfile, Hospital, User
from ..schemas import LoginIn, RegisterIn
from ..scheduling import ZONE_CURRENCY
from ..serializers import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(409, "An account with this email already exists. Try logging in.")
    user = User(
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        timezone=body.timezone,
    )
    currency = ZONE_CURRENCY[body.timezone]
    if body.role == "doctor":
        user.doctor_profile = DoctorProfile(
            specialization=(body.specialization or "General Physician").strip(),
            slot_minutes=30,
            online_fee={"INR": 800, "GBP": 50, "USD": 100}[currency],
            currency=currency,
        )
    if body.role == "hospital":
        name = (body.hospital_name or "").strip()
        if len(name) < 2:
            raise HTTPException(400, "Please enter the hospital or clinic name.")
        user.hospital = Hospital(
            name=name,
            city=(body.hospital_city or "").strip(),
            address=(body.hospital_address or "").strip(),
            timezone=body.timezone,
            currency=currency,
        )
    db.add(user)
    db.commit()
    return {"token": create_token(user), "user": user_out(user)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password.")
    return {"token": create_token(user), "user": user_out(user)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)
