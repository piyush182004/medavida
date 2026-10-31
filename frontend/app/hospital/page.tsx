"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HELD, api, errorMessage, fmtMoney, type Appointment, type AuditEntry, type Doctor, type Hospital, type Zone } from "@/lib/api";
import { WEEKDAYS, addDays, fmtDateTime, fmtKey, fmtLongDate, fmtTime, localDateKey, mondayOf, tzAbbr } from "@/lib/time";
import { useApp } from "@/components/Providers";
import { AuditList, Empty, ErrorBox, Modal, Skeletons, useRequireRole } from "@/components/ui";
import { LocationChip, StatusChip } from "@/components/AppointmentBits";
import { WeekCalendar } from "@/components/Calendar";

type Tab = "overview" | "appointments" | "calendar" | "doctors" | "schedules" | "settings" | "activity";

interface RosterDoctor {
  id: number;
  name: string;
  email: string;
  specialization: string;
  timezone: Zone;
  slot_minutes: number;
  fee: number;
  currency: string;
  hours: { weekday: number; start: string; end: string }[];
  other_hours: { weekday: number; start: string; end: string; where: string }[];
}

interface DoctorStats {
  doctor_id: number;
  name: string;
  specialization: string;
  on_roster: boolean;
  upcoming: number;
  requests: number;
  completed: number;
  cancelled: number;
  revenue_earned: number;
  revenue_booked: number;
  revenue_pipeline: number;
}

interface Stats {
  currency: string;
  timezone: Zone;
  totals: Omit<DoctorStats, "doctor_id" | "name" | "specialization" | "on_roster"> & { doctors: number; revenue_month: number };
  by_doctor: DoctorStats[];
  next_7_days: { date: string; count: number }[];
}

export default function HospitalPage() {
  return (
    <Suspense>
      <HospitalDashboard />
    </Suspense>
  );
}

const isOpen = (a: Appointment) => HELD.includes(a.status) && new Date(a.end_utc) > new Date();

