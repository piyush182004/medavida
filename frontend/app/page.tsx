import Link from "next/link";
import { HeroVisual } from "@/components/HeroVisual";
import { HeroCTAs } from "@/components/HeroCTAs";
import { MEDAVIDA_URL, DotGrid, MedaVidaCredit } from "@/components/Brand";
import { IconCalendar, IconCheck, IconClock, IconGlobe, IconHistory, IconPill, IconPin, IconShield, IconStethoscope, IconUser, IconVideo, IconX } from "@/components/Icons";

const FEATURES = [
  { icon: <IconShield />, title: "Never double-booked", text: "Every booking is re-checked on the server inside a per-doctor lock. If two patients click the same slot, exactly one wins." },
  { icon: <IconGlobe />, title: "Time-zone honest", text: "Stored as UTC, shown in each person's own IANA zone with the zone labelled. DST gaps rejected, overlaps resolved predictably." },
  { icon: <IconCalendar />, title: "Live availability", text: "Slots are generated from working hours, blocked time and active bookings — nothing hardcoded. Cancel a booking and the slot reappears." },
  { icon: <IconVideo />, title: "Video consults", text: "Pick “Online” and a private Jitsi Meet room is created. One click to join — no app, no account, no API key." },
  { icon: <IconPill />, title: "e-Prescriptions", text: "Doctors prescribe after a visit. Patients see dosage, official FDA label info and links to real online pharmacies." },
  { icon: <IconPin />, title: "Pharmacies near you", text: "Live, real pharmacies from OpenStreetMap around your location, with distance, hours and directions." },
];

export default function Home() {
  return (
    <>
      <div className="container">
        <section className="hero">
          <div>
            <div className="eyebrow">Conflict-free doctor appointments</div>
            <h1 style={{ marginTop: 14 }}>
              One booking.<br />Every clock <em>agrees.</em>
            </h1>
            <p className="lead">
              SlotZero lets doctors control their hours and patients in India, the UK and the US book safely — no overlaps, no wrong-time arrivals, no cancelled slots stuck blocked.
            </p>
            <HeroCTAs />
            <div className="chips" style={{ marginTop: 28 }}>
              {["Asia/Kolkata", "Europe/London", "America/New_York"].map((z) => <span key={z} className="chip chip-dark mono">{z}</span>)}
            </div>
          </div>
          <HeroVisual />
        </section>

        <div className="row" style={{ justifyContent: "center", gap: 12, padding: "8px 0 0" }}>
          <MedaVidaCredit />
        </div>
      </div>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">The problem</div>
            <h2>Manual scheduling breaks the moment clinics go global.</h2>
            <p>Dr. Meera runs a London clinic. Her patients are in Kolkata and New York. Here&apos;s what changes.</p>
          </div>
          <div className="compare">
            <div className="card">
              <h3>The old way</h3>
              <ul>
                {["Two patients grab the same slot", "Cancelled appointments stay blocked", "Patients arrive an hour off after daylight saving", "Anyone with a link can change any booking", "No record of who changed what"].map((t) => (
                  <li key={t}><span style={{ color: "var(--danger)" }}><IconX size={18} /></span>{t}</li>
                ))}
              </ul>
            </div>
            <div className="card card-dark">
              <h3>The SlotZero way</h3>
              <ul>
                {["Server-side lock: only one booking per slot", "Cancelled slots reopen instantly", "IANA zones, UTC storage, DST-aware slots", "Role and ownership checks on every request", "Full history of bookings, cancels and reschedules"].map((t) => (
                  <li key={t}><span style={{ color: "var(--teal)" }}><IconCheck size={18} /></span>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="features" style={{ background: "var(--surface)" }}>
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">What we offer</div>
            <h2>Everything a cross-border clinic needs, nothing it doesn&apos;t.</h2>
          </div>
          <div className="grid grid-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card">
                <div className="icon-badge">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">Who it&apos;s for</div>
            <h2>Built for every side of the appointment.</h2>
          </div>
          <div className="grid grid-3">
            <div className="card card-mint">
              <div className="icon-badge" style={{ background: "#fff" }}><IconStethoscope /></div>
              <h3>Doctors</h3>
              <p>Set working days and multiple ranges per day, choose 15/30/60-minute consults, block breaks and holidays, see today&apos;s bookings at a glance and prescribe after each visit.</p>
            </div>
            <div className="card card-mint">
              <div className="icon-badge" style={{ background: "#fff" }}><IconUser /></div>
              <h3>Patients</h3>
              <p>Compare doctors by specialization, hospital and fee, request a slot in your own time zone, share past reports, join video consults and find medicines nearby.</p>
            </div>
            <div className="card card-mint">
              <div className="icon-badge" style={{ background: "#fff" }}><IconShield /></div>
              <h3>Hospitals</h3>
              <p>Build a roster of doctors, set in-person fees, assign shifts that never clash with a doctor&apos;s other hospitals, run the front desk and track appointments and revenue per doctor.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="how" style={{ background: "var(--surface)" }}>
        <div className="container">
          <div className="section-head">
            <div className="eyebrow">How it works</div>
            <h2>Three steps, zero conflicts.</h2>
          </div>
          <div className="grid grid-3 steps">
            <div className="step"><h3>Doctor sets hours</h3><p className="muted" style={{ marginTop: 8 }}>In their own local time, e.g. 09:00–12:00 and 13:00–17:00 London time, plus any blocked periods.</p></div>
            <div className="step"><h3>Patient picks a slot</h3><p className="muted" style={{ marginTop: 8 }}>Slots appear in the patient&apos;s zone with the doctor&apos;s time alongside. Online or in-person.</p></div>
            <div className="step"><h3>Server confirms once</h3><p className="muted" style={{ marginTop: 8 }}>The backend re-validates the slot under a lock, stores a UTC instant and logs the action. Repeats are idempotent.</p></div>
          </div>
          <div className="row" style={{ marginTop: 32, gap: 18 }}>
            <span className="chip"><IconClock size={14} /> 10:00 London = 15:30 Kolkata = 05:00 New York (18 Jan)</span>
            <span className="chip"><IconHistory size={14} /> Every change is audited</span>
          </div>
        </div>
      </section>

      <section className="section" id="about">
        <div className="container">
          <div className="banner">
            <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 18 }}>
              <div style={{ flex: "none", padding: 12, borderRadius: 14, background: "#141e20" }}><DotGrid size={34} /></div>
              <div>
                <div className="eyebrow">Made at the MedaVida Intern Hackathon</div>
                <h2 style={{ fontSize: "1.8rem", marginTop: 8 }}>A 4-hour build, engineered like it&apos;s going to production.</h2>
                <p>SlotZero was built solo for MedaVida&apos;s SlotZero challenge — healthcare tooling that independent practices can actually trust.</p>
              </div>
            </div>
            <div className="row">
              <Link href="/about" className="btn btn-primary">About SlotZero</Link>
              <a href={MEDAVIDA_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost-dark">Visit MedaVida ↗</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
