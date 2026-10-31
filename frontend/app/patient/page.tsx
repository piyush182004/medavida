"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HELD, api, errorMessage, fmtMoney, type Appointment, type AuditEntry, type Doctor, type Hospital, type Prescription, type Slot, type Zone } from "@/lib/api";
import { WEEKDAYS, fmtDate, fmtDateTime, fmtLongDate, fmtTime, newKey, relative, tzAbbr } from "@/lib/time";
import { useApp } from "@/components/Providers";
import { AuditList, Empty, ErrorBox, Modal, Skeletons, useRequireRole } from "@/components/ui";
import { SlotPicker } from "@/components/SlotPicker";
import { PharmacyFinder, PrescriptionCard } from "@/components/Medicine";
import { FilePicker, FilesModal, LocationChip, StatusChip, uploadAll } from "@/components/AppointmentBits";
import { IconCalendar, IconVideo } from "@/components/Icons";

type Tab = "overview" | "book" | "prescriptions" | "pharmacies" | "activity";

export default function PatientPage() {
  return (
    <Suspense>
      <PatientDashboard />
    </Suspense>
  );
}

const isOpen = (a: Appointment) => HELD.includes(a.status) && new Date(a.end_utc) > new Date();

function PatientDashboard() {
  const session = useRequireRole("patient");
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [rx, setRx] = useState<Prescription[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/patient?tab=${t}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const [a, p, l] = await Promise.all([
        api<Appointment[]>("/appointments/mine"),
        api<Prescription[]>("/prescriptions/mine"),
        api<AuditEntry[]>("/audit/mine"),
      ]);
      setAppts(a);
      setRx(p);
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
  const tz = session.user.timezone;
  const openCount = appts?.filter(isOpen).length ?? 0;
  const proposals = appts?.filter((a) => a.status === "proposed" && isOpen(a)).length ?? 0;

  return (
    <div className="container dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">Patient dashboard</div>
          <h1>Hi {session.user.name.split(" ")[0]} 👋</h1>
          <p className="muted small">
            All times in <strong>{tz}</strong> ({tzAbbr(new Date(), tz)}) unless labelled otherwise.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setTab("book")}>
          <IconCalendar size={18} /> Request an appointment
        </button>
      </div>

      <div className="tabs" role="tablist">
        {([
          ["overview", "My appointments", openCount],
          ["book", "Find a doctor", null],
          ["prescriptions", "Prescriptions", rx?.length ?? null],
          ["pharmacies", "Nearby pharmacies", null],
          ["activity", "History", null],
        ] as [Tab, string, number | null][]).map(([k, label, n]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            {n ? <span className="count">{n}</span> : null}
          </button>
        ))}
      </div>

      {error && <div style={{ marginBottom: 16 }}><ErrorBox message={error} onRetry={load} /></div>}
      {proposals > 0 && tab !== "overview" && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          A doctor proposed a new time — <button className="btn btn-sm" style={{ background: "none", textDecoration: "underline", padding: 0 }} onClick={() => setTab("overview")}>review it</button>.
        </div>
      )}

      {tab === "overview" && <Overview appts={appts} tz={tz} reload={load} goBook={() => setTab("book")} />}
      {tab === "book" && <BookFlow tz={tz} onBooked={() => { load(); setTab("overview"); }} />}
      {tab === "prescriptions" &&
        (rx === null ? <Skeletons /> : rx.length === 0 ? (
          <Empty title="No prescriptions yet">When a doctor prescribes medicines after your consultation, they show up here with links to real pharmacies.</Empty>
        ) : (
          <div className="stack">{rx.map((p) => <PrescriptionCard key={p.id} rx={p} tz={tz} viewer="patient" />)}</div>
        ))}
      {tab === "pharmacies" && <PharmacyFinder />}
      {tab === "activity" && (audit === null ? <Skeletons /> : <AuditList entries={audit} tz={tz} />)}
    </div>
  );
}

