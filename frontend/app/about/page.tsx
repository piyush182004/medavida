import Link from "next/link";
import { DotGrid, MEDAVIDA_URL } from "@/components/Brand";
import { IconGlobe, IconShield, IconUser, IconPin } from "@/components/Icons";

export const metadata = { title: "About — SlotZero" };

const PRINCIPLES = [
  { icon: <IconShield />, title: "Safety over speed", text: "A booking is only confirmed after the server re-checks it under a lock. A failed reschedule never touches the original booking." },
  { icon: <IconGlobe />, title: "Honest about time", text: "We store instants in UTC and use real IANA zones. Times that don't exist are rejected; times that happen twice follow a documented rule." },
  { icon: <IconUser />, title: "Private by default", text: "Patients only ever see their own appointments, doctors only their own patients — enforced on the server, not by hiding buttons." },
  { icon: <IconPin />, title: "Real data only", text: "Pharmacies come live from OpenStreetMap, drug labels from openFDA, buy links from real retailers. Nothing invented." },
];

const STACK = [
  ["Frontend", "Next.js 14 · React · TypeScript · Intl time-zone APIs"],
  ["Backend", "FastAPI · SQLAlchemy · Python zoneinfo · JWT auth"],
  ["Database", "SQLite (WAL) or PostgreSQL with partial unique index"],
  ["Integrations", "Jitsi Meet · OpenStreetMap Overpass & Nominatim · openFDA"],
  ["Hosting", "Vercel (frontend) · Render (API)"],
];

export default function About() {
  return (
    <>
      <div className="container">
        <section className="hero" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="eyebrow">About us</div>
            <h1 style={{ marginTop: 14, maxWidth: 780 }}>We make sure the appointment you booked is the appointment that happens.</h1>
            <p className="lead" style={{ maxWidth: 680 }}>
              SlotZero is a conflict-free scheduler for clinics whose doctors and patients live on different clocks. It started as an entry to MedaVida&apos;s intern hackathon and was designed to the same standard as a production health product.
            </p>
          </div>
        </section>
      </div>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Our principles</div>
            <h2>What we refuse to compromise on.</h2>
          </div>
          <div className="grid grid-2">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="card">
                <div className="icon-badge">{p.icon}</div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="hospitals" style={{ background: "var(--surface)" }}>
        <div className="container grid grid-2" style={{ alignItems: "center", gap: 40 }}>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div className="eyebrow">For hospitals &amp; clinics</div>
            <h2>One doctor, many hospitals, zero clashes.</h2>
            <p>Specialists rarely work in one place. In SlotZero a doctor assigns each working range to a hospital — Riverside on Tuesday mornings, CityCare on Wednesdays, online in the afternoon — and every location draws from the same conflict-free calendar.</p>
          </div>
          <div className="grid" style={{ gap: 12 }}>
            {[
              ["Hospital-aware slots", "Patients see where each slot is and can filter doctors by hospital."],
              ["Colour-coded calendar", "Doctors see their week across every hospital in one view."],
              ["One source of truth", "A booking at one hospital blocks that time at all of them — no double-booking across sites."],
            ].map(([t, d]) => (
              <div key={t} className="card"><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2" style={{ alignItems: "start", gap: 40 }}>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <div className="eyebrow">Under the hood</div>
            <h2>Simple stack, careful engineering.</h2>
            <p>Two independently deployable apps: a typed Next.js frontend and a FastAPI service that owns every scheduling rule.</p>
          </div>
          <table className="table card" style={{ padding: 0 }}>
            <tbody>
              {STACK.map(([k, v]) => (
                <tr key={k}>
                  <th style={{ width: 130 }}>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="banner">
            <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 18 }}>
              <div style={{ flex: "none", padding: 12, borderRadius: 14, background: "#141e20" }}><DotGrid size={34} /></div>
              <div>
                <div className="eyebrow">Hackathon</div>
                <h2 style={{ fontSize: "1.8rem", marginTop: 8 }}>Built at the MedaVida Intern Hackathon</h2>
                <p>MedaVida builds connected infrastructure for independent healthcare — payments, credentialing, marketplaces and more. SlotZero was our answer to their scheduling challenge, built solo in four hours with AI-assisted development.</p>
              </div>
            </div>
            <div className="row">
              <a href={MEDAVIDA_URL} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Visit MedaVida ↗</a>
              <Link href="/login" className="btn btn-ghost-dark">Try the demo</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
