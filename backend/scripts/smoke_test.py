"""Live end-to-end smoke test against a running SlotZero API (real HTTP, real threads)."""
import json
import sys
import threading
import urllib.request as u
from datetime import date, timedelta

B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
results = []


def call(path, body=None, tok=None, method=None):
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = "Bearer " + tok
    req = u.Request(B + path, data=json.dumps(body).encode() if body is not None else None, headers=h,
                    method=method or ("POST" if body is not None else "GET"))
    try:
        with u.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"null")
    except u.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


def login(email):
    s, r = call("/auth/login", {"email": email, "password": "demo1234"})
    check(f"login {email}", s == 200, r)
    return r["token"]


def weekday(wd, min_days=3):
    d = date.today() + timedelta(days=min_days)
    while d.weekday() != wd:
        d += timedelta(days=1)
    return d.isoformat()


asha, sam = login("asha@slotzero.dev"), login("sam@slotzero.dev")
alex_t, meera_t = login("alex@slotzero.dev"), login("meera@slotzero.dev")
hudson, eastside, citycare = login("hudson@slotzero.dev"), login("eastside@slotzero.dev"), login("citycare@slotzero.dev")

docs = call("/doctors?tz=Asia/Kolkata", tok=asha)[1]
check("5 doctors listed", len(docs) == 5, len(docs))
alex = next(d for d in docs if d["name"] == "Alex Carter")
check("Alex works at Hudson + Eastside", {h["name"] for h in alex["hospitals"]} == {"Hudson Heart Center", "Eastside Family Health"})
check("Alex fees shown", alex["fees"]["online"]["amount"] == 120 and len(alex["fees"]["hospitals"]) == 2)

# Monday: Alex at Hudson 09-13 NY, online 14-17
mon = weekday(0)
slots = call(f"/doctors/{alex['id']}/slots?date={mon}&tz=America/New_York", tok=sam)[1]["slots"]
hud = [s for s in slots if s["hospital"] and s["hospital"]["name"] == "Hudson Heart Center"]
onl = [s for s in slots if s["hospital"] is None]
check("Monday has Hudson and online slots", hud and onl)

s, a1 = call("/appointments", {"doctor_id": alex["id"], "start_utc": hud[0]["start_utc"], "mode": "in_person", "reason": "Chest pain"}, tok=asha)
check("Asha requests in-person at Hudson", s == 201 and a1["status"] == "pending", a1)
check("fee snapshot $180", a1["fee"] == {"amount": 180, "currency": "USD"}, a1.get("fee"))
s, a2 = call("/appointments", {"doctor_id": alex["id"], "start_utc": onl[0]["start_utc"], "mode": "online"}, tok=sam)
check("Sam requests online", s == 201 and a2["fee"]["amount"] == 120, a2)

# Two patients race for one slot with real concurrent HTTP requests.
target = hud[1]["start_utc"]
codes = []
def race(tok):
    codes.append(call("/appointments", {"doctor_id": alex["id"], "start_utc": target}, tok=tok)[0])
ts = [threading.Thread(target=race, args=(t,)) for t in [asha, sam] * 5]
[t.start() for t in ts]
[t.join() for t in ts]
check("concurrent race: exactly one 201", codes.count(201) == 1, codes)

# Hospital front desk
mine = call("/appointments/mine", tok=hudson)[1]
check("Hudson sees its in-person bookings only", {a["id"] for a in mine} >= {a1["id"]} and all(a["hospital"]["name"] == "Hudson Heart Center" for a in mine))
check("Hudson can't read the medical note", all(a["reason"] == "" for a in mine))
check("Eastside can't see Hudson booking", call(f"/appointments/{a1['id']}", tok=eastside)[0] == 403)
check("Eastside can't confirm it", call(f"/appointments/{a1['id']}/confirm", {}, tok=eastside)[0] == 403)
s, c = call(f"/appointments/{a1['id']}/confirm", {}, tok=hudson)
check("Hudson confirms", s == 200 and c["status"] == "confirmed", c)
st = call("/hospital/stats", tok=hudson)[1]
check("Hudson stats: booked revenue counts confirmed fee", st["totals"]["revenue_booked"] >= 180, st["totals"])
check("Hudson stats: per-doctor row for Alex", any(d["name"] == "Alex Carter" and d["upcoming"] >= 1 for d in st["by_doctor"]))

# Doctor sees everything incl. the note
dm = call("/appointments/mine", tok=alex_t)[1]
check("Alex sees note", any(a["id"] == a1["id"] and a["reason"] == "Chest pain" for a in dm))
check("Meera can't see Alex's booking", call(f"/appointments/{a1['id']}", tok=meera_t)[0] == 403)

# Hospital assigns hours that clash with the doctor's other hospital -> rejected
r = call(f"/hospital/doctors/{alex['id']}/hours", {"hours": [{"weekday": 3, "start": "10:00", "end": "11:00"}]}, tok=hudson, method="PUT")
check("Hudson can't schedule Alex during his Eastside Thursday", r[0] == 400 and "Eastside" in r[1]["detail"], r)
r = call(f"/hospital/doctors/{alex['id']}/hours", {"hours": [{"weekday": d, "start": "09:00", "end": "13:00"} for d in (0, 1, 2, 4)] + [{"weekday": 5, "start": "09:00", "end": "11:00"}]}, tok=hudson, method="PUT")
check("Hudson adds a Saturday shift", r[0] == 200, r)
sat = call(f"/doctors/{alex['id']}/slots?date={weekday(5)}&tz=America/New_York", tok=asha)[1]["slots"]
check("Saturday Hudson slots now visible to patients", sat and all(s["hospital"]["name"] == "Hudson Heart Center" for s in sat))

# Roles
check("patient blocked from hospital API", call("/hospital/stats", tok=asha)[0] == 403)
check("hospital can't request appointments", call("/appointments", {"doctor_id": alex["id"], "start_utc": target}, tok=hudson)[0] == 403)
check("no token -> 401", call("/appointments/mine")[0] == 401)

# Cancel frees the slot
s, x = call(f"/appointments/{a2['id']}/cancel", {"reason": "Feeling better"}, tok=sam)
check("Sam cancels", s == 200 and x["status"] == "cancelled")
again = call(f"/doctors/{alex['id']}/slots?date={mon}&tz=America/New_York", tok=sam)[1]["slots"]
check("cancelled slot reopens", any(s["start_utc"] == onl[0]["start_utc"] for s in again))

# Invalid input is explained, not crashed
s, r = call("/appointments", {"doctor_id": alex["id"], "start_utc": "yesterday"}, tok=asha)
check("bad date -> 422 plain message", s == 422 and isinstance(r["detail"], str), r)
s, r = call("/tz/check?local=2027-03-28T01:30&tz=Europe/London")
check("DST gap detected", s == 200 and r["status"] == "nonexistent")

passed = sum(ok for _, ok in results)
print(f"\n{passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
