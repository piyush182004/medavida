"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, dashboardPath, errorMessage, type Role, type Session, type Zone } from "@/lib/api";
import { ZONES, ZONE_INFO } from "@/lib/time";
import { useApp } from "@/components/Providers";
import { AuthSide } from "@/components/AuthSide";

const SPECIALIZATIONS = ["General Physician", "Cardiology", "Dermatology", "Paediatrics", "Psychiatry", "Orthopaedics", "Gynaecology", "ENT", "Neurology", "Endocrinology"];

function guessZone(): Zone {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Calcutta" || tz === "Asia/Kolkata") return "Asia/Kolkata";
    if (ZONES.includes(tz as Zone)) return tz as Zone;
    if (tz.startsWith("America/")) return "America/New_York";
  } catch {
    /* default below */
  }
  return "Europe/London";
}

function RegisterForm() {
  const { session, setSession, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const initialRole = params.get("role");
  const [role, setRole] = useState<Role>(initialRole === "doctor" || initialRole === "hospital" ? initialRole : "patient");
  const [form, setForm] = useState({ name: "", email: "", password: "", timezone: "Europe/London" as Zone, specialization: "General Physician", hospital_name: "", hospital_city: "", hospital_address: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setForm((f) => ({ ...f, timezone: guessZone() })), []);
  useEffect(() => {
    if (session) router.replace(dashboardPath(session.user.role));
  }, [session, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setError("Please enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setError("Please enter a valid email address.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (role === "hospital" && form.hospital_name.trim().length < 2) return setError("Please enter the hospital or clinic name.");
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/auth/register", {
        method: "POST",
        body: {
          name: form.name,
          email: form.email.trim(),
          password: form.password,
          timezone: form.timezone,
          role,
          specialization: role === "doctor" ? form.specialization : undefined,
          ...(role === "hospital" ? { hospital_name: form.hospital_name, hospital_city: form.hospital_city, hospital_address: form.hospital_address } : {}),
        },
      });
      setSession(s);
      toast(
        role === "doctor"
          ? "Account created — set your working hours to start taking bookings."
          : role === "hospital"
          ? "Hospital registered — add doctors to your roster and set their hours."
          : "Account created — find a doctor and book your first slot."
      );
      router.push(role === "doctor" ? "/doctor?tab=schedule" : role === "hospital" ? "/hospital?tab=doctors" : "/patient?tab=book");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card stack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: "1.9rem" }}>Create your account</h1>
        <p className="muted" style={{ marginTop: 6 }}>Use made-up details — this is a hackathon demo.</p>
      </div>
      <div className="segmented" role="tablist">
        <button type="button" className={role === "patient" ? "on" : ""} onClick={() => setRole("patient")}>I&apos;m a patient</button>
        <button type="button" className={role === "doctor" ? "on" : ""} onClick={() => setRole("doctor")}>I&apos;m a doctor</button>
        <button type="button" className={role === "hospital" ? "on" : ""} onClick={() => setRole("hospital")}>Hospital</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <form className="stack" onSubmit={submit} noValidate>
        {role === "hospital" && (
          <>
            <div className="field">
              <label htmlFor="hname">Hospital or clinic name</label>
              <input id="hname" className="input" value={form.hospital_name} onChange={set("hospital_name")} placeholder="e.g. Northside Medical Centre" />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="hcity">City</label>
                <input id="hcity" className="input" value={form.hospital_city} onChange={set("hospital_city")} />
              </div>
              <div className="field">
                <label htmlFor="haddr">Address (optional)</label>
                <input id="haddr" className="input" value={form.hospital_address} onChange={set("hospital_address")} />
              </div>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="name">{role === "hospital" ? "Administrator name" : "Full name"}</label>
          <input id="name" className="input" value={form.name} onChange={set("name")} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
          <span className="hint">At least 8 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="tz">{role === "hospital" ? "Hospital time zone" : "Your time zone"}</label>
          <select id="tz" className="select" value={form.timezone} onChange={set("timezone")}>
            {ZONES.map((z) => (
              <option key={z} value={z}>{ZONE_INFO[z].country} — {z}</option>
            ))}
          </select>
          <span className="hint">{role === "doctor" ? "Your working hours are set in this zone." : role === "hospital" ? "Your hospital's local zone — also sets its billing currency (₹ / £ / $)." : "All appointment times are shown in this zone."}</span>
        </div>
        {role === "doctor" && (
          <div className="field">
            <label htmlFor="spec">Specialization</label>
            <input id="spec" className="input" list="specs" value={form.specialization} onChange={set("specialization")} />
            <datalist id="specs">{SPECIALIZATIONS.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
        )}
        <button className="btn btn-dark btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" />} {role === "hospital" ? "Register hospital" : `Create ${role} account`}
        </button>
      </form>
      <p className="small muted">
        Already registered? <Link href="/login" style={{ color: "var(--teal-700)", fontWeight: 600 }}>Log in</Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div className="auth-wrap">
      <AuthSide title="One booking. Three time zones. Zero conflicts." />
      <div className="auth-main">
        <Suspense>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
