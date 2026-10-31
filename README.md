# SlotZero: Conflict-Free Doctor Appointment Scheduler

Built at the **[MedaVida](https://medavida.com/) Intern Hackathon**.

Doctors set their hours in their own time zone. Patients in India, the UK and the US book open slots and see each appointment in their own local time. The server never confirms two overlapping appointments for one doctor.

| Folder | Stack | Deploy to |
|---|---|---|
| [`backend/`](backend/) | FastAPI · SQLAlchemy · Python `zoneinfo` · JWT | Render |
| [`frontend/`](frontend/) | Next.js 14 (App Router) · TypeScript · plain CSS | Vercel |

## Demo accounts

Password for every account: **`demo1234`**. On the login page you can also sign in with one click.

| Person | Role | Email | Time zone |
|---|---|---|---|
| Asha Rao | Patient | asha@slotzero.dev | Asia/Kolkata |
| Sam Miller | Patient | sam@slotzero.dev | America/New_York |
| Dr. Meera Shah (General Physician) | Doctor | meera@slotzero.dev | Europe/London |
| Dr. James Whitfield (Paediatrics) | Doctor | james@slotzero.dev | Europe/London |
| Dr. Alex Carter (Cardiology) | Doctor | alex@slotzero.dev | America/New_York |
| Dr. Sofia Ramirez (Psychiatry) | Doctor | sofia@slotzero.dev | America/New_York |
| Dr. Priya Nair (Dermatology) | Doctor | priya@slotzero.dev | Asia/Kolkata |
| CityCare Clinic | Hospital | citycare@slotzero.dev | Europe/London |
| Riverside General Hospital | Hospital | riverside@slotzero.dev | Europe/London |
| Hudson Heart Center | Hospital | hudson@slotzero.dev | America/New_York |
| Eastside Family Health | Hospital | eastside@slotzero.dev | America/New_York |
| Lotus Grove Hospital | Hospital | lotus@slotzero.dev | Asia/Kolkata |

When the database is empty, the server creates these accounts. It also creates fictional hospitals, each doctor's hospital affiliations and fees, and weekly schedules that span several hospitals. For example, Dr. Alex works at Hudson Mon/Tue/Wed/Fri, at Eastside on Thursday, and online in the afternoons. All of it can be edited. **No appointments or slots are seeded.** Slots are always generated from hours, blocked time and active bookings.

## Three roles

- **Patient:** finds doctors by name, specialization, hospital and date, and sees fees. Requests a slot in person or by online video and adds symptoms and past reports. Accepts or declines times the doctor proposes, cancels or reschedules, and sees prescriptions with buy links and nearby pharmacies.
- **Doctor:** confirms or declines requests, or proposes another free time. Views a week calendar and a mini month, sets weekly hours per hospital or online, blocks time, sets the online fee and prescribes.
- **Hospital:** manages its roster of doctors and their in-person fees, and assigns shifts. The server rejects any shift that overlaps the doctor's other hospitals. Runs a front desk that can confirm, decline or cancel, plus a calendar and per-doctor analytics (appointments, booked, earned and pipeline revenue). For privacy, hospitals never see patients' medical notes or uploaded reports.

## Run locally

```bash
# 0. PostgreSQL (Docker)
docker run -d --name slotzero-pg -e POSTGRES_USER=slotzero -e POSTGRES_PASSWORD=slotzero \
  -e POSTGRES_DB=slotzero -p 5432:5432 -v slotzero-pgdata:/var/lib/postgresql/data postgres:16-alpine

# 1. API → http://localhost:8000  (interactive docs at /docs)
cd backend
cp .env.example .env              # set DATABASE_URL, and OPENROUTER_API_KEY for AI features
python -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000  # restart after editing .env
pytest -q                         # 13 tests on SQLite (AI is mocked — no API calls)
TEST_DATABASE_URL=postgresql://slotzero:slotzero@localhost:5432/slotzero_test pytest -q   # same suite on Postgres
python scripts/smoke_test.py      # 34 live HTTP checks against the running API (use a fresh DB)

# 2. Web → http://localhost:3000
cd frontend
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
```

## Deploy

The stack is **Neon** (PostgreSQL), **Render** (FastAPI) and **Vercel** (Next.js).

1. **Database on Neon.** Create a project and copy the connection string. Use the **direct** one: its host has no `-pooler` and it ends in `?sslmode=require`. The app uses session-level Postgres locks, which need a direct connection.
2. **API on Render.** Create a Web Service from this repo (or use the `render.yaml` blueprint) with these settings:
   - Root directory: `backend`
   - Build: `pip install -r requirements.txt`
   - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Env vars:
     - `DATABASE_URL` set to the Neon string.
     - `SECRET_KEY` set to a long random value.
     - `PYTHON_VERSION=3.11.9`.
     - `OPENROUTER_API_KEY` (optional).
     - `CORS_ORIGINS=*` or your Vercel URL.

   Tables and demo accounts are created on the first boot.
3. **Web on Vercel.** Import this repo, set Root Directory to `frontend`, and add `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com` with no trailing slash. This value is baked in at build time, so if it changes, redeploy.

The free Render tier sleeps after 15 minutes of inactivity, and the first request then takes about 50 seconds. Open `https://<your-api>.onrender.com/health` before a demo.

## How the rules are enforced (all server-side)

| Rule | Implementation |
|---|---|
| Roles | `require_role()` dependency on every doctor-only and patient-only route. The role is read from the database, not from the UI. |
| Ownership | `_own_appointment()` returns **403** when a patient or doctor touches someone else's appointment. No data is leaked. |
| Slot generation | `scheduling.available_slots()` builds slots from working hours, removes blocked periods and active bookings, and never offers past times. |
| No double booking | **PostgreSQL.** `doctor_lock()` runs `UPDATE doctor_profiles … lock_version+1` inside the booking transaction. That takes a row lock held until commit, so concurrent requests for the *same doctor* queue up, from any worker or server, while other doctors are never blocked. The requested start is then re-validated against freshly generated slots. A partial unique index on `(doctor_id, start_utc)` for active statuses is the last line of defence. Verified with 40 simultaneous requests across 4 uvicorn workers: exactly 1 booking was created, and the database held 0 duplicates. |
| Safe multi-worker startup | Table creation and demo seeding run under a Postgres advisory lock, so N workers starting together seed exactly once. |
| Touching slots | Overlap uses half-open intervals, so 10:00–10:30 and 10:30–11:00 can both be booked. |
| Idempotency | The client sends an `Idempotency-Key` with each booking. The key is unique per patient, so a repeat returns the original booking (200, `replayed: true`). |
| Cancellation | Patients can cancel up to 2 h before the start. Later attempts get a plain-language policy error. A cancelled slot reappears immediately. |
| Rescheduling | Validates the new slot inside the lock first. On any failure the transaction rolls back and the original booking is untouched. |
| Blocked time / hours change | Bookings are never deleted. Affected bookings come back in the API response and show as warnings on the doctor dashboard. |
| History | Every booking, cancellation, reschedule and prescription is written to `audit_logs` and shown on both dashboards. |
| Invalid input | Pydantic validation plus custom handlers turn errors into one readable sentence. Past dates, off-grid times and naive datetimes are rejected. |

## Time zones and daylight saving

- Only `Asia/Kolkata`, `Europe/London` and `America/New_York` are supported, by their IANA names. The code never uses fixed offsets.
- Appointments are stored as **UTC instants**. Doctor hours are **wall-clock** times in the doctor's zone, so 09:00 London is still 09:00 London after the clocks change.
- **Nonexistent local times**, inside a spring-forward gap, are rejected (`tz.to_utc`) and never generated as slots.
- **Ambiguous local times**, the repeated hour at fall-back, resolve to the **first occurrence** (`fold=0`). When a doctor blocks time, the end of the block resolves to the **second occurrence**, so the block covers the whole repeated hour.
- The `/timezones` page and `GET /tz/check?local=…&tz=…` demonstrate these rules live. For example, New York falls back on 1 Nov 2026: Dr. Alex's 09:00 is 18:30 IST on 30 Oct and 19:30 IST on 2 Nov.

## AI assistance (OpenRouter · `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`)

Set `OPENROUTER_API_KEY` in `backend/.env` (or as a Render env var). Without a key the app works normally and the AI buttons show "AI not configured".

| Feature | Who | How |
|---|---|---|
| Summarise a shared report | Doctor (clinical summary), patient (plain-language summary) | PDFs are read server-side with PyMuPDF. Scanned or handwritten pages are sent to the model as images. Summaries are cached per document. |
| Pre-visit brief | Doctor | Combines the patient's note and every shared report into one page: reason, symptoms, allergies, medicines, abnormal results, what to check, what's missing. |
| Prescription from PDF or handwriting | Doctor fills in, patient receives | The doctor uploads a photo or PDF, the AI transcribes it into medicine rows, and **the doctor reviews and edits them before sending**. The patient gets the structured medicines with buy links, plus the original file. |

Safety: the model only summarises or transcribes, and is told not to diagnose. Every output is labelled as AI-generated with a "check the original" note. **Hospitals cannot use any AI endpoint or see medical content.** Free models can be slow or rate-limited; failures produce a plain message, and the app retries automatically once if the model returns an empty answer.

## Extras

- **Video consults.** Book with the "Online video" option and the server creates a private `meet.jit.si` room. No API key or account is needed.
- **e-Prescriptions.** Doctors prescribe from any of their own appointments. Patients see each medicine with:
  - Official label text from **openFDA**.
  - Real retailer search links: 1mg, PharmEasy, Apollo and Netmeds for India; Boots, Superdrug and the NHS guide for the UK; CVS, Walgreens, GoodRx and MedlinePlus for the US. The patient's own region is listed first.
- **Nearby pharmacies.** Live results from **OpenStreetMap** (Overpass and Nominatim) around the browser's location or a searched area, with distance, opening hours and directions. Nothing is invented.

## 2–3 minute demo script

1. **Dr. Meera:** open *Working hours* and show 09:00–12:00 and 13:00–17:00 London time with 30-min slots. Block a lunch hour.
2. **Asha (Kolkata):** open *Find a doctor*, choose Dr. Meera and pick a slot. It shows IST, with Meera's GMT time underneath. Choose *Online video* and confirm.
3. **Dr. Meera:** the booking appears under *Today* or *Upcoming* with Asha's local time. Join the Jitsi call and prescribe paracetamol.
4. **Asha:** the prescription appears with buy links and FDA label info. *Nearby pharmacies* shows live OpenStreetMap results.
5. **Conflict:** Sam tries the same slot and is told it is taken. Asha reschedules into a taken slot, which fails while the original stays. Asha then cancels and the slot reappears.
6. **DST:** on `/timezones`, the New York 1 Nov 01:30 check comes back ambiguous and the London 28 Mar 01:30 check is rejected.

## Submission checklist

Zip the project **without** `backend/.venv`, `frontend/node_modules`, `frontend/.next`, `*.db` and `.env*` (all of these are in `.gitignore`).

---
*Hackathon prototype. Uses demo data only and is not for real medical use.*
