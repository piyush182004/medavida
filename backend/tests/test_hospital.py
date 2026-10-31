from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from conftest import fresh_database


@pytest.fixture(scope="module")
def client():
    fresh_database()
    with TestClient(app) as c:
        yield c


def login(client, email):
    r = client.post("/auth/login", json={"email": email, "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def next_weekday(wd, min_days=3):
    d = date.today() + timedelta(days=min_days)
    while d.weekday() != wd:
        d += timedelta(days=1)
    return d


def test_seeded_hospitals_and_fees(client):
    asha = login(client, "asha@slotzero.dev")
    docs = client.get("/doctors", headers=asha).json()
    assert len(docs) >= 5
    alex = next(d for d in docs if d["name"] == "Alex Carter")
    assert {h["name"] for h in alex["hospitals"]} == {"Hudson Heart Center", "Eastside Family Health"}
    assert alex["fees"]["online"] == {"amount": 120, "currency": "USD"}
    assert {(f["name"], f["amount"]) for f in alex["fees"]["hospitals"]} == {("Hudson Heart Center", 180), ("Eastside Family Health", 160)}

    hudson = login(client, "hudson@slotzero.dev")
    me = client.get("/hospital/me", headers=hudson).json()
    assert me["name"] == "Hudson Heart Center" and me["currency"] == "USD"


def test_hospital_full_workflow(client):
    reg = client.post("/auth/register", json={
        "name": "Test Admin", "email": "admin@testclinic.dev", "password": "longpassword",
        "role": "hospital", "timezone": "Europe/London", "hospital_name": "Test Clinic", "hospital_city": "London",
    })
    assert reg.status_code == 201, reg.text
    assert reg.json()["user"]["hospital"]["currency"] == "GBP"
    admin = {"Authorization": f"Bearer {reg.json()['token']}"}
    asha = login(client, "asha@slotzero.dev")
    citycare = login(client, "citycare@slotzero.dev")

    # Roles are enforced on the server.
    assert client.get("/hospital/stats", headers=asha).status_code == 403
    assert client.get("/doctor/schedule", headers=admin).status_code == 403
    assert client.post("/appointments", json={"doctor_id": 1, "start_utc": "2030-01-07T10:00:00Z"}, headers=admin).status_code == 403

    meera = next(d["id"] for d in client.get("/doctors", headers=admin).json() if d["name"] == "Meera Shah")
    assert client.post("/hospital/doctors", json={"doctor_id": meera, "fee": 90}, headers=admin).status_code == 201
    assert client.post("/hospital/doctors", json={"doctor_id": meera, "fee": 90}, headers=admin).status_code == 409

    # Meera is at CityCare on Monday mornings — the hospital can't double-book her.
    clash = client.put(f"/hospital/doctors/{meera}/hours", json={"hours": [{"weekday": 0, "start": "10:00", "end": "11:00"}]}, headers=admin)
    assert clash.status_code == 400 and "CityCare Clinic" in clash.json()["detail"]
    ok = client.put(f"/hospital/doctors/{meera}/hours", json={"hours": [{"weekday": 5, "start": "10:00", "end": "12:00"}]}, headers=admin)
    assert ok.status_code == 200 and ok.json()["hours"] == [{"weekday": 5, "start": "10:00", "end": "12:00"}]

    # Patients now see Saturday slots at Test Clinic with the hospital's fee.
    sat = next_weekday(5)
    slots = client.get(f"/doctors/{meera}/slots", params={"date": sat.isoformat(), "tz": "Europe/London"}, headers=asha).json()["slots"]
    assert slots and all(s["hospital"]["name"] == "Test Clinic" for s in slots)
    req = client.post("/appointments", json={"doctor_id": meera, "start_utc": slots[0]["start_utc"], "reason": "Private symptoms"}, headers=asha).json()
    assert req["fee"] == {"amount": 90, "currency": "GBP"}
    up = client.post(f"/appointments/{req['id']}/attachments", files={"file": ("r.pdf", b"%PDF-1.4", "application/pdf")}, headers=asha)
    assert up.status_code == 201

    # Front desk sees the booking but not the medical note or files.
    mine = client.get("/appointments/mine", headers=admin).json()
    assert [a["id"] for a in mine] == [req["id"]]
    assert mine[0]["reason"] == "" and mine[0]["attachments"] == [] and mine[0]["attachment_count"] == 1
    assert client.get(f"/attachments/{up.json()['id']}", headers=admin).status_code == 403

    # Another hospital can't see or act on it; this hospital's desk can confirm.
    assert client.get(f"/appointments/{req['id']}", headers=citycare).status_code == 403
    assert client.post(f"/appointments/{req['id']}/confirm", headers=citycare).status_code == 403
    assert client.post(f"/appointments/{req['id']}/confirm", headers=admin).json()["status"] == "confirmed"

    stats = client.get("/hospital/stats", headers=admin).json()
    assert stats["totals"]["upcoming"] == 1 and stats["totals"]["revenue_booked"] == 90
    assert stats["by_doctor"][0]["name"] == "Meera Shah"

    # Changing the fee doesn't rewrite existing bookings.
    assert client.patch(f"/hospital/doctors/{meera}", json={"fee": 120}, headers=admin).status_code == 200
    assert client.get("/hospital/stats", headers=admin).json()["totals"]["revenue_booked"] == 90

    # History is scoped to this hospital.
    actions = {e["action"] for e in client.get("/audit/mine", headers=admin).json()}
    assert {"requested", "confirmed"} <= actions

    # Removing the doctor keeps existing bookings.
    rm = client.delete(f"/hospital/doctors/{meera}", headers=admin).json()
    assert rm["upcoming_kept"] == 1
    assert client.get(f"/appointments/{req['id']}", headers=asha).json()["status"] == "confirmed"
    assert not client.get(f"/doctors/{meera}/slots", params={"date": sat.isoformat(), "tz": "Europe/London"}, headers=asha).json()["slots"]


def test_doctor_schedule_cannot_overlap_across_hospitals(client):
    meera = login(client, "meera@slotzero.dev")
    s = client.get("/doctor/schedule", headers=meera).json()
    hosp = [h["hospital_id"] for h in s["fees"]["hospitals"]]
    bad = {
        "slot_minutes": 30, "specialization": s["specialization"], "bio": s["bio"],
        "hours": [
            {"weekday": 0, "start": "09:00", "end": "12:00", "hospital_id": hosp[0]},
            {"weekday": 0, "start": "11:00", "end": "13:00", "hospital_id": hosp[1]},
        ],
    }
    r = client.put("/doctor/schedule", json=bad, headers=meera)
    assert r.status_code == 400 and "two places" in r.json()["detail"]