function HospitalDashboard() {
  const session = useRequireRole("hospital");
  const { toast } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [roster, setRoster] = useState<RosterDoctor[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [declining, setDeclining] = useState<{ appt: Appointment; kind: "decline" | "cancel" } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<number | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/hospital?tab=${t}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const [h, a, r, s, l] = await Promise.all([
        api<Hospital>("/hospital/me"),
        api<Appointment[]>("/appointments/mine"),
        api<RosterDoctor[]>("/hospital/doctors"),
        api<Stats>("/hospital/stats"),
        api<AuditEntry[]>("/audit/mine"),
      ]);
      setHospital(h);
      setAppts(a);
      setRoster(r);
      setStats(s);
      setAudit(l);
    } catch (e) {
      setError(errorMessage(e));
      setAppts((a) => a ?? []);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!session) return <div className="container dash"><Skeletons /></div>;
  const tz = (hospital?.timezone || session.user.timezone) as Zone;
  const currency = stats?.currency || hospital?.currency || "GBP";
  const money = (n: number) => fmtMoney({ amount: n, currency });
  const all = appts || [];
  const requests = all.filter((a) => a.status === "pending" && isOpen(a));
  const selected = all.find((a) => a.id === selectedId) || null;

  const confirm = async (a: Appointment) => {
    try {
      await api(`/appointments/${a.id}/confirm`, { method: "POST" });
      toast(`Confirmed ${a.patient.name} with Dr. ${a.doctor.name}.`);
      setSelectedId(null);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const actions: Actions = {
    open: (a) => setSelectedId(a.id),
    confirm,
    decline: (a) => setDeclining({ appt: a, kind: "decline" }),
    cancel: (a) => setDeclining({ appt: a, kind: "cancel" }),
  };

  return (
    <div className="container dash">
      <div className="doc-hero">
        <div>
          <div className="eyebrow" style={{ color: "var(--teal)" }}>Hospital operations</div>
          <h1>{hospital?.name ?? "Your hospital"}</h1>
          <p className="small" style={{ color: "#b9c6c7" }}>
            {hospital?.city ? `${hospital.city} · ` : ""}{fmtLongDate(new Date(), tz)} · {tz} ({tzAbbr(new Date(), tz)}) · billing in {currency}
          </p>
        </div>
        <div className="doc-stats">
          <button className="doc-stat" onClick={() => setTab("appointments")}>
            <span className="n" style={{ color: requests.length ? "#f2c14e" : undefined }}>{requests.length}</span>
            <span>Requests waiting</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("calendar")}>
            <span className="n">{stats?.totals.upcoming ?? "–"}</span>
            <span>Confirmed upcoming</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("doctors")}>
            <span className="n">{stats?.totals.doctors ?? "–"}</span>
            <span>Doctors on roster</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("overview")}>
            <span className="n">{stats ? money(stats.totals.revenue_booked) : "–"}</span>
            <span>Booked revenue</span>
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {([
          ["overview", "Overview", null],
          ["appointments", "Appointments", requests.length],
          ["calendar", "Calendar", null],
          ["doctors", "Doctors & fees", roster?.length ?? null],
          ["schedules", "Doctor schedules", null],
          ["settings", "Hospital profile", null],
          ["activity", "History", null],
        ] as [Tab, string, number | null][]).map(([k, label, n]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            {n ? <span className={`count ${k === "appointments" ? "hot" : ""}`}>{n}</span> : null}
          </button>
        ))}
      </div>

      {error && <div style={{ marginBottom: 16 }}><ErrorBox message={error} onRetry={load} /></div>}

      {appts === null || stats === null || roster === null ? <Skeletons /> : (
        <>
          {tab === "overview" && <Overview stats={stats} all={all} tz={tz} money={money} actions={actions} goDoctors={() => setTab("doctors")} />}
          {tab === "appointments" && <Appointments all={all} roster={roster} tz={tz} actions={actions} />}
          {tab === "calendar" && <CalendarView all={all} tz={tz} onOpen={actions.open} />}
          {tab === "doctors" && <Doctors roster={roster} currency={currency} tz={tz} onChanged={load} onSchedule={(id) => { setScheduleFor(id); setTab("schedules"); }} />}
          {tab === "schedules" && <Schedules roster={roster} hospitalName={hospital?.name ?? "this hospital"} initial={scheduleFor} onSaved={load} goDoctors={() => setTab("doctors")} />}
          {tab === "settings" && hospital && <Settings hospital={hospital} onSaved={(h) => { setHospital(h); load(); }} />}
          {tab === "activity" && (audit === null ? <Skeletons /> : <AuditList entries={audit} tz={tz} />)}
        </>
      )}

      {selected && !declining && <Detail a={selected} tz={tz} actions={actions} onClose={() => setSelectedId(null)} />}
      {declining && <DeclineModal {...declining} tz={tz} onClose={() => setDeclining(null)} onDone={() => { setSelectedId(null); load(); }} />}
    </div>
  );
}

interface Actions {
  open: (a: Appointment) => void;
  confirm: (a: Appointment) => void;
  decline: (a: Appointment) => void;
  cancel: (a: Appointment) => void;
}

