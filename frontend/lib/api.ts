export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const SESSION_KEY = "slotzero.session";

export type Role = "doctor" | "patient" | "hospital";

export const dashboardPath = (role: Role) => (role === "doctor" ? "/doctor" : role === "hospital" ? "/hospital" : "/patient");
export const ROLE_LABEL: Record<Role, string> = { doctor: "Doctor", patient: "Patient", hospital: "Hospital" };

export interface Money {
  amount: number;
  currency: string;
}

export function fmtMoney(m: Money | null | undefined): string {
  if (!m || m.amount == null) return "—";
  try {
    return new Intl.NumberFormat(m.currency === "INR" ? "en-IN" : m.currency === "USD" ? "en-US" : "en-GB", {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: 0,
    }).format(m.amount);
  } catch {
    return `${m.amount} ${m.currency}`;
  }
}
export type Zone = "Asia/Kolkata" | "Europe/London" | "America/New_York";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  timezone: Zone;
  specialization?: string;
  slot_minutes?: number;
  hospital?: Hospital;
}

export interface Session {
  token: string;
  user: User;
}

export type ApptStatus = "pending" | "proposed" | "confirmed" | "declined" | "cancelled";
export const HELD: ApptStatus[] = ["pending", "proposed", "confirmed"];

export interface Hospital {
  id: number;
  name: string;
  city: string;
  address: string;
  phone?: string;
  timezone?: Zone;
  currency?: string;
  doctor_count?: number;
}

export interface AttachmentInfo {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: { name: string; role: Role };
  created_at: string;
  ai_summary?: string | null;
}

export interface Appointment {
  id: number;
  start_utc: string;
  end_utc: string;
  status: ApptStatus;
  mode: "in_person" | "online";
  meeting_url: string | null;
  reason: string;
  doctor_note: string | null;
  hospital: Hospital | null;
  fee: Money | null;
  ai_brief?: string | null;
  attachments: AttachmentInfo[];
  attachment_count?: number;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  doctor: { id: number; name: string; timezone: Zone; specialization: string };
  patient: { id: number; name: string; timezone: Zone; email?: string };
  can_cancel: boolean;
  can_reschedule?: boolean;
  can_accept?: boolean;
  can_confirm?: boolean;
  can_decline?: boolean;
  can_propose?: boolean;
  warnings?: string[];
  replayed?: boolean;
}

export interface Doctor {
  id: number;
  name: string;
  specialization: string;
  bio: string;
  timezone: Zone;
  slot_minutes: number;
  hours: { weekday: number; start: string; end: string; hospital_id: number | null; hospital_name: string | null }[];
  hospitals: Hospital[];
  fees: { online: Money; hospitals: (Money & { hospital_id: number; name: string })[] };
  next_available_utc: string | null;
}

export interface Slot {
  start_utc: string;
  end_utc: string;
  hospital: { id: number; name: string } | null;
}

export interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface Prescription {
  id: number;
  appointment_id: number | null;
  items: Medicine[];
  notes: string;
  has_file?: boolean;
  file_name?: string | null;
  created_at: string;
  doctor: { id: number; name: string };
  patient: { id: number; name: string; timezone: Zone };
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: { name: string; role: Role };
  appointment_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable (private mode) — session lives in memory only */
  }
  window.dispatchEvent(new Event("slotzero-session"));
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const session = loadSession();
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (session) headers["Authorization"] = `Bearer ${session.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(
      "Can't reach the SlotZero server. Check your connection — the free server can take ~30 seconds to wake up.",
      0
    );
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session) saveSession(null);
    const detail = data?.detail;
    throw new ApiError(typeof detail === "string" ? detail : `Request failed (${res.status}).`, res.status);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Multipart upload (no JSON content-type). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const session = loadSession();
  const fd = new FormData();
  fd.append("file", file);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      body: fd,
      headers: session ? { Authorization: `Bearer ${session.token}` } : {},
    });
  } catch {
    throw new ApiError("Upload failed — check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(typeof data?.detail === "string" ? data.detail : `Upload failed (${res.status}).`, res.status);
  return data as T;
}

/** Fetch a protected file with the session token and open it in a new tab. */
export const openAttachment = (id: number) => openProtected(`/attachments/${id}`);

export async function openProtected(path: string) {
  const session = loadSession();
  const win = window.open("", "_blank");
  const res = await fetch(`${API_URL}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) {
    win?.close();
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.detail || "Couldn't open that file.", res.status);
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
}

export const STATUS_LABEL: Record<ApptStatus, string> = {
  pending: "Awaiting doctor",
  proposed: "New time proposed",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
};

let aiStatusPromise: Promise<{ enabled: boolean; model: string }> | null = null;
/** Cached once per page load. */
export function aiStatus() {
  if (!aiStatusPromise) aiStatusPromise = api<{ enabled: boolean; model: string }>("/ai/status").catch(() => ({ enabled: false, model: "" }));
  return aiStatusPromise;
}
