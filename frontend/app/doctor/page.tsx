"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HELD, api, errorMessage, fmtMoney, uploadFile, type Money, type Appointment, type AuditEntry, type Hospital, type Medicine, type Prescription, type Slot, type Zone } from "@/lib/api";
import { WEEKDAYS, addDays, fmtDate, fmtDateTime, fmtKey, fmtLongDate, fmtTime, localDateKey, mondayOf, relative, tzAbbr } from "@/lib/time";
import { useApp } from "@/components/Providers";
import { AuditList, Empty, ErrorBox, Modal, Skeletons, useRequireRole } from "@/components/ui";
import { PrescriptionCard } from "@/components/Medicine";
import { SlotPicker } from "@/components/SlotPicker";
import { FileList, FilesModal, LocationChip, StatusChip } from "@/components/AppointmentBits";
import { MiniMonth, WeekCalendar, hospitalColor, type BlockLite, type HoursRange } from "@/components/Calendar";
import { IconVideo } from "@/components/Icons";
import { AiText, VisitBrief, useAiEnabled } from "@/components/AI";

type Tab = "overview" | "calendar" | "requests" | "schedule" | "timeoff" | "prescriptions" | "activity";

interface Schedule {
  slot_minutes: number;
  specialization: string;
  bio: string;
  online_fee?: number;
  currency?: string;
  fees?: { online: Money; hospitals: (Money & { hospital_id: number; name: string })[] };
  hours: HoursRange[];
}

export default function DoctorPage() {
  return (
    <Suspense>
      <DoctorDashboard />
    </Suspense>
  );
}

const isOpen = (a: Appointment) => HELD.includes(a.status) && new Date(a.end_utc) > new Date();

