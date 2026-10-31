import type { Zone } from "./api";

export const ZONES: Zone[] = ["Asia/Kolkata", "Europe/London", "America/New_York"];

export const ZONE_INFO: Record<Zone, { city: string; country: string; region: "IN" | "UK" | "US" }> = {
  "Asia/Kolkata": { city: "Kolkata", country: "India", region: "IN" },
  "Europe/London": { city: "London", country: "United Kingdom", region: "UK" },
  "America/New_York": { city: "New York", country: "United States", region: "US" },
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function part(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(new Date(iso));
}

/** Short zone label: IST, GMT/BST, EST/EDT. */
export function tzAbbr(iso: string | Date, tz: string): string {
  const locale = tz === "America/New_York" ? "en-US" : "en-GB";
  const parts = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(iso));
  const name = parts.find((p) => p.type === "timeZoneName")?.value || tz;
  return tz === "Asia/Kolkata" && name.startsWith("GMT") ? "IST" : name;
}

export const fmtTime = (iso: string | Date, tz: string) =>
  part(iso, tz, { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDate = (iso: string | Date, tz: string) =>
  part(iso, tz, { weekday: "short", day: "numeric", month: "short" });

export const fmtLongDate = (iso: string | Date, tz: string) =>
  part(iso, tz, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const fmtDateTime = (iso: string | Date, tz: string) =>
  `${fmtDate(iso, tz)}, ${fmtTime(iso, tz)} ${tzAbbr(iso, tz)}`;

/** YYYY-MM-DD of an instant in a zone. */
export const localDateKey = (iso: string | Date, tz: string) =>
  part(iso, tz, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");

export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  const abs = Math.abs(mins);
  const unit = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return mins >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Minutes since local midnight of an instant in a zone. */
export function localMinutes(iso: string | Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

/** Monday = 0 for a YYYY-MM-DD key. */
export const weekdayOf = (dateKey: string) => (new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7;

export const mondayOf = (dateKey: string) => addDays(dateKey, -weekdayOf(dateKey));

export const fmtKey = (dateKey: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${dateKey}T12:00:00Z`));

export const HOSPITAL_COLORS = ["#12c2b0", "#6c8cff", "#f0a43a", "#d264b6", "#4fb06d", "#e5675a"];
export const ONLINE_COLOR = "#9aa7a9";