function Overview({ appts, tz, reload, goBook }: { appts: Appointment[] | null; tz: Zone; reload: () => void; goBook: () => void }) {
  const { toast } = useApp();
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [filesFor, setFilesFor] = useState<number | null>(null);
  if (appts === null) return <Skeletons />;

  const open = appts.filter(isOpen);
  const proposed = open.filter((a) => a.status === "proposed");
  const rest = open.filter((a) => a.status !== "proposed");
  const past = appts.filter((a) => !isOpen(a)).reverse();
  const next = rest[0];
  const filesAppt = appts.find((a) => a.id === filesFor) || null;

  const accept = async (a: Appointment) => {
    try {
      await api(`/appointments/${a.id}/accept`, { method: "POST" });
      toast(`Confirmed for ${fmtDateTime(a.start_utc, tz)}.`);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handlers = { onCancel: setCancelling, onReschedule: setRescheduling, onFiles: (a: Appointment) => setFilesFor(a.id) };

  return (
    <div className="stack" style={{ gap: 24 }}>
      {proposed.map((a) => (
        <div key={a.id} className="card proposal">
          <div className="row between">
            <div>
              <div className="eyebrow" style={{ color: "#2b5cb8" }}>Dr. {a.doctor.name} proposed a new time</div>
              <h3 style={{ marginTop: 6, fontSize: "1.3rem" }}>{fmtDateTime(a.start_utc, tz)}</h3>
              <div className="small muted">Doctor&apos;s time: {fmtDateTime(a.start_utc, a.doctor.timezone)} · <LocationChip a={a} /></div>
              {a.doctor_note && <p className="small" style={{ marginTop: 8, color: "var(--text)" }}>“{a.doctor_note}”</p>}
            </div>
            <div className="row">
              <button className="btn btn-outline" onClick={() => setCancelling(a)}>Decline</button>
              <button className="btn btn-dark" onClick={() => accept(a)}>Accept new time</button>
            </div>
          </div>
        </div>
      ))}

      {next ? (
        <div className="next-card">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="eyebrow">Next appointment · {relative(next.start_utc)}</span>
              <StatusChip status={next.status} />
            </div>
            <div className="big" style={{ marginTop: 8 }}>
              {fmtTime(next.start_utc, tz)} <span style={{ fontSize: "1.2rem", color: "var(--teal)" }}>{tzAbbr(next.start_utc, tz)}</span>
            </div>
            <div className="sub">{fmtLongDate(next.start_utc, tz)} · your time ({tz})</div>
            {next.status === "pending" && (
              <p className="small" style={{ color: "#f2d48a", marginTop: 8 }}>Waiting for Dr. {next.doctor.name} to confirm. This time is reserved for you meanwhile.</p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              {next.meeting_url && (
                <a className="btn btn-primary" href={next.meeting_url} target="_blank" rel="noopener noreferrer">
                  <IconVideo size={18} /> Join video call
                </a>
              )}
              <button className="btn btn-ghost-dark" onClick={() => setFilesFor(next.id)}>
                Share reports{next.attachments.length ? ` (${next.attachments.length})` : ""}
              </button>
              {next.can_reschedule && <button className="btn btn-ghost-dark" onClick={() => setRescheduling(next)}>Reschedule</button>}
              <button className="btn btn-ghost-dark" onClick={() => setCancelling(next)}>{next.status === "pending" ? "Withdraw request" : "Cancel"}</button>
            </div>
          </div>
          <div className="other">
            <div>
              <div className="small sub">Doctor</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Dr. {next.doctor.name}</div>
              <div className="small sub">{next.doctor.specialization}</div>
            </div>
            <div>
              <div className="small sub">Doctor&apos;s local time</div>
              <div style={{ fontWeight: 600 }}>{fmtDateTime(next.start_utc, next.doctor.timezone)}</div>
              <div className="tiny sub mono">{next.doctor.timezone}</div>
            </div>
            <div>
              <div className="small sub">Where</div>
              <div style={{ fontWeight: 600 }}>{next.mode === "online" ? "Online video (Jitsi)" : next.hospital?.name}</div>
              {next.mode === "online" && !next.meeting_url && <div className="tiny sub">Video link appears once confirmed</div>}
              {next.mode === "in_person" && next.hospital?.city && <div className="tiny sub">{next.hospital.city}</div>}
              {next.fee && <div className="tiny sub">Fee {fmtMoney(next.fee)}</div>}
            </div>
          </div>
        </div>
      ) : proposed.length === 0 ? (
        <Empty title="No upcoming appointments">
          <p>Find a doctor, pick a time in your zone and send a request.</p>
          <button className="btn btn-dark" style={{ marginTop: 14 }} onClick={goBook}>Find a doctor</button>
        </Empty>
      ) : null}

      {rest.length > 1 && (
        <section>
          <h3 style={{ marginBottom: 12 }}>Upcoming</h3>
          {rest.slice(1).map((a) => <ApptRow key={a.id} a={a} tz={tz} {...handlers} />)}
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h3 style={{ marginBottom: 12 }}>Past, declined &amp; cancelled</h3>
          {past.map((a) => <ApptRow key={a.id} a={a} tz={tz} onFiles={handlers.onFiles} />)}
        </section>
      )}

      {rescheduling && <RescheduleModal appt={rescheduling} tz={tz} onClose={() => setRescheduling(null)} onDone={reload} />}
      {cancelling && <CancelModal appt={cancelling} tz={tz} onClose={() => setCancelling(null)} onDone={reload} />}
      {filesAppt && <FilesModal appt={filesAppt} tz={tz} onClose={() => setFilesFor(null)} onChanged={reload} />}
    </div>
  );
}

function ApptRow({ a, tz, onCancel, onReschedule, onFiles }: { a: Appointment; tz: Zone; onCancel?: (a: Appointment) => void; onReschedule?: (a: Appointment) => void; onFiles?: (a: Appointment) => void }) {
  const active = isOpen(a);
  const past = new Date(a.end_utc) <= new Date();
  return (
    <div className={`appt ${a.status === "cancelled" || a.status === "declined" ? "cancelled" : ""}`}>
      <div className="when">
        <div className="t">{fmtTime(a.start_utc, tz)}</div>
        <div className="small muted">{fmtDate(a.start_utc, tz)}</div>
        <div className="tiny muted">{tzAbbr(a.start_utc, tz)}</div>
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>Dr. {a.doctor.name} <span className="muted small" style={{ fontWeight: 400 }}>· {a.doctor.specialization}</span></div>
        <div className="small muted">Doctor&apos;s time: {fmtDateTime(a.start_utc, a.doctor.timezone)} <span className="mono tiny">({a.doctor.timezone})</span></div>
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <StatusChip status={a.status} past={past} />
          <LocationChip a={a} />
          {a.fee && <span className="chip chip-gray">{fmtMoney(a.fee)}</span>}
          {a.status === "cancelled" && a.cancelled_by && <span className="chip chip-gray">by {a.cancelled_by}</span>}
          {active && !a.can_reschedule && <span className="chip chip-warn">Changes close 2h before start</span>}
        </div>
        {(a.cancel_reason || a.doctor_note) && <div className="small" style={{ marginTop: 6 }}>“{a.cancel_reason || a.doctor_note}”</div>}
      </div>
      <div className="actions">
        {a.meeting_url && active && (
          <a className="btn btn-primary btn-sm" href={a.meeting_url} target="_blank" rel="noopener noreferrer"><IconVideo size={16} /> Join</a>
        )}
        {onFiles && (active || a.attachments.length > 0) && (
          <button className="btn btn-outline btn-sm" onClick={() => onFiles(a)}>Files{a.attachments.length ? ` (${a.attachments.length})` : ""}</button>
        )}
        {active && onReschedule && a.can_reschedule && <button className="btn btn-outline btn-sm" onClick={() => onReschedule(a)}>Reschedule</button>}
        {active && onCancel && <button className="btn btn-danger btn-sm" onClick={() => onCancel(a)}>{a.status === "pending" ? "Withdraw" : "Cancel"}</button>}
      </div>
    </div>
  );
}

function CancelModal({ appt, tz, onClose, onDone }: { appt: Appointment; tz: Zone; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const what = appt.status === "pending" ? "Withdraw request" : appt.status === "proposed" ? "Decline proposed time" : "Cancel appointment";
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/appointments/${appt.id}/cancel`, { method: "POST", body: { reason } });
      toast("Done — the slot is free for others again.");
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${what}?`} subtitle={`Dr. ${appt.doctor.name} · ${fmtDateTime(appt.start_utc, tz)}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          {appt.status === "confirmed"
            ? "Confirmed appointments can be cancelled up to 2 hours before the start time. This can't be undone."
            : "The doctor will see that you withdrew. You can request another time any time."}
        </p>
        <div className="field">
          <label htmlFor="reason">Reason (optional)</label>
          <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Keep it</button>
          <button className="btn btn-dark" style={{ background: "var(--danger)" }} onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />} {what}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function feeFor(doctor: Doctor | undefined, slot: Slot, mode: "in_person" | "online") {
  if (!doctor?.fees) return null;
  if (mode === "online" || !slot.hospital) return doctor.fees.online;
  return doctor.fees.hospitals.find((h) => h.hospital_id === slot.hospital!.id) ?? doctor.fees.online;
}

function ModeChooser({ slot, mode, setMode, doctor }: { slot: Slot; mode: "in_person" | "online"; setMode: (m: "in_person" | "online") => void; doctor?: Doctor }) {
  const inPersonFee = slot.hospital ? feeFor(doctor, slot, "in_person") : null;
  const onlineFee = feeFor(doctor, slot, "online");
  useEffect(() => {
    if (!slot.hospital && mode === "in_person") setMode("online");
  }, [slot, mode, setMode]);
  return (
    <div className="field">
      <label>Consultation type</label>
      <div className="mode-grid">
        <button type="button" className={`mode-opt ${mode === "in_person" ? "on" : ""}`} disabled={!slot.hospital} onClick={() => setMode("in_person")}>
          <strong>In person</strong>
          <span className="tiny muted">{slot.hospital ? `At ${slot.hospital.name}` : "Not available — this time is online only"}</span>
          {inPersonFee && <span className="fee-tag">{fmtMoney(inPersonFee)}</span>}
        </button>
        <button type="button" className={`mode-opt ${mode === "online" ? "on" : ""}`} onClick={() => setMode("online")}>
          <strong>Online video</strong>
          <span className="tiny muted">Private Jitsi room · no app needed</span>
          {onlineFee && <span className="fee-tag">{fmtMoney(onlineFee)}</span>}
        </button>
      </div>
    </div>
  );
}

function RescheduleModal({ appt, tz, onClose, onDone }: { appt: Appointment; tz: Zone; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [mode, setMode] = useState<"in_person" | "online">(appt.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    setError("");
    try {
      await api(`/appointments/${appt.id}/reschedule`, { method: "POST", body: { start_utc: slot.start_utc, mode } });
      toast(`Change requested: ${fmtDateTime(slot.start_utc, tz)}. Dr. ${appt.doctor.name} will confirm.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSlot(null);
      setRefresh((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Request a new time" subtitle={`Currently ${fmtDateTime(appt.start_utc, tz)} with Dr. ${appt.doctor.name}. If the new time isn't available, your current appointment stays exactly as it is. The new time goes to the doctor for confirmation.`} onClose={onClose}>
      <div className="stack">
        <SlotPicker doctor={appt.doctor} viewerTz={tz} selected={slot} onSelect={setSlot} refreshKey={refresh} />
        {slot && <ModeChooser slot={slot} mode={mode} setMode={setMode} />}
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          <button className="btn btn-dark" disabled={!slot || busy} onClick={submit}>
            {busy && <span className="spinner" />} {slot ? `Request ${fmtTime(slot.start_utc, tz)}` : "Pick a new time"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BookFlow({ tz, onBooked }: { tz: Zone; onBooked: () => void }) {
  const [q, setQ] = useState("");
  const [spec, setSpec] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [availableOn, setAvailableOn] = useState("");
  const [specs, setSpecs] = useState<string[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<Doctor | null>(null);

  useEffect(() => {
    api<string[]>("/doctors/specializations").then(setSpecs).catch(() => setSpecs([]));
    api<Hospital[]>("/hospitals").then(setHospitals).catch(() => setHospitals([]));
  }, []);

  const search = useCallback(async () => {
    setDoctors(null);
    setError("");
    const p = new URLSearchParams({ tz });
    if (q.trim()) p.set("q", q.trim());
    if (spec) p.set("specialization", spec);
    if (hospitalId) p.set("hospital_id", hospitalId);
    if (availableOn) p.set("available_on", availableOn);
    try {
      setDoctors(await api<Doctor[]>(`/doctors?${p}`));
    } catch (e) {
      setError(errorMessage(e));
      setDoctors([]);
    }
  }, [q, spec, hospitalId, availableOn, tz]);

  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card" style={{ padding: 16 }}>
        <div className="grid grid-4">
          <div className="field">
            <label htmlFor="q">Doctor name</label>
            <input id="q" className="input" placeholder="e.g. Meera" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="spec">Specialization</label>
            <select id="spec" className="select" value={spec} onChange={(e) => setSpec(e.target.value)}>
              <option value="">All specializations</option>
              {specs.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="hosp">Hospital / clinic</label>
            <select id="hosp" className="select" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              <option value="">Any location</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}{h.city ? ` · ${h.city}` : ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="av">Available on (your date)</label>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input id="av" type="date" className="input" value={availableOn} onChange={(e) => setAvailableOn(e.target.value)} />
              {availableOn && <button className="btn btn-outline btn-sm" onClick={() => setAvailableOn("")}>Clear</button>}
            </div>
          </div>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={search} />}
      {doctors === null ? (
        <Skeletons />
      ) : doctors.length === 0 ? (
        <Empty title="No doctors match">Try clearing a filter or choosing another date.</Empty>
      ) : (
        <div className="grid grid-2">
          {doctors.map((d) => <DoctorCard key={d.id} d={d} tz={tz} onBook={() => setChosen(d)} />)}
        </div>
      )}
      {chosen && <BookModal doctor={chosen} tz={tz} onClose={() => setChosen(null)} onBooked={onBooked} />}
    </div>
  );
}

function weekSummary(d: Doctor) {
  const byDay = new Map<number, string[]>();
  d.hours.forEach((h) => byDay.set(h.weekday, [...(byDay.get(h.weekday) || []), `${h.start}–${h.end} ${h.hospital_name ?? "Online"}`]));
  return WEEKDAYS.map((name, wd) => ({ name, ranges: byDay.get(wd) || [] }));
}

function DoctorCard({ d, tz, onBook }: { d: Doctor; tz: Zone; onBook: () => void }) {
  const initials = d.name.split(" ").map((p) => p[0]).join("").slice(0, 2);
  const [showWeek, setShowWeek] = useState(false);
  return (
    <div className="card doctor-card">
      <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <div className="avatar">{initials}</div>
        <div className="grow">
          <h3>Dr. {d.name}</h3>
          <div className="small muted">{d.specialization} · {d.slot_minutes}-min consults</div>
          <div className="tiny muted mono">{d.timezone}</div>
        </div>
      </div>
      {d.bio && <p style={{ marginTop: 0 }}>{d.bio}</p>}
      <div className="fee-list">
        {d.fees.hospitals.filter((f) => d.hospitals.some((h) => h.id === f.hospital_id)).map((f) => (
          <div key={f.hospital_id} className="fee-row"><span>🏥 {f.name}</span><strong>{fmtMoney(f)}</strong></div>
        ))}
        {d.hours.some((h) => !h.hospital_id) && (
          <div className="fee-row"><span>💻 Online video consult</span><strong>{fmtMoney(d.fees.online)}</strong></div>
        )}
      </div>
      <button className="btn btn-sm" style={{ alignSelf: "flex-start", background: "none", color: "var(--teal-700)", padding: 0 }} onClick={() => setShowWeek((s) => !s)}>
        {showWeek ? "Hide weekly schedule" : "View weekly schedule"}
      </button>
      {showWeek && (
        <table className="table small">
          <tbody>
            {weekSummary(d).map((w) => (
              <tr key={w.name}>
                <th style={{ width: 50 }}>{w.name}</th>
                <td>{w.ranges.length ? w.ranges.map((r) => <div key={r}>{r}</div>) : <span className="muted">Off</span>}</td>
              </tr>
            ))}
            <tr><td colSpan={2} className="tiny muted">Times are Dr. {d.name.split(" ")[0]}&apos;s local time ({d.timezone}). Slots are shown in your time when you book.</td></tr>
          </tbody>
        </table>
      )}
      <div className="row between">
        <div className="small">
          {d.next_available_utc ? (
            <>Next free: <strong>{fmtDateTime(d.next_available_utc, tz)}</strong></>
          ) : (
            <span className="muted">No free slots in the next 14 days</span>
          )}
        </div>
        <button className="btn btn-dark btn-sm" onClick={onBook}>See times</button>
      </div>
    </div>
  );
}

function BookModal({ doctor, tz, onClose, onBooked }: { doctor: Doctor; tz: Zone; onClose: () => void; onBooked: () => void }) {
  const { toast } = useApp();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [mode, setMode] = useState<"in_person" | "online">("in_person");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // One idempotency key per chosen slot: double-clicks or retries can't create duplicates.
  const keyRef = useRef(newKey());
  const pick = (s: Slot | null) => {
    keyRef.current = newKey();
    setSlot(s);
    setError("");
  };

  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    setError("");
    try {
      const appt = await api<Appointment>("/appointments", {
        method: "POST",
        body: { doctor_id: doctor.id, start_utc: slot.start_utc, mode, reason },
        headers: { "Idempotency-Key": keyRef.current },
      });
      const failed = files.length ? await uploadAll(appt.id, files) : [];
      toast(`Request sent to Dr. ${doctor.name} for ${fmtDateTime(slot.start_utc, tz)}. You'll be notified here when it's confirmed.`);
      if (failed.length) toast(`Some files didn't upload: ${failed.join(" ")}`, "error");
      onBooked();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSlot(null);
      setRefresh((r) => r + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Request an appointment with Dr. ${doctor.name}`} subtitle={`${doctor.specialization} · ${doctor.slot_minutes} minutes · the doctor confirms or suggests another time`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <SlotPicker doctor={doctor} viewerTz={tz} selected={slot} onSelect={pick} refreshKey={refresh} />
        {error && <div className="alert alert-error">{error}</div>}
        {slot && (
          <>
            <div className="card card-mint" style={{ padding: 14 }}>
              <div className="small muted">You&apos;re requesting</div>
              <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{fmtDateTime(slot.start_utc, tz)} <span className="muted small">your time</span></div>
              {doctor.timezone !== tz && <div className="small">= {fmtDateTime(slot.start_utc, doctor.timezone)} for Dr. {doctor.name} ({doctor.timezone})</div>}
            </div>
            <ModeChooser slot={slot} mode={mode} setMode={setMode} doctor={doctor} />
            <div className="row between card" style={{ padding: "10px 14px" }}>
              <span className="small muted">Consultation fee · {mode === "online" ? "online video" : slot.hospital?.name}</span>
              <strong>{fmtMoney(feeFor(doctor, slot, mode))}</strong>
            </div>
            <div className="field">
              <label htmlFor="why">Symptoms or notes for the doctor</label>
              <textarea id="why" className="textarea" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever and sore throat for 3 days, allergic to penicillin. Shared only with your doctor." />
            </div>
            <FilePicker files={files} onChange={setFiles} />
          </>
        )}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          <button className="btn btn-dark" disabled={!slot || busy} onClick={submit}>
            {busy && <span className="spinner" />} Send request
          </button>
        </div>
      </div>
    </Modal>
  );
}