function greeting(tz: Zone) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function DoctorDashboard() {
  const session = useRequireRole("doctor");
  const { toast } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>((params.get("tab") as Tab) || "overview");
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [rx, setRx] = useState<Prescription[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [blocks, setBlocks] = useState<BlockLite[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [action, setAction] = useState<{ kind: "propose" | "decline" | "cancel" | "prescribe" | "files"; appt: Appointment } | null>(null);

  const setTab = (t: Tab) => {
    setTabState(t);
    router.replace(`/doctor?tab=${t}`, { scroll: false });
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const [a, p, l, b, s, h] = await Promise.all([
        api<Appointment[]>("/appointments/mine"),
        api<Prescription[]>("/prescriptions/mine"),
        api<AuditEntry[]>("/audit/mine"),
        api<BlockLite[]>("/doctor/blocks"),
        api<Schedule>("/doctor/schedule"),
        api<Hospital[]>("/hospitals"),
      ]);
      setAppts(a);
      setRx(p);
      setAudit(l);
      setBlocks(b);
      setSchedule(s);
      setHospitals(h);
    } catch (e) {
      setError(errorMessage(e));
      setAppts((a) => a ?? []);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  const hospitalOrder = useMemo(() => hospitals.map((h) => h.id), [hospitals]);

  if (!session) return <div className="container dash"><Skeletons /></div>;
  const tz = session.user.timezone;
  const now = new Date();
  const todayKey = localDateKey(now, tz);
  const all = appts || [];
  const open = all.filter(isOpen);
  const requests = open.filter((a) => a.status === "pending" || a.status === "proposed");
  const pendingCount = open.filter((a) => a.status === "pending").length;
  const today = all.filter((a) => HELD.includes(a.status) && localDateKey(a.start_utc, tz) === todayKey);
  const weekEnd = addDays(todayKey, 7);
  const thisWeek = open.filter((a) => a.status === "confirmed" && localDateKey(a.start_utc, tz) < weekEnd);
  const warnings = open.filter((a) => a.warnings?.length);
  const selected = all.find((a) => a.id === selectedId) || null;

  const quick = async (a: Appointment, kind: "confirm") => {
    try {
      await api(`/appointments/${a.id}/${kind}`, { method: "POST" });
      toast(`Confirmed ${a.patient.name} for ${fmtDateTime(a.start_utc, tz)}.`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const ctx: RowCtx = {
    tz,
    hospitalOrder,
    onOpen: (a) => setSelectedId(a.id),
    onConfirm: (a) => quick(a, "confirm"),
    onAction: (kind, a) => setAction({ kind, appt: a }),
  };

  return (
    <div className="container dash">
      <div className="doc-hero">
        <div>
          <div className="eyebrow" style={{ color: "var(--teal)" }}>Doctor workspace</div>
          <h1>{greeting(tz)}, Dr. {session.user.name.split(" ")[0]}</h1>
          <p className="small" style={{ color: "#b9c6c7" }}>{fmtLongDate(now, tz)} · {tz} ({tzAbbr(now, tz)}) · {session.user.specialization}</p>
        </div>
        <div className="doc-stats">
          <button className="doc-stat" onClick={() => setTab("requests")}>
            <span className="n" style={{ color: pendingCount ? "#f2c14e" : undefined }}>{pendingCount}</span>
            <span>New requests</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("overview")}>
            <span className="n">{today.length}</span>
            <span>Today</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("calendar")}>
            <span className="n">{thisWeek.length}</span>
            <span>Confirmed · 7 days</span>
          </button>
          <button className="doc-stat" onClick={() => setTab("schedule")}>
            <span className="n">{new Set((schedule?.hours || []).map((h) => h.hospital_id).filter(Boolean)).size}</span>
            <span>Hospitals</span>
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {([
          ["overview", "Overview", null],
          ["calendar", "Calendar", null],
          ["requests", "Requests", requests.length],
          ["schedule", "Hours & hospitals", null],
          ["timeoff", "Blocked time", null],
          ["prescriptions", "Prescriptions", rx?.length ?? null],
          ["activity", "History", null],
        ] as [Tab, string, number | null][]).map(([k, label, n]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}
            {n ? <span className={`count ${k === "requests" ? "hot" : ""}`}>{n}</span> : null}
          </button>
        ))}
      </div>

      {error && <div style={{ marginBottom: 16 }}><ErrorBox message={error} onRetry={load} /></div>}
      {warnings.length > 0 && (tab === "overview" || tab === "calendar") && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          {warnings.length} booking{warnings.length > 1 ? "s" : ""} clash with blocked time or changed hours. They are still booked — open them in the calendar to review.
        </div>
      )}

      {appts === null ? <Skeletons /> : (
        <>
          {tab === "overview" && <Overview all={all} requests={requests} ctx={ctx} goRequests={() => setTab("requests")} hospitals={hospitals} schedule={schedule} />}
          {tab === "calendar" && <CalendarTab all={all.filter((a) => HELD.includes(a.status))} blocks={blocks} schedule={schedule} hospitals={hospitals} ctx={ctx} />}
          {tab === "requests" && (
            requests.length === 0 ? (
              <Empty title="You're all caught up">New appointment requests from patients will appear here for you to confirm, move or decline.</Empty>
            ) : (
              <div className="stack">{requests.map((a) => <RequestCard key={a.id} a={a} ctx={ctx} />)}</div>
            )
          )}
          {tab === "schedule" && <ScheduleEditor tz={tz} hospitals={hospitals} onHospitals={setHospitals} onSaved={load} />}
          {tab === "timeoff" && <BlockedTime tz={tz} onChanged={load} />}
          {tab === "prescriptions" && (
            rx === null ? <Skeletons /> : rx.length === 0 ? (
              <Empty title="No prescriptions issued">Open any appointment and choose “Prescribe” to send medicines to a patient.</Empty>
            ) : (
              <div className="stack">{rx.map((p) => <PrescriptionCard key={p.id} rx={p} tz={tz} viewer="doctor" />)}</div>
            )
          )}
          {tab === "activity" && (audit === null ? <Skeletons /> : <AuditList entries={audit} tz={tz} />)}
        </>
      )}

      {selected && !action && <ApptDetail a={selected} ctx={ctx} onClose={() => setSelectedId(null)} />}
      {action?.kind === "propose" && <ProposeModal appt={action.appt} tz={tz} onClose={() => setAction(null)} onDone={load} />}
      {(action?.kind === "decline" || action?.kind === "cancel") && <DeclineModal appt={action.appt} kind={action.kind} tz={tz} onClose={() => setAction(null)} onDone={load} />}
      {action?.kind === "prescribe" && <PrescribeModal appt={action.appt} tz={tz} onClose={() => setAction(null)} onDone={load} />}
      {action?.kind === "files" && <FilesModal appt={all.find((a) => a.id === action.appt.id) || action.appt} tz={tz} onClose={() => setAction(null)} onChanged={load} />}
    </div>
  );
}

interface RowCtx {
  tz: Zone;
  hospitalOrder: number[];
  onOpen: (a: Appointment) => void;
  onConfirm: (a: Appointment) => void;
  onAction: (kind: "propose" | "decline" | "cancel" | "prescribe" | "files", a: Appointment) => void;
}

function Overview({ all, requests, ctx, goRequests, hospitals, schedule }: { all: Appointment[]; requests: Appointment[]; ctx: RowCtx; goRequests: () => void; hospitals: Hospital[]; schedule: Schedule | null }) {
  const { tz } = ctx;
  const todayKey = localDateKey(new Date(), tz);
  const [day, setDay] = useState(todayKey);
  const [month, setMonth] = useState(todayKey.slice(0, 8) + "01");
  const held = all.filter((a) => HELD.includes(a.status));
  const agenda = held.filter((a) => localDateKey(a.start_utc, tz) === day);
  const next = held.find((a) => a.status === "confirmed" && new Date(a.end_utc) > new Date());
  const used = new Set((schedule?.hours || []).map((h) => h.hospital_id));

  return (
    <div className="doc-overview">
      <div className="stack" style={{ gap: 20 }}>
        {requests.length > 0 && (
          <section className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3>Requests waiting for you</h3>
              <button className="btn btn-sm" style={{ background: "none", color: "var(--teal-700)" }} onClick={goRequests}>View all ({requests.length})</button>
            </div>
            {requests.slice(0, 3).map((a) => <CompactRequest key={a.id} a={a} ctx={ctx} />)}
          </section>
        )}
        <section>
          <div className="row between" style={{ marginBottom: 12 }}>
            <h3>{day === todayKey ? "Today's agenda" : `Agenda · ${fmtKey(day, { weekday: "long", day: "numeric", month: "long" })}`}</h3>
            {day !== todayKey && <button className="btn btn-outline btn-sm" onClick={() => { setDay(todayKey); setMonth(todayKey.slice(0, 8) + "01"); }}>Back to today</button>}
          </div>
          {agenda.length === 0 ? (
            <Empty title="Nothing scheduled">No requests or appointments on this day. Pick another day on the calendar.</Empty>
          ) : (
            <div className="agenda">
              {agenda.map((a) => <AgendaItem key={a.id} a={a} ctx={ctx} />)}
            </div>
          )}
        </section>
      </div>
      <aside className="stack" style={{ gap: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <MiniMonth tz={tz} month={month} selected={day} appts={held} onSelect={(d) => { setDay(d); setMonth(d.slice(0, 8) + "01"); }} onMonth={setMonth} />
        </div>
        {next && (
          <div className="card card-dark" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ color: "var(--teal)" }}>Next confirmed · {relative(next.start_utc)}</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, marginTop: 6 }}>{fmtTime(next.start_utc, tz)} <span className="small" style={{ color: "var(--teal)" }}>{tzAbbr(next.start_utc, tz)}</span></div>
            <div style={{ color: "#b9c6c7" }} className="small">{fmtDate(next.start_utc, tz)} · {next.patient.name}</div>
            <div className="row" style={{ marginTop: 12 }}>
              {next.meeting_url && <a className="btn btn-primary btn-sm" href={next.meeting_url} target="_blank" rel="noopener noreferrer"><IconVideo size={14} /> Join</a>}
              <button className="btn btn-ghost-dark btn-sm" onClick={() => ctx.onOpen(next)}>Details</button>
            </div>
          </div>
        )}
        <div className="card" style={{ padding: 16 }}>
          <strong className="small">Locations</strong>
          <div className="stack" style={{ gap: 6, marginTop: 10 }}>
            {hospitals.filter((h) => used.has(h.id)).map((h) => (
              <div key={h.id} className="row small" style={{ flexWrap: "nowrap" }}><span className="legend-dot" style={{ background: hospitalColor(h.id, ctx.hospitalOrder) }} />{h.name}</div>
            ))}
            <div className="row small" style={{ flexWrap: "nowrap" }}><span className="legend-dot" style={{ background: hospitalColor(null, []) }} />Online consults</div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function AgendaItem({ a, ctx }: { a: Appointment; ctx: RowCtx }) {
  const color = hospitalColor(a.mode === "online" ? null : a.hospital?.id, ctx.hospitalOrder);
  return (
    <button className={`agenda-item ${a.status}`} onClick={() => ctx.onOpen(a)} style={{ borderLeftColor: color }}>
      <div className="agenda-time">
        <strong>{fmtTime(a.start_utc, ctx.tz)}</strong>
        <span className="tiny muted">{fmtTime(a.end_utc, ctx.tz)}</span>
      </div>
      <div className="grow" style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 700 }}>{a.patient.name}</div>
        <div className="small muted">{a.mode === "online" ? "Online video" : a.hospital?.name} · patient&apos;s time {fmtTime(a.start_utc, a.patient.timezone)} {tzAbbr(a.start_utc, a.patient.timezone)}</div>
        {a.reason && <div className="small" style={{ marginTop: 2 }}>“{a.reason.length > 90 ? a.reason.slice(0, 90) + "…" : a.reason}”</div>}
      </div>
      <StatusChip status={a.status} past={new Date(a.end_utc) <= new Date()} />
    </button>
  );
}

