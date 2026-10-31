import { MedaVidaCredit } from "./Brand";
import { IconCheck } from "./Icons";

export function AuthSide({ title }: { title: string }) {
  return (
    <aside className="auth-side">
      <div>
        <div className="eyebrow">SlotZero</div>
        <h2 style={{ fontSize: "2.2rem", marginTop: 12 }}>{title}</h2>
        <ul style={{ listStyle: "none", padding: 0, marginTop: 28, display: "grid", gap: 14, color: "#b9c6c7" }}>
          {[
            "Never double-booked — every booking is re-checked on the server",
            "Your local time, always labelled with the zone",
            "Video consults with one click, no app needed",
            "Prescriptions with real pharmacies near you",
          ].map((t) => (
            <li key={t} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              <span style={{ color: "var(--teal)" }}><IconCheck size={18} /></span> {t}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <MedaVidaCredit dark />
      </div>
    </aside>
  );
}
