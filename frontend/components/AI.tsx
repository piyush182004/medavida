"use client";

import { useEffect, useState } from "react";
import { aiStatus, api, errorMessage } from "@/lib/api";

export function useAiEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    aiStatus().then((s) => setEnabled(s.enabled));
  }, []);
  return enabled;
}

export function AiText({ text, label = "AI summary", onRefresh, busy }: { text: string; label?: string; onRefresh?: () => void; busy?: boolean }) {
  return (
    <div className="ai-box">
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="ai-label">✨ {label}</span>
        {onRefresh && (
          <button className="btn btn-sm" style={{ background: "none", padding: 0, color: "var(--muted)" }} onClick={onRefresh} disabled={busy}>
            {busy ? <span className="spinner" /> : "Regenerate"}
          </button>
        )}
      </div>
      <div className="ai-text">{text}</div>
      <div className="tiny muted" style={{ marginTop: 8 }}>AI-generated from the shared material. It can be wrong — always check the original.</div>
    </div>
  );
}

/** Summarise one shared document. Doctors get a clinical summary; patients a plain-language one. */
export function DocSummary({ attachmentId, initial }: { attachmentId: number; initial?: string | null }) {
  const enabled = useAiEnabled();
  const [text, setText] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (refresh = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ summary: string }>(`/attachments/${attachmentId}/summary${refresh ? "?refresh=true" : ""}`, { method: "POST" });
      setText(r.summary);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (text) return <AiText text={text} onRefresh={() => run(true)} busy={busy} />;
  return (
    <div>
      <button
        className="btn btn-ai btn-sm"
        onClick={() => run()}
        disabled={busy || enabled === false}
        title={enabled === false ? "AI isn't configured on this server yet" : undefined}
      >
        {busy ? <><span className="spinner" /> Reading document…</> : "✨ Summarise with AI"}
      </button>
      {enabled === false && <span className="tiny muted" style={{ marginLeft: 8 }}>AI not configured</span>}
      {error && <div className="alert alert-error small" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/** Doctor-only pre-visit brief from the patient's note + every shared document. */
export function VisitBrief({ apptId, initial, hasMaterial }: { apptId: number; initial?: string | null; hasMaterial: boolean }) {
  const enabled = useAiEnabled();
  const [text, setText] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (refresh = false) => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ brief: string }>(`/appointments/${apptId}/brief${refresh ? "?refresh=true" : ""}`, { method: "POST" });
      setText(r.brief);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (text) return <AiText text={text} label="AI pre-visit brief" onRefresh={() => run(true)} busy={busy} />;
  if (!hasMaterial) return null;
  return (
    <div className="ai-cta">
      <div>
        <strong className="small">✨ AI pre-visit brief</strong>
        <div className="tiny muted">Summarises the patient&apos;s note and every shared report into one page.</div>
      </div>
      <button className="btn btn-ai btn-sm" onClick={() => run()} disabled={busy || enabled === false} title={enabled === false ? "AI isn't configured on this server yet" : undefined}>
        {busy ? <><span className="spinner" /> Reading…</> : enabled === false ? "AI not configured" : "Generate"}
      </button>
      {error && <div className="alert alert-error small" style={{ gridColumn: "1 / -1" }}>{error}</div>}
    </div>
  );
}
