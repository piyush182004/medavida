"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Doctor, type Slot, type Zone } from "@/lib/api";
import { addDays, fmtLongDate, fmtTime, localDateKey, tzAbbr } from "@/lib/time";
import { Empty, ErrorBox } from "./ui";

interface Props {
  doctor: Pick<Doctor, "id" | "name" | "timezone">;
  viewerTz: Zone;
  selected: Slot | null;
  onSelect: (s: Slot | null) => void;
  refreshKey?: number;
  /** Appointment being moved — its own slot counts as free. */
  excludeId?: number;
}

export function SlotPicker({ doctor, viewerTz, selected, onSelect, refreshKey = 0, excludeId }: Props) {
  const today = localDateKey(new Date(), viewerTz);
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setSlots(null);
    setError("");
    try {
      const r = await api<{ slots: Slot[] }>(`/doctors/${doctor.id}/slots?date=${day}&tz=${encodeURIComponent(viewerTz)}${excludeId ? `&exclude=${excludeId}` : ""}`);
      setSlots(r.slots);
    } catch (e) {
      setError(errorMessage(e));
      setSlots([]);
    }
  }, [doctor.id, day, viewerTz, excludeId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  return (
    <div className="stack">
      <div className="row" style={{ overflowX: "auto", flexWrap: "nowrap", paddingBottom: 4 }}>
        {days.map((d) => {
          const dt = new Date(`${d}T12:00:00Z`);
          return (
            <button
              key={d}
              className={`slot ${d === day ? "on" : ""}`}
              style={{ minWidth: 64 }}
              onClick={() => {
                setDay(d);
                onSelect(null);
              }}
            >
              <div className="d">{dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</div>
              <div className="t">{dt.getUTCDate()}</div>
            </button>
          );
        })}
        <input
          type="date"
          className="input"
          style={{ width: 160, flex: "none" }}
          value={day}
          min={today}
          aria-label="Pick another date"
          onChange={(e) => {
            if (e.target.value) {
              setDay(e.target.value);
              onSelect(null);
            }
          }}
        />
      </div>
      <div className="small muted">
        {fmtLongDate(`${day}T12:00:00Z`, "UTC")} · times shown in <strong>your zone ({viewerTz})</strong>, doctor&apos;s local time underneath.
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      {slots === null ? (
        <div className="slots">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 52 }} />)}</div>
      ) : slots.length === 0 && !error ? (
        <Empty title="No open slots on this day">Dr. {doctor.name} is fully booked, on a break or not working. Try another date.</Empty>
      ) : (
        <div className="slots">
          {slots.map((s) => (
            <button
              key={s.start_utc}
              className={`slot ${selected?.start_utc === s.start_utc ? "on" : ""}`}
              onClick={() => onSelect(s)}
              title={`${fmtTime(s.start_utc, doctor.timezone)} ${tzAbbr(s.start_utc, doctor.timezone)} for Dr. ${doctor.name}`}
            >
              <div className="t">{fmtTime(s.start_utc, viewerTz)}</div>
              {doctor.timezone !== viewerTz && (
                <div className="d">
                  {fmtTime(s.start_utc, doctor.timezone)} {tzAbbr(s.start_utc, doctor.timezone)}
                </div>
              )}
              <div className={`loc ${s.hospital ? "" : "online"}`}>{s.hospital ? s.hospital.name : "Online only"}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
