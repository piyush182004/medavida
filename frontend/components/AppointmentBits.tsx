"use client";

import { useRef, useState } from "react";
import { STATUS_LABEL, errorMessage, openAttachment, uploadFile, type Appointment, type AttachmentInfo, type ApptStatus, type Zone } from "@/lib/api";
import { fmtDateTime } from "@/lib/time";
import { useApp } from "./Providers";
import { Modal } from "./ui";
import { DocSummary } from "./AI";

const STATUS_CLASS: Record<ApptStatus, string> = {
  pending: "chip-warn",
  proposed: "chip-info",
  confirmed: "",
  declined: "chip-danger",
  cancelled: "chip-danger",
};

export function StatusChip({ status, past }: { status: ApptStatus; past?: boolean }) {
  if (past && status === "confirmed") return <span className="chip chip-gray">Completed</span>;
  if (past && (status === "pending" || status === "proposed")) return <span className="chip chip-gray">Expired request</span>;
  return <span className={`chip ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function LocationChip({ a }: { a: Pick<Appointment, "mode" | "hospital"> }) {
  return (
    <span className="chip chip-gray">
      {a.mode === "online" ? "Online video" : `In person · ${a.hospital?.name ?? "Clinic"}`}
    </span>
  );
}

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function sizeLabel(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function FileList({ files, tz, ai = true }: { files: AttachmentInfo[]; tz: Zone; ai?: boolean }) {
  const { toast } = useApp();
  if (!files.length) return <p className="small muted">No files shared yet.</p>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {files.map((f) => (
        <div key={f.id} className="stack" style={{ gap: 6 }}>
        <button className="file-row" onClick={() => openAttachment(f.id).catch((e) => toast(errorMessage(e), "error"))}>
          <span className="file-ico">{f.content_type === "application/pdf" ? "PDF" : "IMG"}</span>
          <span className="grow" style={{ textAlign: "left", minWidth: 0 }}>
            <span className="file-name">{f.filename}</span>
            <span className="tiny muted">
              {sizeLabel(f.size)} · shared by {f.uploaded_by.name} · {fmtDateTime(f.created_at, tz)}
            </span>
          </span>
          <span className="small" style={{ color: "var(--teal-700)", fontWeight: 600 }}>Open</span>
        </button>
        {ai && <DocSummary attachmentId={f.id} initial={f.ai_summary} />}
        </div>
      ))}
    </div>
  );
}

export function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files || [])].slice(0, 10));
          e.target.value = "";
        }}
      />
      <button type="button" className="dropzone" onClick={() => ref.current?.click()}>
        <strong>+ Attach past reports or prescriptions</strong>
        <span className="tiny muted">PDF, JPG, PNG or WEBP · up to 5 MB each · only your doctor can open them</span>
      </button>
      {files.map((f, i) => (
        <div key={i} className="row between small" style={{ flexWrap: "nowrap" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {f.name} <span className="muted">({sizeLabel(f.size)})</span></span>
          <button type="button" className="btn btn-sm" style={{ background: "none", color: "var(--danger)" }} onClick={() => onChange(files.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
    </div>
  );
}

export async function uploadAll(apptId: number, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    try {
      await uploadFile(`/appointments/${apptId}/attachments`, f);
    } catch (e) {
      failed.push(`${f.name}: ${errorMessage(e)}`);
    }
  }
  return failed;
}

/** View shared files on an appointment and add more. */
export function FilesModal({ appt, tz, onClose, onChanged }: { appt: Appointment; tz: Zone; onClose: () => void; onChanged: () => void }) {
  const { session, toast } = useApp();
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const other = session?.user.role === "doctor" ? appt.patient.name : `Dr. ${appt.doctor.name}`;
  const closed = appt.status === "cancelled" || appt.status === "declined";

  const send = async () => {
    setBusy(true);
    setError("");
    const failed = await uploadAll(appt.id, pending);
    setBusy(false);
    if (failed.length) setError(failed.join(" "));
    else toast(`Shared with ${other}.`);
    setPending([]);
    onChanged();
  };

  return (
    <Modal title="Reports & documents" subtitle={`Shared between you and ${other} for this appointment`} onClose={onClose}>
      <div className="stack">
        <FileList files={appt.attachments} tz={tz} />
        {!closed && (
          <>
            <FilePicker files={pending} onChange={setPending} />
            {error && <div className="alert alert-error small">{error}</div>}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-dark" disabled={!pending.length || busy} onClick={send}>
                {busy && <span className="spinner" />} Send {pending.length || ""} file{pending.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
