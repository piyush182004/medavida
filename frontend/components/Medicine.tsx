"use client";

import { useState } from "react";
import { errorMessage, openProtected, type Medicine, type Prescription, type Zone } from "@/lib/api";
import { STORES, drugInfo, findPharmacies, geocode, type DrugInfo, type Pharmacy } from "@/lib/pharmacy";
import { ZONE_INFO, fmtDateTime } from "@/lib/time";
import { Empty, ErrorBox, Modal } from "./ui";
import { IconExternal, IconPin } from "./Icons";

function StoreLinks({ medicine, tz }: { medicine: string; tz: Zone }) {
  const mine = ZONE_INFO[tz].region;
  const order = [mine, ...(["IN", "UK", "US"] as const).filter((r) => r !== mine)];
  const [showAll, setShowAll] = useState(false);
  return (
    <div>
      {(showAll ? order : [mine]).map((r) => (
        <div key={r} style={{ marginTop: 8 }}>
          <div className="tiny muted">Buy online · {STORES[r].label}</div>
          <div className="store-links">
            {STORES[r].stores.map((s) => (
              <a key={s.name} href={s.url(medicine)} target="_blank" rel="noopener noreferrer">
                {s.name} ↗
              </a>
            ))}
          </div>
        </div>
      ))}
      <button className="btn btn-sm" style={{ padding: "4px 0", background: "none", color: "var(--teal-700)" }} onClick={() => setShowAll((s) => !s)}>
        {showAll ? "Show fewer stores" : "Show stores in other countries"}
      </button>
    </div>
  );
}

