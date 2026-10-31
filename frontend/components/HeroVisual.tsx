"use client";

import { useNow } from "./ui";
import { ZONES, fmtTime, tzAbbr } from "@/lib/time";

const GRID = [
  ["", "", "", "busy", "off"],
  ["busy", "", "", "", "off"],
  ["on", "", "", "", ""],
  ["", "busy", "", "", ""],
  ["", "", "", "", "busy"],
  ["", "", "busy", "", ""],
];

export function HeroVisual() {
  const now = useNow(1000);
  return (
    <div>
      <div className="week">
        <span />
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => <span key={d} className="head">{d}</span>)}
        {GRID.map((row, r) => (
          <div key={r} style={{ display: "contents" }}>
            <span>{`${9 + Math.floor(r / 2)}`.padStart(2, "0")}:{r % 2 ? "30" : "00"}</span>
            {row.map((c, i) => <span key={i} className={`cell ${c}`} />)}
          </div>
        ))}
      </div>
      <div className="zone-strip">
        {ZONES.map((z, i) => (
          <div key={z} className={i === 1 ? "active" : ""}>
            <div className="t">{now ? fmtTime(now, z) : "--:--"}</div>
            <div className="z">{z}{now ? ` · ${tzAbbr(now, z)}` : ""}</div>
          </div>
        ))}
      </div>
      <div className="mono tiny" style={{ color: "#8fa0a2", marginTop: 12 }}>Right now: one instant, three local times.</div>
    </div>
  );
}