function CompactRequest({ a, ctx }: { a: Appointment; ctx: RowCtx }) {
  return (
    <div className="compact-req">
      <div className="grow" style={{ minWidth: 0 }}>
        <div><strong>{a.patient.name}</strong> <span className="muted small">· {fmtDateTime(a.start_utc, ctx.tz)}</span></div>
        <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.reason || "No note"}</div>
      </div>
      {a.status === "pending" ? (
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <button className="btn btn-outline btn-sm" onClick={() => ctx.onOpen(a)}>Review</button>
          <button className="btn btn-dark btn-sm" onClick={() => ctx.onConfirm(a)}>Confirm</button>
        </div>
      ) : (
        <span className="chip chip-info">Awaiting patient</span>
      )}
    </div>
  );
}

function RequestCard({ a, ctx }: { a: Appointment; ctx: RowCtx }) {
  const { tz } = ctx;
  return (
    <div className="card request-card">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
          <div className="avatar">{a.patient.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
          <div>
            <h3>{a.patient.name}</h3>
            <div className="small muted">{a.patient.email} · {a.patient.timezone}</div>
          </div>
        </div>
        <StatusChip status={a.status} />
      </div>
      <div className="grid grid-3" style={{ marginTop: 14, gap: 12 }}>
        <div><div className="tiny muted">Your time</div><strong>{fmtDateTime(a.start_utc, tz)}</strong></div>
        <div><div className="tiny muted">Patient&apos;s time</div><strong>{fmtDateTime(a.start_utc, a.patient.timezone)}</strong></div>
        <div><div className="tiny muted">Where</div><LocationChip a={a} /></div>
      </div>
      <div className="note-box">
        <div className="tiny muted">Patient&apos;s note</div>
        <div>{a.reason || <span className="muted">No note provided.</span>}</div>
      </div>
      <div style={{ marginTop: 10 }}>
        <VisitBrief apptId={a.id} initial={a.ai_brief} hasMaterial={!!a.reason.trim() || a.attachments.length > 0} />
      </div>
      {a.attachments.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Shared reports ({a.attachments.length})</div>
          <FileList files={a.attachments} tz={tz} />
        </div>
      )}
      {a.status === "proposed" && a.doctor_note && <p className="small" style={{ marginTop: 10 }}>You proposed this time: “{a.doctor_note}” — waiting for the patient to accept.</p>}
      {a.warnings?.map((w) => <div key={w} className="alert alert-warn small" style={{ marginTop: 10 }}>{w}</div>)}
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        {a.can_decline && <button className="btn btn-danger btn-sm" onClick={() => ctx.onAction("decline", a)}>Decline</button>}
        {a.can_propose && <button className="btn btn-outline btn-sm" onClick={() => ctx.onAction("propose", a)}>Suggest another time</button>}
        {a.can_confirm && <button className="btn btn-dark btn-sm" onClick={() => ctx.onConfirm(a)}>Confirm appointment</button>}
      </div>
    </div>
  );
}

