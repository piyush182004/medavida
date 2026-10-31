import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from conftest import fresh_database


@pytest.fixture(scope="module")
def client():
    fresh_database()
    with TestClient(app) as c:
        yield c


def login(client, who):
    r = client.post("/auth/login", json={"email": f"{who}@slotzero.dev", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def doctor_id(client, h, name):
    return next(d["id"] for d in client.get("/doctors", headers=h).json() if name in d["name"])


def future_weekday(offset=5):
    d = date.today() + timedelta(days=offset)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def slots(client, h, doc, day, tz):
    r = client.get(f"/doctors/{doc}/slots", params={"date": day.isoformat(), "tz": tz}, headers=h)
    assert r.status_code == 200, r.text
    return [s["start_utc"] for s in r.json()["slots"]]


def test_booking_lifecycle(client):
    asha, sam = login(client, "asha"), login(client, "sam")
    meera = doctor_id(client, asha, "Meera")
    day = future_weekday(6)
    free = slots(client, asha, meera, day, "Europe/London")
    assert free, "Meera should have generated slots"
    target = free[0]

    key = str(uuid.uuid4())
    r1 = client.post("/appointments", json={"doctor_id": meera, "start_utc": target}, headers={**asha, "Idempotency-Key": key})
    assert r1.status_code == 201, r1.text
    r2 = client.post("/appointments", json={"doctor_id": meera, "start_utc": target}, headers={**asha, "Idempotency-Key": key})
    assert r2.status_code == 200 and r2.json()["id"] == r1.json()["id"]

    # Sam cannot take the same slot; it disappears from the slot list.
    r3 = client.post("/appointments", json={"doctor_id": meera, "start_utc": target}, headers=sam)
    assert r3.status_code == 409
    assert target not in slots(client, sam, meera, day, "Europe/London")

    # Sam cannot see or cancel Asha's booking.
    appt = r1.json()["id"]
    assert client.get(f"/appointments/{appt}", headers=sam).status_code == 403
    assert client.post(f"/appointments/{appt}/cancel", headers=sam).status_code == 403

    # Reschedule into a taken slot fails and keeps the original.
    other = client.post("/appointments", json={"doctor_id": meera, "start_utc": free[1]}, headers=sam)
    assert other.status_code == 201
    bad = client.post(f"/appointments/{appt}/reschedule", json={"start_utc": free[1]}, headers=asha)
    assert bad.status_code == 409
    assert client.get(f"/appointments/{appt}", headers=asha).json()["start_utc"] == target

    ok = client.post(f"/appointments/{appt}/reschedule", json={"start_utc": free[2]}, headers=asha)
    assert ok.status_code == 200 and ok.json()["start_utc"] == free[2]
    assert target in slots(client, sam, meera, day, "Europe/London")

    # Cancelling frees the slot again.
    assert client.post(f"/appointments/{appt}/cancel", headers=asha).status_code == 200
    assert free[2] in slots(client, sam, meera, day, "Europe/London")


def test_role_enforcement(client):
    meera_h = login(client, "meera")
    asha = login(client, "asha")
    alex = doctor_id(client, asha, "Alex")
    day = future_weekday(8)
    s = slots(client, asha, alex, day, "Asia/Kolkata")[0]
    r = client.post("/appointments", json={"doctor_id": alex, "start_utc": s}, headers=meera_h)
    assert r.status_code == 403
    assert client.get("/doctor/schedule", headers=asha).status_code == 403
    assert client.get("/appointments/mine").status_code == 401


def test_off_grid_and_past_rejected(client):
    asha = login(client, "asha")
    meera = doctor_id(client, asha, "Meera")
    day = future_weekday(9)
    s = datetime.fromisoformat(slots(client, asha, meera, day, "Europe/London")[0].replace("Z", "+00:00"))
    off = (s + timedelta(minutes=7)).isoformat()
    assert client.post("/appointments", json={"doctor_id": meera, "start_utc": off}, headers=asha).status_code == 409
    assert client.post("/appointments", json={"doctor_id": meera, "start_utc": "2020-01-06T10:00:00Z"}, headers=asha).status_code == 409
    assert client.post("/appointments", json={"doctor_id": meera, "start_utc": "not-a-date"}, headers=asha).status_code == 422


def test_concurrent_booking_only_one_wins(client):
    asha, sam = login(client, "asha"), login(client, "sam")
    alex = doctor_id(client, asha, "Alex")
    target = slots(client, asha, alex, future_weekday(10), "America/New_York")[0]

    def attempt(headers):
        with TestClient(app) as c:
            return c.post("/appointments", json={"doctor_id": alex, "start_utc": target}, headers=headers).status_code

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(attempt, [asha, sam] * 4))
    assert codes.count(201) == 1, codes


def test_dst_rules(client):
    gap = client.get("/tz/check", params={"local": "2027-03-28T01:30", "tz": "Europe/London"}).json()
    assert gap["status"] == "nonexistent"
    overlap = client.get("/tz/check", params={"local": "2026-11-01T01:30", "tz": "America/New_York"}).json()
    assert overlap["status"] == "ambiguous" and len(overlap["interpretations"]) == 2

    meera = login(client, "meera")
    r = client.post("/doctor/blocks", json={"start_local": "2027-03-28T01:30", "end_local": "2027-03-28T03:00"}, headers=meera)
    assert r.status_code == 400 and "does not exist" in r.json()["detail"]


def test_request_confirm_propose_flow(client):
    asha, meera_h, sam = login(client, "asha"), login(client, "meera"), login(client, "sam")
    meera = doctor_id(client, asha, "Meera")
    day = future_weekday(12)
    free = slots(client, asha, meera, day, "Europe/London")

    req = client.post("/appointments", json={"doctor_id": meera, "start_utc": free[0], "mode": "online", "reason": "Fever for 3 days"}, headers=asha).json()
    assert req["status"] == "pending" and req["meeting_url"] is None
    # A pending request already holds the slot.
    assert client.post("/appointments", json={"doctor_id": meera, "start_utc": free[0]}, headers=sam).status_code == 409
    # Patients cannot confirm their own request.
    assert client.post(f"/appointments/{req['id']}/confirm", headers=asha).status_code == 403

    prop = client.post(f"/appointments/{req['id']}/propose", json={"start_utc": free[3], "message": "Earlier is full"}, headers=meera_h)
    assert prop.status_code == 200 and prop.json()["status"] == "proposed"
    assert free[0] in slots(client, sam, meera, day, "Europe/London")
    acc = client.post(f"/appointments/{req['id']}/accept", headers=asha).json()
    assert acc["status"] == "confirmed" and acc["meeting_url"].startswith("https://meet.jit.si/")

    # File sharing: owner can upload and both parties can download; others can't.
    up = client.post(f"/appointments/{req['id']}/attachments", files={"file": ("report.pdf", b"%PDF-1.4 demo", "application/pdf")}, headers=asha)
    assert up.status_code == 201
    att = up.json()["id"]
    assert client.get(f"/attachments/{att}", headers=meera_h).content.startswith(b"%PDF")
    assert client.get(f"/attachments/{att}", headers=sam).status_code == 403
    bad = client.post(f"/appointments/{req['id']}/attachments", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, headers=asha)
    assert bad.status_code == 400

    req2 = client.post("/appointments", json={"doctor_id": meera, "start_utc": free[5]}, headers=sam).json()
    assert client.post(f"/appointments/{req2['id']}/decline", json={"reason": "Not my specialty"}, headers=meera_h).json()["status"] == "declined"
    assert free[5] in slots(client, asha, meera, day, "Europe/London")


def test_hospitals_and_online_only(client):
    asha = login(client, "asha")
    hospitals = client.get("/hospitals", headers=asha).json()
    assert {h["name"] for h in hospitals} >= {"CityCare Clinic", "Hudson Heart Center"}
    hudson = next(h["id"] for h in hospitals if h["name"] == "Hudson Heart Center")
    docs = client.get("/doctors", params={"hospital_id": hudson}, headers=asha).json()
    assert [d["name"] for d in docs] == ["Alex Carter"]

    alex = docs[0]["id"]
    r = client.get(f"/doctors/{alex}/slots", params={"date": future_weekday(13).isoformat(), "tz": "America/New_York"}, headers=asha).json()
    online_only = next(s for s in r["slots"] if s["hospital"] is None)
    bad = client.post("/appointments", json={"doctor_id": alex, "start_utc": online_only["start_utc"], "mode": "in_person"}, headers=asha)
    assert bad.status_code == 400 and "online" in bad.json()["detail"]