function MedicineRow({ m, tz }: { m: Medicine; tz: Zone }) {
  const [info, setInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [nearby, setNearby] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const lookup = async () => {
    setLoading(true);
    setErr("");
    try {
      setInfo(await drugInfo(m.name));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="med">
      <div className="row between">
        <div>
          <strong>{m.name}</strong>
          <div className="small muted">{[m.dosage, m.frequency, m.duration].filter(Boolean).join(" · ") || "As directed"}</div>
          {m.instructions && <div className="small" style={{ marginTop: 4 }}>{m.instructions}</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={lookup} disabled={loading}>
            {loading ? <span className="spinner" /> : null} What is this?
          </button>
          <button className="btn btn-dark btn-sm" onClick={() => setNearby(true)}>
            <IconPin size={14} /> Nearby pharmacies
          </button>
        </div>
      </div>
      {info !== undefined && (
        <div className="alert alert-ok small" style={{ marginTop: 10 }}>
          {info ? (
            <>
              {info.text}{" "}
              <a className="tiny" href={info.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                Source: {info.source} ↗
              </a>
            </>
          ) : (
            <>
              No reference entry found for “{m.name}”. Try the store links below — their product pages include full medicine details — or ask your pharmacist.
            </>
          )}
        </div>
      )}
      {err && <div className="alert alert-error small" style={{ marginTop: 10 }}>{err}</div>}
      <StoreLinks medicine={m.name} tz={tz} />
      {nearby && (
        <Modal title={`Where to get ${m.name}`} subtitle="Real pharmacies near you from OpenStreetMap. Stock isn't published — call ahead to check availability." onClose={() => setNearby(false)}>
          <PharmacyFinder compact />
        </Modal>
      )}
    </div>
  );
}

export function PrescriptionCard({ rx, tz, viewer }: { rx: Prescription; tz: Zone; viewer: "doctor" | "patient" }) {
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <h3>{viewer === "patient" ? `Dr. ${rx.doctor.name}` : rx.patient.name}</h3>
          <div className="small muted">
            Issued {fmtDateTime(rx.created_at, tz)}
            {rx.appointment_id ? ` · appointment #${rx.appointment_id}` : ""}
          </div>
        </div>
        <span className="chip">{rx.items.length} medicine{rx.items.length > 1 ? "s" : ""}</span>
      </div>
      {viewer === "patient"
        ? rx.items.map((m, i) => <MedicineRow key={i} m={m} tz={tz} />)
        : rx.items.map((m, i) => (
            <div key={i} className="med">
              <strong>{m.name}</strong>
              <div className="small muted">{[m.dosage, m.frequency, m.duration].filter(Boolean).join(" · ")}</div>
              {m.instructions && <div className="small">{m.instructions}</div>}
            </div>
          ))}
      {rx.notes && <p className="small" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}><strong>Doctor&apos;s notes:</strong> {rx.notes}</p>}
      {rx.has_file && (
        <button className="file-row" style={{ marginTop: 12 }} onClick={() => openProtected(`/prescriptions/${rx.id}/file`).catch((e) => alert(errorMessage(e)))}>
          <span className="file-ico">RX</span>
          <span className="grow" style={{ textAlign: "left", minWidth: 0 }}>
            <span className="file-name">Original prescription · {rx.file_name}</span>
            <span className="tiny muted">The doctor&apos;s own PDF or handwritten copy</span>
          </span>
          <span className="small" style={{ color: "var(--teal-700)", fontWeight: 600 }}>Open</span>
        </button>
      )}
      {viewer === "patient" && (
        <p className="tiny muted" style={{ marginTop: 12 }}>
          Links open each retailer&apos;s own search page. SlotZero is not affiliated with these stores. Prescription-only medicines need a valid prescription.
        </p>
      )}
    </div>
  );
}

export function PharmacyFinder({ compact = false }: { compact?: boolean }) {
  const [place, setPlace] = useState("");
  const [radius, setRadius] = useState(3000);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [results, setResults] = useState<Pharmacy[]>([]);
  const [where, setWhere] = useState("");
  const [error, setError] = useState("");

  const search = async (lat: number, lon: number, label: string) => {
    setState("loading");
    setError("");
    try {
      setResults(await findPharmacies(lat, lon, radius));
      setWhere(label);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setState("idle");
    }
  };

  const useLocation = () => {
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location. Search by city or area instead.");
      return;
    }
    setState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => search(pos.coords.latitude, pos.coords.longitude, "your current location"),
      () => {
        setState("idle");
        setError("Location permission was denied. Type your area or city instead.");
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const searchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (place.trim().length < 2) {
      setError("Type an area, city or postcode.");
      return;
    }
    setState("loading");
    setError("");
    try {
      const g = await geocode(place.trim());
      if (!g) {
        setState("idle");
        setError(`We couldn't find "${place}". Try a nearby city or postcode.`);
        return;
      }
      await search(g.lat, g.lon, g.label);
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  };

  return (
    <div className="stack">
      <div className={compact ? "" : "card card-mint"}>
        <div className="row between">
          {!compact && (
            <div>
              <h3>Pharmacies near you</h3>
              <p>Live results from OpenStreetMap — real, community-mapped pharmacies. Nothing is made up.</p>
            </div>
          )}
          <button className="btn btn-dark" onClick={useLocation} disabled={state === "loading"}>
            <IconPin size={18} /> Use my location
          </button>
        </div>
        <form className="row" style={{ marginTop: 14 }} onSubmit={searchPlace}>
          <input className="input grow" style={{ minWidth: 200 }} placeholder="Or search an area, e.g. Koramangala Bengaluru, SW1A 1AA, Brooklyn NY" value={place} onChange={(e) => setPlace(e.target.value)} />
          <select className="select" style={{ width: 120 }} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius">
            <option value={1500}>1.5 km</option>
            <option value={3000}>3 km</option>
            <option value={5000}>5 km</option>
            <option value={10000}>10 km</option>
          </select>
          <button className="btn btn-primary" disabled={state === "loading"}>Search</button>
        </form>
      </div>
      {error && <ErrorBox message={error} />}
      {state === "loading" && (
        <div className="row muted"><span className="spinner" /> Searching OpenStreetMap…</div>
      )}
      {state === "done" &&
        (results.length === 0 ? (
          <Empty title="No pharmacies mapped nearby">Try a larger radius. OpenStreetMap coverage varies by area.</Empty>
        ) : (
          <div className="card">
            <div className="small muted">{results.length} pharmacies within {radius / 1000} km of {where}</div>
            {results.slice(0, 30).map((p) => (
              <div key={p.id} className="pharmacy">
                <div>
                  <strong>{p.name}</strong>
                  <div className="small muted">{p.address || "Address not listed on OpenStreetMap"}</div>
                  <div className="tiny muted">
                    {p.distanceKm.toFixed(1)} km away{p.openingHours ? ` · Hours: ${p.openingHours}` : ""}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                </div>
                <div className="row" style={{ alignItems: "flex-start", gap: 6 }}>
                  {p.phone && <a className="btn btn-outline btn-sm" href={`tel:${p.phone.replace(/s/g, "")}`}>Call</a>}
                  <a className="btn btn-outline btn-sm" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`}>
                    Directions <IconExternal size={14} />
                  </a>
                </div>
              </div>
            ))}
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Map data ©{" "}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>
                OpenStreetMap contributors
              </a>
              . Opening hours may be out of date — call ahead.
            </p>
          </div>
        ))}
    </div>
  );
}
