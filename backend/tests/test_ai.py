import json
from datetime import date, timedelta

import fitz
import pytest
from fastapi.testclient import TestClient

from app import ai
from app.main import app
from conftest import fresh_database


@pytest.fixture(scope="module")
def client():
    fresh_database()
    with TestClient(app) as c:
        yield c


def login(client, who):
    r = client.post("/auth/login", json={"email": f"{who}@slotzero.dev", "password": "demo1234"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def text_pdf(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_textbox(fitz.Rect(40, 40, 560, 800), text, fontsize=10)
    return doc.tobytes()


def tiny_png() -> bytes:
    return fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 8, 8), False).tobytes("png")


@pytest.fixture()
def fake_model(monkeypatch):
    calls = []

    def fake_chat(content, max_tokens=3000):
        calls.append(content)
        prompt = content[0]["text"]
        if "Transcribe this prescription" in prompt:
            return "```json\n" + json.dumps({
                "medicines": [{"name": "Calpol 650", "dosage": "1 tablet", "frequency": "TDS", "duration": "3 days", "instructions": "after food"}],
                "notes": "Review in 1 week", "unclear": [],
            }) + "\n```"
        if "for the treating doctor" in prompt:
            return "Document type:\n- Blood test\nKey findings:\n- Haemoglobin 10.2 (low)"
        if "to the patient" in prompt:
            return "What this document is:\n- A blood test"
        return "Reason for visit:\n- Fever"

    monkeypatch.setattr(ai, "_chat", fake_chat)
    return calls


def booked_appointment(client, patient):
    meera = next(d["id"] for d in client.get("/doctors", headers=patient).json() if d["name"] == "Meera Shah")
    d = date.today() + timedelta(days=5)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    slot = client.get(f"/doctors/{meera}/slots", params={"date": d.isoformat(), "tz": "Europe/London"}, headers=patient).json()["slots"][0]
    return client.post("/appointments", json={"doctor_id": meera, "start_utc": slot["start_utc"], "reason": "Fever and tiredness for a week"}, headers=patient).json()


def test_ai_disabled_without_key(client):
    asha = login(client, "asha")
    assert client.get("/ai/status", headers=asha).json()["enabled"] is False
    appt = booked_appointment(client, asha)
    up = client.post(f"/appointments/{appt['id']}/attachments", files={"file": ("cbc.pdf", text_pdf("Haemoglobin 10.2 g/dL " * 20), "application/pdf")}, headers=asha).json()
    r = client.post(f"/attachments/{up['id']}/summary", headers=login(client, "meera"))
    assert r.status_code == 503 and "OPENROUTER_API_KEY" in r.json()["detail"]


def test_summaries_brief_and_privacy(client, fake_model):
    asha, sam, meera = login(client, "asha"), login(client, "sam"), login(client, "meera")
    citycare = login(client, "citycare")
    appt = booked_appointment(client, asha)
    up = client.post(f"/appointments/{appt['id']}/attachments", files={"file": ("blood.pdf", text_pdf("Complete blood count. Haemoglobin 10.2 g/dL. " * 10), "application/pdf")}, headers=asha).json()

    r = client.post(f"/attachments/{up['id']}/summary", headers=meera).json()
    assert "Haemoglobin" in r["summary"] and r["cached"] is False
    # The PDF's text (not the raw bytes) was sent to the model.
    assert any(part.get("type") == "text" and "Haemoglobin 10.2" in part.get("text", "") for part in fake_model[-1])
    assert client.post(f"/attachments/{up['id']}/summary", headers=meera).json()["cached"] is True

    # Patient gets their own plain-language version; others get nothing.
    assert "blood test" in client.post(f"/attachments/{up['id']}/summary", headers=asha).json()["summary"]
    assert client.post(f"/attachments/{up['id']}/summary", headers=sam).status_code == 403
    assert client.post(f"/attachments/{up['id']}/summary", headers=citycare).status_code == 403

    brief = client.post(f"/appointments/{appt['id']}/brief", headers=meera)
    assert brief.status_code == 200 and brief.json()["brief"].startswith("Reason")
    assert client.post(f"/appointments/{appt['id']}/brief", headers=asha).status_code == 403
    assert client.post(f"/appointments/{appt['id']}/brief", headers=citycare).status_code == 403
    # The brief is returned to the doctor only.
    assert client.get(f"/appointments/{appt['id']}", headers=meera).json()["ai_brief"]
    assert client.get(f"/appointments/{appt['id']}", headers=asha).json()["ai_brief"] is None


def test_handwritten_prescription_to_medicines(client, fake_model):
    asha, sam, meera = login(client, "asha"), login(client, "sam"), login(client, "meera")
    appt = booked_appointment(client, asha)
    photo = ("rx.png", tiny_png(), "image/png")

    assert client.post("/prescriptions/extract", files={"file": photo}, headers=asha).status_code == 403
    ex = client.post("/prescriptions/extract", files={"file": photo}, headers=meera).json()
    assert ex["medicines"][0]["name"] == "Calpol 650" and ex["notes"] == "Review in 1 week"
    assert fake_model[-1][1]["type"] == "image_url"  # handwriting goes to the model as an image

    rx = client.post("/prescriptions", json={"appointment_id": appt["id"], "items": ex["medicines"], "notes": ex["notes"]}, headers=meera).json()
    assert client.post(f"/prescriptions/{rx['id']}/file", files={"file": photo}, headers=meera).status_code == 201
    mine = client.get("/prescriptions/mine", headers=asha).json()
    assert mine[0]["items"][0]["name"] == "Calpol 650" and mine[0]["has_file"] is True
    assert client.get(f"/prescriptions/{rx['id']}/file", headers=asha).content.startswith(b"\x89PNG")
    assert client.get(f"/prescriptions/{rx['id']}/file", headers=sam).status_code == 404
