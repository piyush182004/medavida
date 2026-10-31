# SlotZero — project memory

Conflict-free doctor appointment scheduler built for the MedaVida intern hackathon.

## Layout
- `backend/` — FastAPI + SQLAlchemy on **PostgreSQL** (`DATABASE_URL` in `backend/.env`; local Docker container `slotzero-pg`, DBs `slotzero` and `slotzero_test`). SQLite still works as a fallback. Deploy with `render.yaml` at repo root.
- AI: `app/ai.py` + `routers/ai.py`, OpenRouter via `OPENROUTER_API_KEY`. Tests mock `ai._chat`; never call the real model in pytest.
- Run tests on Postgres: `TEST_DATABASE_URL=postgresql://slotzero:slotzero@localhost:5432/slotzero_test pytest -q`.
- Uvicorn `--reload` hangs on Windows when `.env` changes — restart the server instead.
- `frontend/` — Next.js (App Router, plain CSS). Deploy on Vercel. Talks to backend via `NEXT_PUBLIC_API_URL`.

## Non-negotiable rules (from the brief)
- Roles (`doctor` / `patient`) enforced on the server for every endpoint.
- Only three zones: `Asia/Kolkata`, `Europe/London`, `America/New_York` (IANA names, never fixed offsets).
- Appointments stored as UTC. Doctor hours are wall-clock times in the doctor's zone.
- Nonexistent local times are rejected. Ambiguous local times resolve to the *first* occurrence (fold=0); for blocked periods the end resolves to the *later* occurrence so the block covers the whole ambiguous hour.
- Slot lengths 15/30/60; slots must fit inside a working range; touching appointments are allowed.
- Bookings are serialised per doctor (row lock on `doctor_profiles`) and re-validated against freshly generated slots.
- Idempotency: `Idempotency-Key` header, unique per patient.
- Cancel / reschedule only ≥ 2 hours before start. Reschedule is one transaction; failure leaves the original intact.
- Blocking time or changing hours never deletes bookings; affected bookings are flagged on the doctor dashboard.
- Every book / cancel / reschedule / prescription is written to `audit_logs`.
- No fake data: pharmacies come live from OpenStreetMap Overpass; buy links are real retailer search URLs.

## Roles
- `patient`, `doctor`, `hospital` (admin of one hospital via `users.hospital_id`). All enforced server-side.
- Appointment flow: `pending` (holds slot) → doctor/hospital `confirm` | doctor `propose` → patient `accept` | `declined` | `cancelled`.
- Hospitals see bookings at their hospital only, never `reason` or attachments.
- Fees: online fee on `doctor_profiles`, in-person fee on `hospital_doctors`; snapshotted on `appointments.fee_amount/fee_currency`.
- A doctor's weekly ranges may never overlap across hospitals (`scheduling.ranges_error`).

## Demo accounts (seeded when the DB is empty, no appointments seeded)
Password for all: `demo1234`
- Patients: asha@ (Asia/Kolkata), sam@ (America/New_York)
- Doctors: meera@, james@ (London), alex@, sofia@ (New York), priya@ (Kolkata)
- Hospitals: citycare@, riverside@ (London), hudson@, eastside@ (New York), lotus@ (Kolkata)
- All `@slotzero.dev`.