function CalendarTab({ all, blocks, schedule, hospitals, ctx }: { all: Appointment[]; blocks: BlockLite[]; schedule: Schedule | null; hospitals: Hospital[]; ctx: RowCtx }) {
  const { tz } = ctx;
  const todayKey = localDateKey(new Date(), tz);
  const [week, setWeek] = useState(mondayOf(todayKey));
  const used = new Set((schedule?.hours || []).map((h) => h.hospital_id));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between">
        <div className="row">
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, -7))}>‹ Prev</button>
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(mondayOf(todayKey))}>This week</button>
          <button className="btn btn-outline btn-sm" onClick={() => setWeek(addDays(week, 7))}>Next ›</button>
          <strong style={{ marginLeft: 6 }}>{fmtKey(week, { day: "numeric", month: "short" })} – {fmtKey(addDays(week, 6), { day: "numeric", month: "short", year: "numeric" })}</strong>
        </div>
        <span className="tiny muted">All times {tz} ({tzAbbr(new Date(`${week}T12:00:00Z`), tz)})</span>
      </div>
      <WeekCalendar tz={tz} weekStart={week} appts={all} blocks={blocks} hours={schedule?.hours || []} hospitalOrder={ctx.hospitalOrder} onSelect={ctx.onOpen} />
      <div className="row small" style={{ gap: 16 }}>
        {hospitals.filter((h) => used.has(h.id)).map((h) => (
          <span key={h.id} className="row" style={{ gap: 6 }}><span className="legend-dot" style={{ background: hospitalColor(h.id, ctx.hospitalOrder) }} />{h.name}</span>
        ))}
        <span className="row" style={{ gap: 6 }}><span className="legend-dot" style={{ background: hospitalColor(null, []) }} />Online</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box confirmed" />Confirmed</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box pending" />Request</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box proposed" />Proposed</span>
        <span className="row" style={{ gap: 6 }}><span className="legend-box blocked" />Blocked</span>
      </div>
    </div>
  );
}

