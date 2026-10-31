"use client";

import type { Appointment, Zone } from "@/lib/api";
import { HOSPITAL_COLORS, ONLINE_COLOR, WEEKDAYS, addDays, fmtKey, localDateKey, localMinutes, mondayOf, weekdayOf } from "@/lib/time";
import { useNow } from "./ui";

export interface HoursRange {
  weekday: number;
  start: string;
  end: string;
  hospital_id: number | null;
  hospital_name?: string | null;
}

export interface BlockLite {
  id: number;
  start_utc: string;
  end_utc: string;
  reason: string;
}

export function hospitalColor(id: number | null | undefined, order: number[]): string {
  if (id == null) return ONLINE_COLOR;
  const i = order.indexOf(id);
  return HOSPITAL_COLORS[(i < 0 ? id : i) % HOSPITAL_COLORS.length];
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const PX_PER_MIN = 1.1;

interface WeekProps {
  tz: Zone;
  weekStart: string;
  appts: Appointment[];
  blocks: BlockLite[];
  hours: HoursRange[];
  hospitalOrder: number[];
  onSelect: (a: Appointment) => void;
}

export function WeekCalendar({ tz, weekStart, appts, blocks, hours, hospitalOrder, onSelect }: WeekProps) {
  const now = useNow(60000);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const visible = appts.filter((a) => days.includes(localDateKey(a.start_utc, tz)));

  // Vertical range: working hours ±1h, widened to fit any appointment.
  let lo = 8 * 60;
  let hi = 18 * 60;
  if (hours.length) {
    lo = Math.min(...hours.map((h) => toMin(h.start))) - 60;
    hi = Math.max(...hours.map((h) => toMin(h.end))) + 60;
  }
  visible.forEach((a) => {
    lo = Math.min(lo, localMinutes(a.start_utc, tz));
    hi = Math.max(hi, localMinutes(a.start_utc, tz) + 30);
  });
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60);
  const height = (hi - lo) * PX_PER_MIN;
  const y = (m: number) => (Math.min(Math.max(m, lo), hi) - lo) * PX_PER_MIN;
  const todayKey = now ? localDateKey(now, tz) : "";

  return (
    <div className="cal-scroll">
      <div className="cal" style={{ gridTemplateColumns: `56px repeat(7, minmax(96px, 1fr))` }}>
        <div className="cal-corner" />
        {days.map((d) => (
          <div key={d} className={`cal-head ${d === todayKey ? "today" : ""}`}>
            <span className="tiny muted">{WEEKDAYS[weekdayOf(d)]}</span>
            <span className="cal-daynum">{fmtKey(d, { day: "numeric" })}</span>
          </div>
        ))}

        <div className="cal-times" style={{ height }}>
          {Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => (
            <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>{String((lo + i * 60) / 60).padStart(2, "0")}:00</span>
          ))}
        </div>

        {days.map((d) => {
          const wd = weekdayOf(d);
          const dayAppts = visible.filter((a) => localDateKey(a.start_utc, tz) === d);
          return (
            <div key={d} className={`cal-col ${d === todayKey ? "today" : ""}`} style={{ height }}>
              {Array.from({ length: (hi - lo) / 60 }, (_, i) => (
                <div key={i} className="cal-hour" style={{ top: i * 60 * PX_PER_MIN, height: 60 * PX_PER_MIN }} />
              ))}
              {hours.filter((h) => h.weekday === wd).map((h, i) => (
                <div
                  key={`h${i}`}
                  className="cal-work"
                  title={`${h.start}–${h.end} · ${h.hospital_name ?? "Online only"}`}
                  style={{ top: y(toMin(h.start)), height: y(toMin(h.end)) - y(toMin(h.start)), background: `${hospitalColor(h.hospital_id, hospitalOrder)}1f`, borderLeftColor: hospitalColor(h.hospital_id, hospitalOrder) }}
                />
              ))}
              {blocks.map((b) => {
                const sk = localDateKey(b.start_utc, tz);
                const ek = localDateKey(b.end_utc, tz);
                if (d < sk || d > ek) return null;
                const top = d === sk ? localMinutes(b.start_utc, tz) : 0;
                const bottom = d === ek ? localMinutes(b.end_utc, tz) : 24 * 60;
                if (bottom <= top) return null;
                return (
                  <div key={`b${b.id}`} className="cal-block" style={{ top: y(top), height: Math.max(y(bottom) - y(top), 4) }} title={b.reason || "Blocked"}>
                    <span>{b.reason || "Blocked"}</span>
                  </div>
                );
              })}
              {dayAppts.map((a) => {
                const top = localMinutes(a.start_utc, tz);
                const dur = (new Date(a.end_utc).getTime() - new Date(a.start_utc).getTime()) / 60000;
                return (
                  <button
                    key={a.id}
                    className={`cal-appt ${a.status}`}
                    style={{ top: y(top) + 1, height: Math.max(dur * PX_PER_MIN - 2, 18), borderLeftColor: hospitalColor(a.mode === "online" ? null : a.hospital?.id, hospitalOrder) }}
                    onClick={() => onSelect(a)}
                    title={`${a.patient.name} · ${a.status}`}
                  >
                    <span className="cal-appt-time">{String(Math.floor(top / 60)).padStart(2, "0")}:{String(top % 60).padStart(2, "0")} {a.mode === "online" ? "· 💻" : ""}</span>
                    <span className="cal-appt-name">{a.patient.name}</span>
                  </button>
                );
              })}
              {d === todayKey && now && (() => {
                const m = localMinutes(now, tz);
                return m >= lo && m <= hi ? <div className="cal-now" style={{ top: y(m) }} /> : null;
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MiniMonth({ tz, month, selected, appts, onSelect, onMonth }: { tz: Zone; month: string; selected: string; appts: Appointment[]; onSelect: (d: string) => void; onMonth: (m: string) => void }) {
  // month = YYYY-MM-01
  const first = mondayOf(month);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const counts = new Map<string, number>();
  appts.forEach((a) => {
    const k = localDateKey(a.start_utc, tz);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const today = localDateKey(new Date(), tz);
  const shift = (n: number) => {
    const d = new Date(`${month}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    onMonth(d.toISOString().slice(0, 8) + "01");
  };
  return (
    <div className="mini-month">
      <div className="row between" style={{ marginBottom: 8 }}>
        <strong>{fmtKey(month, { month: "long", year: "numeric" })}</strong>
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="mm-grid">
        {WEEKDAYS.map((w) => <span key={w} className="mm-wd">{w[0]}</span>)}
        {cells.map((d) => {
          const n = counts.get(d) || 0;
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          return (
            <button key={d} className={`mm-day ${inMonth ? "" : "out"} ${d === today ? "today" : ""} ${d === selected ? "sel" : ""}`} onClick={() => onSelect(d)}>
              {Number(d.slice(8))}
              {n > 0 && <span className="mm-dot">{n > 1 ? n : ""}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
