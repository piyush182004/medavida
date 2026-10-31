"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardPath, type AuditEntry, type Role, type Zone } from "@/lib/api";
import { ZONE_INFO, ZONES, fmtDate, fmtDateTime, fmtTime, tzAbbr } from "@/lib/time";
import { useApp } from "./Providers";
import { IconX } from "./Icons";

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="muted small" style={{ marginTop: 4 }}>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error row between">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-outline btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Redirects away unless the logged-in user has the given role. Server enforces it too. */
export function useRequireRole(role: Role) {
  const { session, ready } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace(`/login?next=/${role}`);
    else if (session.user.role !== role) router.replace(dashboardPath(session.user.role));
  }, [ready, session, role, router]);
  return ready && session?.user.role === role ? session : null;
}

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function LiveClocks({ highlight }: { highlight?: Zone }) {
  const now = useNow(1000);
  return (
    <div className="clock-row">
      {ZONES.map((z) => (
        <div key={z} className="clock" style={z === highlight ? { borderColor: "var(--teal)", background: "var(--mint)" } : undefined}>
          <div className="row between">
            <span className="small" style={{ fontWeight: 600 }}>{ZONE_INFO[z].city}</span>
            {now && <span className="chip chip-gray">{tzAbbr(now, z)}</span>}
          </div>
          <div className="t">{now ? fmtTime(now, z) : "--:--"}</div>
          <div className="mono tiny muted">{z}{now ? ` · ${fmtDate(now, z)}` : ""}</div>
        </div>
      ))}
    </div>
  );
}

/** "15:30 IST" with the other party's local time underneath. */
export function DualTime({ iso, mine, other, otherLabel }: { iso: string; mine: Zone; other: Zone; otherLabel: string }) {
  return (
    <span>
      <strong>{fmtDateTime(iso, mine)}</strong>
      {other !== mine && (
        <span className="muted small" style={{ display: "block" }}>
          {otherLabel}: {fmtDateTime(iso, other)}
        </span>
      )}
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = {
  requested: "requested an appointment",
  confirmed: "confirmed the appointment",
  declined: "declined the request",
  proposed: "proposed a new time",
  accepted: "accepted the proposed time",
  cancelled: "cancelled an appointment",
  rescheduled: "asked to reschedule",
  prescribed: "issued a prescription",
  shared_file: "shared a document",
};

export function AuditList({ entries, tz }: { entries: AuditEntry[]; tz: Zone }) {
  if (!entries.length) return <Empty title="No activity yet">Bookings, cancellations, reschedules and prescriptions will appear here.</Empty>;
  return (
    <ul className="timeline card">
      {entries.map((e) => {
        const d = e.details as Record<string, string>;
        return (
          <li key={e.id}>
            <span className={`dot ${e.action}`} />
            <div>
              <div>
                <strong>{e.actor.name}</strong> <span className="muted">({e.actor.role})</span> {ACTION_LABEL[e.action] || e.action}
                {e.appointment_id ? <span className="muted"> · #{e.appointment_id}</span> : null}
              </div>
              <div className="small muted">
                {d.filename
                  ? `File: ${d.filename}`
                  : (e.action === "rescheduled" || e.action === "proposed") && d.from_utc && d.to_utc
                  ? `${fmtDateTime(d.from_utc, tz)} → ${fmtDateTime(d.to_utc, tz)}`
                  : d.start_utc
                  ? `Slot: ${fmtDateTime(d.start_utc, tz)}`
                  : Array.isArray(e.details.medicines)
                  ? `Medicines: ${(e.details.medicines as string[]).join(", ")}`
                  : null}
                {d.reason ? ` · Reason: ${d.reason}` : ""}
              </div>
              <div className="tiny muted">Logged {fmtDateTime(e.created_at, tz)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
