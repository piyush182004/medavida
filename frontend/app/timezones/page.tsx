"use client";

import { useState } from "react";
import { api, errorMessage, type Zone } from "@/lib/api";
import { ZONES } from "@/lib/time";
import { LiveClocks } from "@/components/ui";

interface CheckResult {
  local: string;
  timezone: Zone;
  status: "ok" | "ambiguous" | "nonexistent";
  message: string;
  interpretations: { occurrence: string; utc: string; offset: string; abbreviation: string; in_zones: Record<Zone, string> }[];
}

const PRESETS: { label: string; local: string; tz: Zone }[] = [
  { label: "New York falls back (1 Nov 2026, 01:30 happens twice)", local: "2026-11-01T01:30", tz: "America/New_York" },
  { label: "London springs forward (28 Mar 2027, 01:30 never happens)", local: "2027-03-28T01:30", tz: "Europe/London" },
  { label: "New York springs forward (14 Mar 2027, 02:30 never happens)", local: "2027-03-14T02:30", tz: "America/New_York" },
  { label: "Brief example: 18 Jan 10:00 London", local: "2027-01-18T10:00", tz: "Europe/London" },
  { label: "Same clinic hour after London DST starts (5 Apr 2027 10:00)", local: "2027-04-05T10:00", tz: "Europe/London" },
];

export default function TimezoneLab() {
  const [local, setLocal] = useState(PRESETS[0].local);
  const [tz, setTz] = useState<Zone>(PRESETS[0].tz);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const check = async (l = local, z = tz) => {
    setBusy(true);
    setError("");
    try {
      setResult(await api<CheckResult>(`/tz/check?local=${encodeURIComponent(l)}&tz=${encodeURIComponent(z)}`));
    } catch (e) {
      setError(errorMessage(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const tone = result?.status === "ok" ? "alert-ok" : result?.status === "ambiguous" ? "alert-warn" : "alert-error";

  return (
    <>
      <div className="container dash">
        <div className="dash-head">
          <div>
            <div className="eyebrow">Time-zone lab</div>
            <h1>How SlotZero handles daylight saving</h1>
            <p className="muted" style={{ maxWidth: 720, marginTop: 8 }}>
              Appointments are stored as UTC instants. Doctors set hours in their own IANA zone; every viewer sees the same instant in their own zone. No fixed UTC offsets anywhere.
            </p>
          </div>
        </div>
        <LiveClocks />

        <div className="grid grid-2" style={{ marginTop: 28, alignItems: "start" }}>
          <div className="card stack">
            <h3>Check a local time</h3>
            <div className="field">
              <label htmlFor="l">Local date &amp; time</label>
              <input id="l" type="datetime-local" className="input" value={local} onChange={(e) => setLocal(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="z">Zone</label>
              <select id="z" className="select" value={tz} onChange={(e) => setTz(e.target.value as Zone)}>
                {ZONES.map((z) => <option key={z}>{z}</option>)}
              </select>
            </div>
            <button className="btn btn-dark" onClick={() => check()} disabled={busy}>{busy && <span className="spinner" />} Check</button>
            <div className="stack" style={{ gap: 6 }}>
              <span className="small muted">Try a DST edge case:</span>
              {PRESETS.map((p) => (
                <button key={p.label} className="btn btn-outline btn-sm" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={() => { setLocal(p.local); setTz(p.tz); check(p.local, p.tz); }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="stack">
            {error && <div className="alert alert-error">{error}</div>}
            {result ? (
              <>
                <div className={`alert ${tone}`}>
                  <strong>{result.local.replace("T", " ")} in {result.timezone}: {result.status.toUpperCase()}</strong>
                  <div>{result.message}</div>
                </div>
                {result.interpretations.map((i) => (
                  <div key={i.occurrence} className="card">
                    <div className="row between">
                      <h3>{result.interpretations.length > 1 ? `${i.occurrence === "first" ? "First" : "Second"} occurrence` : "Instant"}</h3>
                      <span className="chip">{i.abbreviation} (UTC{i.offset.slice(0, 3)}:{i.offset.slice(3)})</span>
                    </div>
                    <div className="mono small" style={{ marginTop: 8 }}>UTC {i.utc}</div>
                    <table className="table" style={{ marginTop: 8 }}>
                      <tbody>
                        {Object.entries(i.in_zones).map(([z, t]) => (
                          <tr key={z}><th style={{ width: 160 }}>{z}</th><td className="mono">{t}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    {result.interpretations.length > 1 && i.occurrence === "first" && <p className="small">✓ SlotZero uses this one for slots.</p>}
                  </div>
                ))}
              </>
            ) : (
              <div className="card card-mint">
                <h3>Our rules</h3>
                <ul style={{ paddingLeft: 18, margin: "10px 0 0", display: "grid", gap: 8 }}>
                  <li><strong>Nonexistent times</strong> (spring-forward gap) are rejected with a clear message and never offered as slots.</li>
                  <li><strong>Ambiguous times</strong> (fall-back overlap) resolve to the first occurrence. Blocked periods extend their end to the second occurrence so the whole hour is covered.</li>
                  <li>Doctor hours are <strong>wall-clock</strong>: 09:00 London stays 09:00 London all year, so it shifts by an hour for Kolkata and New York viewers when DST changes.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
