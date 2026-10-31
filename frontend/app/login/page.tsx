"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, dashboardPath, errorMessage, type Session } from "@/lib/api";
import { useApp } from "@/components/Providers";
import { AuthSide } from "@/components/AuthSide";

const DEMO = [
  { email: "asha@slotzero.dev", label: "Asha", meta: "Patient · Kolkata" },
  { email: "sam@slotzero.dev", label: "Sam", meta: "Patient · New York" },
  { email: "meera@slotzero.dev", label: "Dr. Meera", meta: "Doctor · London" },
  { email: "alex@slotzero.dev", label: "Dr. Alex", meta: "Doctor · New York" },
  { email: "citycare@slotzero.dev", label: "CityCare Clinic", meta: "Hospital · London" },
  { email: "hudson@slotzero.dev", label: "Hudson Heart Center", meta: "Hospital · New York" },
];

function LoginForm() {
  const { session, setSession, toast } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) router.replace(dashboardPath(session.user.role));
  }, [session, router]);

  const submit = async (e?: React.FormEvent, creds?: { email: string; password: string }) => {
    e?.preventDefault();
    const body = creds || { email: email.trim(), password };
    if (!body.email || !body.password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/auth/login", { method: "POST", body });
      setSession(s);
      toast(`Welcome back, ${s.user.name.split(" ")[0]}!`);
      const next = params.get("next");
      router.push(next && next.startsWith(`/${s.user.role}`) ? next : dashboardPath(s.user.role));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-card stack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: "1.9rem" }}>Log in</h1>
        <p className="muted" style={{ marginTop: 6 }}>Patients, doctors and hospitals use the same login — you&apos;ll land on your own dashboard.</p>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn btn-dark btn-lg btn-block" disabled={busy}>
          {busy && <span className="spinner" />} Log in
        </button>
      </form>
      <div className="card" style={{ padding: 16 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <strong className="small">Demo accounts</strong>
          <span className="tiny muted mono">password: demo1234</span>
        </div>
        <div className="demo-accounts">
          {DEMO.map((d) => (
            <button key={d.email} type="button" disabled={busy} onClick={() => submit(undefined, { email: d.email, password: "demo1234" })}>
              <div className="small" style={{ fontWeight: 700 }}>{d.label}</div>
              <div className="tiny muted">{d.meta}</div>
            </button>
          ))}
        </div>
      </div>
      <p className="small muted">
        New here? <Link href="/register" style={{ color: "var(--teal-700)", fontWeight: 600 }}>Create an account</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="auth-wrap">
      <AuthSide title="Healthcare that runs on everyone's clock." />
      <div className="auth-main">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
