"use client";

import Link from "next/link";
import { DotGrid, MEDAVIDA_URL, SlotZeroMark } from "./Brand";
import { dashboardPath } from "@/lib/api";
import { useApp } from "./Providers";
import { IconArrow } from "./Icons";

export function Footer() {
  const { session } = useApp();
  const user = session?.user;
  const dashboard = user ? dashboardPath(user.role) : "/";

  return (
    <footer className="footer">
      <div className="container">
        <a className="footer-medavida" href={MEDAVIDA_URL} target="_blank" rel="noopener noreferrer">
          <div className="row" style={{ flexWrap: "nowrap", gap: 16, alignItems: "flex-start" }}>
            <div className="mv-mark"><DotGrid size={30} /></div>
            <div>
              <div className="eyebrow" style={{ color: "var(--teal)" }}>Proudly built at the MedaVida Intern Hackathon</div>
              <h3 style={{ fontSize: "1.35rem", marginTop: 6 }}>Healthcare runs better when every tool is connected.</h3>
              <p className="small" style={{ color: "#b9c6c7", marginTop: 6, maxWidth: 620 }}>
                SlotZero is our answer to MedaVida&apos;s scheduling challenge — part of a bigger vision of one platform for practices, pharmacies and patients. Explore what MedaVida is building.
              </p>
            </div>
          </div>
          <span className="btn btn-primary" style={{ flex: "none" }}>Visit medavida.com <IconArrow size={16} /></span>
        </a>

        <div className="footer-grid">
          <div className="stack">
            <div className="brand">
              <SlotZeroMark /> SlotZero
            </div>
            <p className="muted small" style={{ maxWidth: 320 }}>
              Conflict-free doctor appointments for clinics and hospitals across India, the UK and the US. One booking, the right local time for everyone.
            </p>
            <div className="row tiny muted" style={{ gap: 6 }}>
              <span className="chip chip-gray mono">Asia/Kolkata</span>
              <span className="chip chip-gray mono">Europe/London</span>
              <span className="chip chip-gray mono">America/New_York</span>
            </div>
          </div>
          <div>
            <h4>Product</h4>
            {user ? (
              <Link className="f" href={dashboard}>My dashboard</Link>
            ) : (
              <>
                <Link className="f" href="/#features">Features</Link>
                <Link className="f" href="/#how">How it works</Link>
              </>
            )}
            <Link className="f" href="/timezones">Time-zone lab</Link>
            <Link className="f" href="/about#hospitals">For hospitals</Link>
          </div>
          <div>
            <h4>{user ? "Account" : "Get started"}</h4>
            {user ? (
              <>
                <span className="f muted">Signed in as {user.name}</span>
                <Link className="f" href={dashboard}>{user.role === "doctor" ? "Schedule & requests" : user.role === "hospital" ? "Hospital operations" : "My appointments"}</Link>
              </>
            ) : (
              <>
                <Link className="f" href="/register?role=patient">Book as a patient</Link>
                <Link className="f" href="/register?role=doctor">Join as a doctor</Link>
                <Link className="f" href="/register?role=hospital">Register a hospital</Link>
                <Link className="f" href="/login">Log in</Link>
              </>
            )}
          </div>
          <div>
            <h4>Company</h4>
            <Link className="f" href="/about">About SlotZero</Link>
            <a className="f" href={MEDAVIDA_URL} target="_blank" rel="noopener noreferrer">MedaVida ↗</a>
            <a className="f" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Map data © OpenStreetMap</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} SlotZero · A MedaVida Intern Hackathon project. Demo data only — not for real medical use.</span>
          <span>Video by Jitsi Meet · Pharmacies by OpenStreetMap · Drug labels by openFDA</span>
        </div>
      </div>
    </footer>
  );
}