function Overview({ stats, all, tz, money, actions, goDoctors }: { stats: Stats; all: Appointment[]; tz: Zone; money: (n: number) => string; actions: Actions; goDoctors: () => void }) {
  const todayKey = localDateKey(new Date(), tz);
  const today = all.filter((a) => HELD.includes(a.status) && localDateKey(a.start_utc, tz) === todayKey);
  const maxDay = Math.max(1, ...stats.next_7_days.map((d) => d.count));
  const rev = (d: DoctorStats) => d.revenue_booked + d.revenue_earned;
  const maxRev = Math.max(1, ...stats.by_doctor.map(rev));
  const t = stats.totals;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="grid grid-4">
        <div className="stat"><div className="small muted">Earned this month</div><div className="n">{money(t.revenue_month)}</div><div className="tiny muted">Completed, confirmed visits</div></div>
        <div className="stat"><div className="small muted">Booked (upcoming)</div><div className="n">{money(t.revenue_booked)}</div><div className="tiny muted">{t.upcoming} confirmed appointment{t.upcoming === 1 ? "" : "s"}</div></div>
        <div className="stat"><div className="small muted">In the pipeline</div><div className="n">{money(t.revenue_pipeline)}</div><div className="tiny muted">{t.requests} open request{t.requests === 1 ? "" : "s"}</div></div>
        <div className="stat"><div className="small muted">Cancelled / declined</div><div className="n">{t.cancelled}</div><div className="tiny muted">All time</div></div>
      </div>

      <div className="doc-overview">
        <section className="card">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h3>Doctor performance</h3>
            <span className="tiny muted">Revenue uses the fee saved on each booking</span>
          </div>
          {stats.by_doctor.length === 0 ? (
            <Empty title="No doctors yet"><button className="btn btn-dark btn-sm" style={{ marginTop: 10 }} onClick={goDoctors}>Add doctors</button></Empty>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table perf">
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th className="num">Upcoming</th>
                    <th className="num">Requests</th>
                    <th className="num">Completed</th>
                    <th className="num">Cancelled</th>
                    <th style={{ minWidth: 180 }}>Revenue (booked + earned)</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_doctor.map((d) => (
                    <tr key={d.doctor_id}>
                      <td>
                        <strong>Dr. {d.name}</strong>
                        <div className="tiny muted">{d.specialization}{d.on_roster ? "" : " · no longer on roster"}</div>
                      </td>
                      <td className="num">{d.upcoming}</td>
                      <td className="num">{d.requests}</td>
                      <td className="num">{d.completed}</td>
                      <td className="num">{d.cancelled}</td>
                      <td>
                        <div className="inline-bar" title={`Booked ${money(d.revenue_booked)} · Earned ${money(d.revenue_earned)} · Pipeline ${money(d.revenue_pipeline)}`}>
                          <span style={{ width: `${(rev(d) / maxRev) * 100}%` }} />
                        </div>
                        <div className="small"><strong>{money(rev(d))}</strong> <span className="tiny muted">+ {money(d.revenue_pipeline)} pending</span></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="stack" style={{ gap: 16 }}>
          <div className="card" style={{ padding: 18 }}>
            <strong className="small">Appointments · next 7 days</strong>
            <div className="bars" role="img" aria-label={stats.next_7_days.map((d) => `${fmtKey(d.date, { weekday: "short" })} ${d.count}`).join(", ")}>
              {stats.next_7_days.map((d) => (
                <div key={d.date} className="bar-col">
                  <div className="bar-track">
                    <div className="bar" style={{ height: `${(d.count / maxDay) * 100}%` }} data-tip={`${fmtKey(d.date, { weekday: "long", day: "numeric", month: "short" })}: ${d.count} appointment${d.count === 1 ? "" : "s"}`} />
                  </div>
                  <span className="tiny muted">{fmtKey(d.date, { weekday: "narrow" })}</span>
                </div>
              ))}
            </div>
            <div className="tiny muted">Requests and confirmed visits at this hospital. Hover a bar for the count.</div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <strong className="small">Today at the hospital</strong>
            {today.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>Nothing scheduled today.</p> : (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                {today.map((a) => (
                  <button key={a.id} className={`agenda-item ${a.status}`} onClick={() => actions.open(a)}>
                    <div className="agenda-time"><strong>{fmtTime(a.start_utc, tz)}</strong></div>
                    <div className="grow" style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 600 }}>{a.patient.name}</div>
                      <div className="tiny muted">Dr. {a.doctor.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Appointments({ all, roster, tz, actions }: { all: Appointment[]; roster: RosterDoctor[]; tz: Zone; actions: Actions }) {
  const [doctor, setDoctor] = useState("");
  const [status, setStatus] = useState("open");
  const now = new Date();
  const rows = all
    .filter((a) => !doctor || String(a.doctor.id) === doctor)
    .filter((a) =>
      status === "open" ? isOpen(a)
      : status === "pending" ? a.status === "pending" && isOpen(a)
      : status === "past" ? new Date(a.end_utc) <= now && a.status === "confirmed"
      : status === "closed" ? a.status === "cancelled" || a.status === "declined"
      : true
    );
  const ordered = status === "past" || status === "closed" ? [...rows].reverse() : rows;

  return (
    <div className="stack">
      <div className="alert alert-ok small">
        🔒 Front-desk view: you see who is booked, when and where. Patients&apos; medical notes and uploaded reports are visible only to their doctor.
      </div>
      <div className="row">
        <select className="select" style={{ width: 220 }} value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>
          {roster.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
        </select>
        <div className="segmented">
          {[["open", "Upcoming"], ["pending", "Requests"], ["past", "Completed"], ["closed", "Cancelled"], ["all", "All"]].map(([k, l]) => (
            <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      {ordered.length === 0 ? (
        <Empty title="No appointments here">Bookings at your hospital appear as soon as patients request a slot with one of your doctors.</Empty>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table appt-table">
            <thead>
              <tr><th>When ({tzAbbr(now, tz)})</th><th>Patient</th><th>Doctor</th><th>Type</th><th className="num">Fee</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {ordered.map((a) => (
                <tr key={a.id} onClick={() => actions.open(a)} style={{ cursor: "pointer" }}>
                  <td><strong>{fmtTime(a.start_utc, tz)}</strong><div className="tiny muted">{fmtKey(localDateKey(a.start_utc, tz), { weekday: "short", day: "numeric", month: "short" })}</div></td>
                  <td>{a.patient.name}<div className="tiny muted">{a.patient.email} · their time {fmtTime(a.start_utc, a.patient.timezone)} {tzAbbr(a.start_utc, a.patient.timezone)}</div></td>
                  <td>Dr. {a.doctor.name}<div className="tiny muted">{a.doctor.specialization}</div></td>
                  <td>{a.mode === "online" ? "Video" : "In person"}</td>
                  <td className="num">{fmtMoney(a.fee)}</td>
                  <td><StatusChip status={a.status} past={new Date(a.end_utc) <= now} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      {a.can_confirm && <button className="btn btn-dark btn-sm" onClick={() => actions.confirm(a)}>Confirm</button>}
                      {a.can_decline && <button className="btn btn-danger btn-sm" onClick={() => actions.decline(a)}>Decline</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CalendarView({ all, tz, onOpen }: { all: Appointment[]; tz: Zone; onOpen: (a: Appointment) => void }) {
  const todayKey = localDateKey(new Date(), tz);
  const [week, setWeek] = useState(mondayOf(todayKey));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between">
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, -7))}>‹ Prev</button>
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(mondayOf(todayKey))}>This week</button>
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, 7))}>Next ›</button>
          <strong style={{ marginLeft: 6 }}>{fmtKey(week, { day: "numeric", month: "short" })} – {fmtKey(addDays(week, 6), { day: "numeric", month: "short", year: "numeric" })}</strong>
        </div>
        <span className="tiny muted">All doctors · {tz}</span>
      </div>
      <WeekCalendar tz={tz} weekStart={week} appts={all.filter((a) => HELD.includes(a.status))} blocks={[]} hours={[]} hospitalOrder={[]} onSelect={onOpen} />
      <div className="row small" style={{ gap: 16 }}>
        <span className="row" style={{ gap: 6 }}><span className="legend-box confirmed" />Confirmed</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box pending" />Request</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box proposed" />Doctor proposed a time</span>
      </div>
    </div>
  );
}

function Doctors({ roster, currency, tz, onChanged, onSchedule }: { roster: RosterDoctor[]; currency: string; tz: Zone; onChanged: () => void; onSchedule: (id: number) => void }) {
  const { toast } = useApp();
  const [directory, setDirectory] = useState<Doctor[]>([]);
  const [pick, setPick] = useState("");
  const [fee, setFee] = useState(60);
  const [fees, setFees] = useState<Record<number, number>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    api<Doctor[]>(`/doctors?tz=${encodeURIComponent(tz)}`).then(setDirectory).catch(() => setDirectory([]));
  }, [tz]);
  useEffect(() => setFees(Object.fromEntries(roster.map((d) => [d.id, d.fee]))), [roster]);

  const available = directory.filter((d) => !roster.some((r) => r.id === d.id));

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return setError("Choose a doctor to add.");
    setError("");
    try {
      await api("/hospital/doctors", { method: "POST", body: { doctor_id: Number(pick), fee } });
      toast("Doctor added. Set their hours here under Doctor schedules.");
      setPick("");
      onChanged();
      onSchedule(Number(pick));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const saveFee = async (d: RosterDoctor) => {
    try {
      await api(`/hospital/doctors/${d.id}`, { method: "PATCH", body: { fee: fees[d.id] } });
      toast(`Fee for Dr. ${d.name} is now ${fmtMoney({ amount: fees[d.id], currency })}. Existing bookings keep their original fee.`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const remove = async (d: RosterDoctor) => {
    if (!window.confirm(`Remove Dr. ${d.name} from your roster? Their hours here stop; existing bookings are kept.`)) return;
    try {
      const r = await api<{ upcoming_kept: number }>(`/hospital/doctors/${d.id}`, { method: "DELETE" });
      toast(`Dr. ${d.name} removed.${r.upcoming_kept ? ` ${r.upcoming_kept} upcoming booking(s) remain — review them under Appointments.` : ""}`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <form className="card stack" onSubmit={add}>
        <h3>Add a doctor to your roster</h3>
        <p style={{ marginTop: 0 }}>Doctors need a SlotZero doctor account. Set the in-person fee your hospital charges ({currency}).</p>
        <div className="row">
          <select className="select grow" style={{ minWidth: 220 }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Doctor">
            <option value="">{available.length ? "Choose a doctor…" : "All doctors are already on your roster"}</option>
            {available.map((d) => <option key={d.id} value={d.id}>Dr. {d.name} · {d.specialization} · {d.timezone}</option>)}
          </select>
          <input type="number" className="input" style={{ width: 130 }} min={0} value={fee} onChange={(e) => setFee(Math.max(0, Number(e.target.value) || 0))} aria-label={`Fee in ${currency}`} />
          <button className="btn btn-dark" disabled={!pick}>Add doctor</button>
        </div>
        {error && <div className="alert alert-error small">{error}</div>}
      </form>

      {roster.length === 0 ? (
        <Empty title="No doctors on your roster yet">Add a doctor above, then assign their weekly hours at your hospital.</Empty>
      ) : (
        <div className="grid grid-2">
          {roster.map((d) => (
            <div key={d.id} className="card stack" style={{ gap: 10 }}>
              <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <div className="avatar">{d.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
                <div className="grow">
                  <h3>Dr. {d.name}</h3>
                  <div className="small muted">{d.specialization} · {d.slot_minutes}-min slots</div>
                  <div className="tiny muted">{d.email} · {d.timezone}</div>
                </div>
              </div>
              <div className="small">
                {d.hours.length ? (
                  <>Here: {d.hours.map((h) => `${WEEKDAYS[h.weekday]} ${h.start}–${h.end}`).join(", ")}</>
                ) : (
                  <span className="chip chip-warn">No hours at your hospital yet</span>
                )}
              </div>
              <div className="row">
                <label className="small" htmlFor={`fee-${d.id}`}>In-person fee</label>
                <input id={`fee-${d.id}`} type="number" min={0} className="input" style={{ width: 110 }} value={fees[d.id] ?? d.fee} onChange={(e) => setFees({ ...fees, [d.id]: Math.max(0, Number(e.target.value) || 0) })} />
                <span className="small muted">{currency}</span>
                {fees[d.id] !== d.fee && <button className="btn btn-outline btn-sm" onClick={() => saveFee(d)}>Save fee</button>}
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn-danger btn-sm" onClick={() => remove(d)}>Remove</button>
                <button className="btn btn-dark btn-sm" onClick={() => onSchedule(d.id)}>Edit hours</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Range = { start: string; end: string };

function Schedules({ roster, hospitalName, initial, onSaved, goDoctors }: { roster: RosterDoctor[]; hospitalName: string; initial: number | null; onSaved: () => void; goDoctors: () => void }) {
  const { toast } = useApp();
  const [docId, setDocId] = useState<number | null>(initial ?? roster[0]?.id ?? null);
  const doc = roster.find((d) => d.id === docId) || null;
  const [days, setDays] = useState<Range[][]>(Array.from({ length: 7 }, () => []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!doc) return;
    const d: Range[][] = Array.from({ length: 7 }, () => []);
    doc.hours.forEach((h) => d[h.weekday].push({ start: h.start, end: h.end }));
    setDays(d);
    setError("");
  }, [doc]);

  const grid = useMemo(() => roster.map((d) => ({ d, byDay: WEEKDAYS.map((_, wd) => d.hours.filter((h) => h.weekday === wd)) })), [roster]);

  if (!roster.length) return <Empty title="No doctors yet"><button className="btn btn-dark btn-sm" style={{ marginTop: 10 }} onClick={goDoctors}>Add a doctor</button></Empty>;

  const update = (wd: number, fn: (r: Range[]) => Range[]) => setDays((d) => d.map((r, i) => (i === wd ? fn(r) : r)));

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ affected_appointments: Appointment[] }>(`/hospital/doctors/${doc.id}/hours`, {
        method: "PUT",
        body: { hours: days.flatMap((rs, wd) => rs.map((x) => ({ weekday: wd, ...x }))) },
      });
      toast(`Dr. ${doc.name}'s hours at ${hospitalName} saved. Patients see the new slots now.`);
      if (r.affected_appointments.length) toast(`${r.affected_appointments.length} existing booking(s) now fall outside these hours — they were kept.`, "error");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card" style={{ overflowX: "auto" }}>
        <h3 style={{ marginBottom: 10 }}>Week at a glance</h3>
        <table className="table roster-grid">
          <thead><tr><th>Doctor</th>{WEEKDAYS.map((w) => <th key={w}>{w}</th>)}</tr></thead>
          <tbody>
            {grid.map(({ d, byDay }) => (
              <tr key={d.id} className={d.id === docId ? "sel" : ""} onClick={() => setDocId(d.id)} style={{ cursor: "pointer" }}>
                <td><strong>Dr. {d.name}</strong><div className="tiny muted">{d.specialization}</div></td>
                {byDay.map((hs, wd) => (
                  <td key={wd}>{hs.length ? hs.map((h) => <span key={h.start} className="shift">{h.start}–{h.end}</span>) : <span className="tiny muted">—</span>}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {doc && (
        <section className="card">
          <div className="row between">
            <div>
              <h3>Dr. {doc.name} at {hospitalName}</h3>
              <p>Times are Dr. {doc.name.split(" ")[0]}&apos;s local time (<strong>{doc.timezone}</strong>). Their commitments elsewhere are shown in grey — the server rejects any overlap.</p>
            </div>
            <select className="select" style={{ width: 220 }} value={docId ?? ""} onChange={(e) => setDocId(Number(e.target.value))} aria-label="Doctor">
              {roster.map((d) => <option key={d.id} value={d.id}>Dr. {d.name}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 12 }}>
            {WEEKDAYS.map((name, wd) => (
              <div key={name} className="hours-row">
                <strong style={{ paddingTop: 10 }}>{name}</strong>
                <div className="ranges">
                  {doc.other_hours.filter((o) => o.weekday === wd).map((o, i) => (
                    <span key={`o${i}`} className="busy-elsewhere">{o.start}–{o.end} · {o.where}</span>
                  ))}
                  {days[wd].map((r, i) => (
                    <div key={i} className="range">
                      <input type="time" className="input" value={r.start} step={900} onChange={(e) => update(wd, (rs) => rs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label={`${name} start`} />
                      <span className="muted">to</span>
                      <input type="time" className="input" value={r.end} step={900} onChange={(e) => update(wd, (rs) => rs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label={`${name} end`} />
                      <button className="btn btn-danger btn-sm" onClick={() => update(wd, (rs) => rs.filter((_, j) => j !== i))}>Remove</button>
                    </div>
                  ))}
                  <div><button className="btn btn-outline btn-sm" onClick={() => update(wd, (rs) => [...rs, { start: "09:00", end: "12:00" }])}>+ Add shift</button></div>
                </div>
              </div>
            ))}
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn btn-dark btn-lg" disabled={busy} onClick={save}>{busy && <span className="spinner" />} Save hours</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Settings({ hospital, onSaved }: { hospital: Hospital; onSaved: (h: Hospital) => void }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ name: hospital.name, city: hospital.city, address: hospital.address, phone: hospital.phone || "" });
  const [error, setError] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const h = await api<Hospital>("/hospital/me", { method: "PUT", body: form });
      toast("Hospital profile saved.");
      onSaved(h);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form className="card stack" style={{ maxWidth: 640 }} onSubmit={save}>
      <h3>Hospital profile</h3>
      <p style={{ marginTop: 0 }}>Patients see the name on every slot and appointment at your hospital.</p>
      <div className="field"><label htmlFor="hn">Name</label><input id="hn" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
      <div className="grid grid-2">
        <div className="field"><label htmlFor="hc">City</label><input id="hc" className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
        <div className="field"><label htmlFor="hp">Phone</label><input id="hp" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
      </div>
      <div className="field"><label htmlFor="ha">Address</label><input id="ha" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
      <div className="small muted">Time zone {hospital.timezone} · billing currency {hospital.currency}</div>
      {error && <div className="alert alert-error">{error}</div>}
      <div><button className="btn btn-dark">Save profile</button></div>
    </form>
  );
}

function Detail({ a, tz, actions, onClose }: { a: Appointment; tz: Zone; actions: Actions; onClose: () => void }) {
  const past = new Date(a.end_utc) <= new Date();
  return (
    <Modal title={`${a.patient.name} with Dr. ${a.doctor.name}`} subtitle={`${a.patient.email} · ${a.doctor.specialization}`} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <StatusChip status={a.status} past={past} />
          <LocationChip a={a} />
          {a.fee && <span className="chip chip-gray">{fmtMoney(a.fee)}</span>}
        </div>
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div><div className="tiny muted">Hospital time</div><strong>{fmtDateTime(a.start_utc, tz)}</strong></div>
          <div><div className="tiny muted">Patient&apos;s time</div><strong>{fmtDateTime(a.start_utc, a.patient.timezone)}</strong></div>
          <div><div className="tiny muted">Doctor&apos;s time</div><strong>{fmtDateTime(a.start_utc, a.doctor.timezone)}</strong></div>
        </div>
        <div className="note-box small muted">
          🔒 Medical note and {a.attachment_count ?? 0} shared document{a.attachment_count === 1 ? "" : "s"} are visible to Dr. {a.doctor.name} only.
        </div>
        <div className="row" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {a.can_decline && <button className="btn btn-danger btn-sm" onClick={() => actions.decline(a)}>Decline</button>}
          {a.can_cancel && <button className="btn btn-danger btn-sm" onClick={() => actions.cancel(a)}>Cancel appointment</button>}
          {a.can_confirm && <button className="btn btn-dark btn-sm" onClick={() => actions.confirm(a)}>Confirm</button>}
        </div>
      </div>
    </Modal>
  );
}

function DeclineModal({ appt, kind, tz, onClose, onDone }: { appt: Appointment; kind: "decline" | "cancel"; tz: Zone; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/appointments/${appt.id}/${kind}`, { method: "POST", body: { reason } });
      toast(kind === "decline" ? "Request declined — the slot is open again." : "Appointment cancelled.");
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={kind === "decline" ? `Decline ${appt.patient.name}'s request?` : `Cancel ${appt.patient.name}'s appointment?`} subtitle={`Dr. ${appt.doctor.name} · ${fmtDateTime(appt.start_utc, tz)}`} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="r">Message to the patient</label>
          <input id="r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The doctor is unavailable — please choose another time" maxLength={300} />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Back</button>
          <button className="btn btn-dark" style={{ background: "var(--danger)" }} disabled={busy} onClick={submit}>{busy && <span className="spinner" />} {kind === "decline" ? "Decline request" : "Cancel appointment"}</button>
        </div>
      </div>
    </Modal>
  );
}