function ApptDetail({ a, ctx, onClose }: { a: Appointment; ctx: RowCtx; onClose: () => void }) {
  const { tz } = ctx;
  const past = new Date(a.end_utc) <= new Date();
  return (
    <Modal title={a.patient.name} subtitle={`${a.patient.email} · ${a.patient.timezone}`} onClose={onClose}>
      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <StatusChip status={a.status} past={past} />
          <LocationChip a={a} />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div><div className="tiny muted">Your time</div><strong>{fmtDateTime(a.start_utc, tz)}</strong><div className="tiny muted">until {fmtTime(a.end_utc, tz)}</div></div>
          <div><div className="tiny muted">Patient&apos;s time</div><strong>{fmtDateTime(a.start_utc, a.patient.timezone)}</strong></div>
        </div>
        <div className="note-box"><div className="tiny muted">Patient&apos;s note</div><div>{a.reason || <span className="muted">No note provided.</span>}</div></div>
        <VisitBrief apptId={a.id} initial={a.ai_brief} hasMaterial={!!a.reason.trim() || a.attachments.length > 0} />
        {a.warnings?.map((w) => <div key={w} className="alert alert-warn small">{w}</div>)}
        <div>
          <div className="row between" style={{ marginBottom: 6 }}>
            <strong className="small">Reports & documents</strong>
            <button className="btn btn-sm" style={{ background: "none", color: "var(--teal-700)" }} onClick={() => ctx.onAction("files", a)}>Open / add</button>
          </div>
          <FileList files={a.attachments} tz={tz} />
        </div>
        <div className="row" style={{ justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          {a.meeting_url && !past && <a className="btn btn-primary btn-sm" href={a.meeting_url} target="_blank" rel="noopener noreferrer"><IconVideo size={14} /> Join video</a>}
          {a.status === "confirmed" && <button className="btn btn-outline btn-sm" onClick={() => ctx.onAction("prescribe", a)}>Prescribe</button>}
          {a.can_propose && <button className="btn btn-outline btn-sm" onClick={() => ctx.onAction("propose", a)}>Suggest another time</button>}
          {a.can_decline && <button className="btn btn-danger btn-sm" onClick={() => ctx.onAction("decline", a)}>Decline</button>}
          {a.can_cancel && <button className="btn btn-danger btn-sm" onClick={() => ctx.onAction("cancel", a)}>Cancel</button>}
          {a.can_confirm && <button className="btn btn-dark btn-sm" onClick={() => { ctx.onConfirm(a); onClose(); }}>Confirm</button>}
        </div>
      </div>
    </Modal>
  );
}

function ProposeModal({ appt, tz, onClose, onDone }: { appt: Appointment; tz: Zone; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const submit = async () => {
    if (!slot) return;
    setBusy(true);
    setError("");
    try {
      await api(`/appointments/${appt.id}/propose`, { method: "POST", body: { start_utc: slot.start_utc, message } });
      toast(`New time sent to ${appt.patient.name}. It's held for them until they respond.`);
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
    <Modal title={`Suggest another time to ${appt.patient.name}`} subtitle={`Requested: ${fmtDateTime(appt.start_utc, tz)}. Only your free slots are shown, so you can't clash with another patient.`} onClose={onClose}>
      <div className="stack">
        <SlotPicker doctor={appt.doctor} viewerTz={tz} selected={slot} onSelect={setSlot} refreshKey={refresh} />
        {slot && (
          <div className="card card-mint" style={{ padding: 12 }}>
            <strong>{fmtDateTime(slot.start_utc, tz)}</strong> your time · {fmtDateTime(slot.start_utc, appt.patient.timezone)} for {appt.patient.name}
            <div className="tiny muted">{slot.hospital ? `At ${slot.hospital.name}` : appt.mode === "in_person" ? "Online-only slot — the visit will become a video consult" : "Online video"}</div>
          </div>
        )}
        <div className="field">
          <label htmlFor="msg">Message to the patient</label>
          <input id="msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="e.g. I'm in surgery that morning — would this work instead?" />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
          <button className="btn btn-dark" disabled={!slot || busy} onClick={submit}>{busy && <span className="spinner" />} Send proposal</button>
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
      toast(kind === "decline" ? "Request declined — the slot is open again." : "Appointment cancelled — the patient sees it in their dashboard.");
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={kind === "decline" ? `Decline ${appt.patient.name}'s request?` : `Cancel ${appt.patient.name}'s appointment?`} subtitle={fmtDateTime(appt.start_utc, tz)} onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="r">Message to the patient</label>
          <input id="r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Please book with a dermatologist instead" maxLength={300} />
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

type Range = { start: string; end: string; hospital_id: number | null };

function ScheduleEditor({ tz, hospitals, onHospitals, onSaved }: { tz: Zone; hospitals: Hospital[]; onHospitals: (h: Hospital[]) => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [loaded, setLoaded] = useState(false);
  const [slot, setSlot] = useState(30);
  const [spec, setSpec] = useState("");
  const [bio, setBio] = useState("");
  const [onlineFee, setOnlineFee] = useState(0);
  const [currency, setCurrency] = useState("GBP");
  const [hospitalFees, setHospitalFees] = useState<(Money & { hospital_id: number; name: string })[]>([]);
  const [days, setDays] = useState<Range[][]>(Array.from({ length: 7 }, () => []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<Appointment[]>([]);
  const [newH, setNewH] = useState({ name: "", city: "", address: "" });
  const order = hospitals.map((h) => h.id);

  const apply = (s: Schedule) => {
    setSlot(s.slot_minutes);
    setSpec(s.specialization);
    setBio(s.bio);
    setOnlineFee(s.online_fee ?? 0);
    setCurrency(s.currency ?? "GBP");
    setHospitalFees(s.fees?.hospitals ?? []);
    const d: Range[][] = Array.from({ length: 7 }, () => []);
    s.hours.forEach((h) => d[h.weekday].push({ start: h.start, end: h.end, hospital_id: h.hospital_id }));
    setDays(d);
  };

  useEffect(() => {
    api<Schedule>("/doctor/schedule")
      .then((s) => {
        apply(s);
        setLoaded(true);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const update = (wd: number, fn: (r: Range[]) => Range[]) => setDays((d) => d.map((r, i) => (i === wd ? fn(r) : r)));
  const defaultHospital = days.flat().find((r) => r.hospital_id)?.hospital_id ?? hospitals[0]?.id ?? null;

  const save = async () => {
    setBusy(true);
    setError("");
    setAffected([]);
    try {
      const hours = days.flatMap((ranges, wd) => ranges.map((r) => ({ weekday: wd, ...r })));
      const res = await api<Schedule & { affected_appointments: Appointment[] }>("/doctor/schedule", {
        method: "PUT",
        body: { slot_minutes: slot, specialization: spec, bio, online_fee: onlineFee, hours },
      });
      apply(res);
      setAffected(res.affected_appointments);
      toast("Schedule saved. Patients now see your new slots.");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newH.name.trim().length < 2) return setError("Enter the hospital or clinic name.");
    try {
      const h = await api<Hospital>("/hospitals", { method: "POST", body: newH });
      const list = await api<Hospital[]>("/hospitals");
      onHospitals(list);
      setNewH({ name: "", city: "", address: "" });
      toast(`${h.name} added — assign it to any working range below.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!loaded && !error) return <Skeletons />;
  const empty = days.every((d) => d.length === 0);

  return (
    <div className="stack" style={{ gap: 20 }}>
      {empty && <div className="alert alert-warn">You have no working hours yet, so patients can&apos;t book you. Add hours below — the quick-fill button is a good start.</div>}
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h3>Profile & consult length</h3>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="len">Appointment length</label>
              <select id="len" className="select" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sp">Specialization</label>
              <input id="sp" className="input" value={spec} onChange={(e) => setSpec(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bio">Short bio (patients see this)</label>
            <input id="bio" className="input" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1000} />
          </div>
          <div className="field">
            <label htmlFor="fee">Online consult fee ({currency})</label>
            <input id="fee" type="number" min={0} className="input" value={onlineFee} onChange={(e) => setOnlineFee(Math.max(0, Number(e.target.value) || 0))} />
            <span className="hint">In-person fees are set by each hospital.</span>
          </div>
          {hospitalFees.length > 0 && (
            <div className="fee-list">
              {hospitalFees.map((f) => (
                <div key={f.hospital_id} className="fee-row"><span>🏥 {f.name} <span className="tiny muted">(set by hospital)</span></span><strong>{fmtMoney(f)}</strong></div>
              ))}
            </div>
          )}
        </div>
        <form className="card stack" onSubmit={addHospital}>
          <h3>Hospitals & clinics</h3>
          <p style={{ marginTop: 0 }}>Pick any listed location for a working range, or add one you work at.</p>
          <div className="row" style={{ gap: 6 }}>
            {hospitals.map((h) => (
              <span key={h.id} className="chip chip-gray"><span className="legend-dot" style={{ background: hospitalColor(h.id, order) }} />{h.name}{h.city ? ` · ${h.city}` : ""}</span>
            ))}
          </div>
          <div className="grid grid-2">
            <input className="input" placeholder="Hospital / clinic name" value={newH.name} onChange={(e) => setNewH({ ...newH, name: e.target.value })} />
            <input className="input" placeholder="City" value={newH.city} onChange={(e) => setNewH({ ...newH, city: e.target.value })} />
          </div>
          <button className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }}>+ Add location</button>
        </form>
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <h3>Weekly routine</h3>
            <p>Wall-clock times in <strong>{tz}</strong>. Assign each range to a hospital, or make it online-only. Daylight-saving changes are handled automatically.</p>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setDays(Array.from({ length: 7 }, (_, i) => (i < 5 ? [{ start: "09:00", end: "12:00", hospital_id: defaultHospital }, { start: "13:00", end: "17:00", hospital_id: null }] : [])))}>
            Quick fill: Mon–Fri
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {WEEKDAYS.map((name, wd) => (
            <div key={name} className="hours-row">
              <strong style={{ paddingTop: 10 }}>{name}</strong>
              <div className="ranges">
                {days[wd].length === 0 && <span className="muted small" style={{ paddingTop: 10 }}>Day off</span>}
                {days[wd].map((r, i) => (
                  <div key={i} className="range" style={{ borderLeft: `3px solid ${hospitalColor(r.hospital_id, order)}`, paddingLeft: 10 }}>
                    <input type="time" className="input" value={r.start} step={900} onChange={(e) => update(wd, (rs) => rs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label={`${name} start`} />
                    <span className="muted">to</span>
                    <input type="time" className="input" value={r.end} step={900} onChange={(e) => update(wd, (rs) => rs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label={`${name} end`} />
                    <select className="select" style={{ width: 220 }} value={r.hospital_id ?? ""} onChange={(e) => update(wd, (rs) => rs.map((x, j) => (j === i ? { ...x, hospital_id: e.target.value ? Number(e.target.value) : null } : x)))} aria-label={`${name} location`}>
                      <option value="">💻 Online only</option>
                      {hospitals.map((h) => <option key={h.id} value={h.id}>🏥 {h.name}</option>)}
                    </select>
                    <button className="btn btn-danger btn-sm" onClick={() => update(wd, (rs) => rs.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                <div className="row">
                  <button className="btn btn-outline btn-sm" onClick={() => update(wd, (rs) => [...rs, rs.length ? { start: "13:00", end: "17:00", hospital_id: rs[rs.length - 1].hospital_id } : { start: "09:00", end: "12:00", hospital_id: defaultHospital }])}>+ Add range</button>
                  {wd > 0 && days[wd - 1].length > 0 && (
                    <button className="btn btn-sm" style={{ background: "none", color: "var(--teal-700)" }} onClick={() => update(wd, () => days[wd - 1].map((r) => ({ ...r })))}>Copy {WEEKDAYS[wd - 1]}</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {affected.length > 0 && (
        <div className="alert alert-warn">
          <strong>{affected.length} existing booking{affected.length > 1 ? "s are" : " is"} now outside your hours.</strong> They have NOT been cancelled:
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {affected.map((a) => <li key={a.id}>{a.patient.name} — {fmtDateTime(a.start_utc, tz)}</li>)}
          </ul>
        </div>
      )}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-dark btn-lg" disabled={busy} onClick={save}>{busy && <span className="spinner" />} Save schedule</button>
      </div>
    </div>
  );
}

function BlockedTime({ tz, onChanged }: { tz: Zone; onChanged: () => void }) {
  const { toast } = useApp();
  const [blocks, setBlocks] = useState<BlockLite[] | null>(null);
  const [allDay, setAllDay] = useState(false);
  const today = localDateKey(new Date(), tz);
  const [form, setForm] = useState({ start: `${today}T13:00`, end: `${today}T14:00`, fromDay: today, toDay: today, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [affected, setAffected] = useState<Appointment[]>([]);

  const load = useCallback(() => {
    api<BlockLite[]>("/doctor/blocks").then(setBlocks).catch((e) => { setError(errorMessage(e)); setBlocks([]); });
  }, []);
  useEffect(load, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setAffected([]);
    const body = allDay
      ? { start_local: `${form.fromDay}T00:00`, end_local: `${addDays(form.toDay, 1)}T00:00`, reason: form.reason }
      : { start_local: form.start, end_local: form.end, reason: form.reason };
    try {
      const r = await api<{ block: BlockLite; affected_appointments: Appointment[] }>("/doctor/blocks", { method: "POST", body });
      setAffected(r.affected_appointments);
      toast("Time blocked. Those slots are no longer offered.");
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api(`/doctor/blocks/${id}`, { method: "DELETE" });
      toast("Block removed — slots are open again.");
      load();
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <form className="card stack" onSubmit={add}>
        <h3>Block time</h3>
        <p style={{ marginTop: 0 }}>Breaks, surgery, holidays. Times are in <strong>{tz}</strong>. Existing bookings are kept and flagged, never silently removed.</p>
        <div className="segmented">
          <button type="button" className={!allDay ? "on" : ""} onClick={() => setAllDay(false)}>Time range</button>
          <button type="button" className={allDay ? "on" : ""} onClick={() => setAllDay(true)}>Whole days</button>
        </div>
        {allDay ? (
          <div className="grid grid-2">
            <div className="field"><label htmlFor="fd">From</label><input id="fd" type="date" className="input" min={today} value={form.fromDay} onChange={(e) => setForm({ ...form, fromDay: e.target.value })} /></div>
            <div className="field"><label htmlFor="td">To (inclusive)</label><input id="td" type="date" className="input" min={form.fromDay} value={form.toDay} onChange={(e) => setForm({ ...form, toDay: e.target.value })} /></div>
          </div>
        ) : (
          <div className="grid grid-2">
            <div className="field"><label htmlFor="bs">Start</label><input id="bs" type="datetime-local" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            <div className="field"><label htmlFor="be">End</label><input id="be" type="datetime-local" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          </div>
        )}
        <div className="field"><label htmlFor="br">Reason (private)</label><input id="br" className="input" placeholder="Lunch, conference, holiday…" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={200} /></div>
        {error && <div className="alert alert-error">{error}</div>}
        {affected.length > 0 && (
          <div className="alert alert-warn">
            <strong>Heads up:</strong> {affected.length} booking{affected.length > 1 ? "s" : ""} fall inside this block and are still booked:
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {affected.map((a) => <li key={a.id}>{a.patient.name} — {fmtDateTime(a.start_utc, tz)}</li>)}
            </ul>
            Open them in the calendar to move or cancel.
          </div>
        )}
        <button className="btn btn-dark" disabled={busy}>{busy && <span className="spinner" />} Block this time</button>
      </form>
      <div className="stack">
        <h3>Upcoming blocked periods</h3>
        {blocks === null ? <Skeletons n={2} /> : blocks.length === 0 ? (
          <Empty title="Nothing blocked">All of your working hours are open for booking.</Empty>
        ) : (
          blocks.map((b) => (
            <div key={b.id} className="card row between" style={{ padding: 14 }}>
              <div>
                <strong>{fmtDate(b.start_utc, tz)} {fmtTime(b.start_utc, tz)} → {fmtDate(b.end_utc, tz)} {fmtTime(b.end_utc, tz)}</strong>
                <div className="small muted">{b.reason || "No reason given"} · {tzAbbr(b.start_utc, tz)}</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => remove(b.id)}>Remove</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const blankMed = (): Medicine => ({ name: "", dosage: "", frequency: "", duration: "", instructions: "" });

function PrescribeModal({ appt, tz, onClose, onDone }: { appt: Appointment; tz: Zone; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [items, setItems] = useState<Medicine[]>([blankMed()]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [unclear, setUnclear] = useState<string[]>([]);
  const [aiFilled, setAiFilled] = useState(false);
  const aiEnabled = useAiEnabled();

  const set = (i: number, k: keyof Medicine, v: string) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const readWithAi = async (file: File) => {
    setOriginal(file);
    if (!aiEnabled) return;
    setReading(true);
    setError("");
    try {
      const r = await uploadFile<{ medicines: Medicine[]; notes: string; unclear: string[] }>("/prescriptions/extract", file);
      if (r.medicines.length) setItems(r.medicines);
      if (r.notes) setNotes((n) => (n ? n + "\n" : "") + r.notes);
      setUnclear(r.unclear);
      setAiFilled(true);
      if (!r.medicines.length) setError("The AI couldn't find any medicines in that file. Please type them in.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const submit = async () => {
    const clean = items.filter((m) => m.name.trim());
    if (!clean.length) return setError("Add at least one medicine name.");
    setBusy(true);
    setError("");
    try {
      const rx = await api<Prescription>("/prescriptions", { method: "POST", body: { appointment_id: appt.id, items: clean, notes } });
      if (original) {
        try {
          await uploadFile(`/prescriptions/${rx.id}/file`, original);
        } catch (e) {
          toast(`Prescription sent, but the original file didn't upload: ${errorMessage(e)}`, "error");
        }
      }
      toast(`Prescription sent to ${appt.patient.name}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Prescribe for ${appt.patient.name}`} subtitle={`Appointment ${fmtDateTime(appt.start_utc, tz)}`} onClose={onClose}>
      <div className="stack">
        <label className="dropzone" style={{ cursor: reading ? "wait" : "pointer" }}>
          <input type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" disabled={reading} onChange={(e) => { const f = e.target.files?.[0]; if (f) readWithAi(f); e.target.value = ""; }} />
          <strong>{reading ? "✨ Reading the prescription…" : original ? `📄 ${original.name} — choose another` : "📄 Upload a PDF or photo of a handwritten prescription"}</strong>
          <span className="tiny muted">
            {aiEnabled ? "AI reads it and fills in the medicines below for you to check. The original is also sent to the patient." : "The original is sent to the patient. (AI reading isn't configured on this server.)"}
          </span>
        </label>
        {reading && <div className="row small muted"><span className="spinner" /> This can take 10–40 seconds on the free model.</div>}
        {aiFilled && (
          <div className="alert alert-warn small">
            ✨ Filled in by AI from the uploaded file — check every name and dose against the original before sending.
            {unclear.length > 0 && <div style={{ marginTop: 4 }}>Couldn&apos;t read: {unclear.join("; ")}</div>}
          </div>
        )}
        {items.map((m, i) => (
          <div key={i} className="med stack" style={{ gap: 8 }}>
            <div className="row between">
              <strong className="small">Medicine {i + 1}</strong>
              {items.length > 1 && <button className="btn btn-danger btn-sm" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>Remove</button>}
            </div>
            <input className="input" placeholder="Medicine name as sold, e.g. Calpol 650 or Paracetamol 500 mg" value={m.name} onChange={(e) => set(i, "name", e.target.value)} />
            <div className="grid grid-3">
              <input className="input" placeholder="Dosage, e.g. 1 tablet" value={m.dosage} onChange={(e) => set(i, "dosage", e.target.value)} />
              <input className="input" placeholder="Frequency, e.g. twice daily" value={m.frequency} onChange={(e) => set(i, "frequency", e.target.value)} />
              <input className="input" placeholder="Duration, e.g. 5 days" value={m.duration} onChange={(e) => set(i, "duration", e.target.value)} />
            </div>
            <input className="input" placeholder="Instructions, e.g. after food" value={m.instructions} onChange={(e) => set(i, "instructions", e.target.value)} />
          </div>
        ))}
        <button className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setItems((xs) => [...xs, blankMed()])} disabled={items.length >= 20}>+ Add medicine</button>
        <div className="field">
          <label htmlFor="notes">Notes for the patient</label>
          <textarea id="notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Advice, follow-up, warnings" />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" disabled={busy} onClick={submit}>{busy && <span className="spinner" />} Send prescription</button>
        </div>
      </div>
    </Modal>
  );
}
