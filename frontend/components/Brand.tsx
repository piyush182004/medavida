export const MEDAVIDA_URL = "https://medavida.com/";

export function SlotZeroMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0b1213" />
      <rect x="7" y="8" width="7" height="5" rx="1.6" fill="#2a3739" />
      <rect x="18" y="8" width="7" height="5" rx="1.6" fill="#12c2b0" />
      <rect x="7" y="16" width="7" height="5" rx="1.6" fill="#2a3739" />
      <rect x="18" y="16" width="7" height="5" rx="1.6" fill="#2a3739" />
      <rect x="7" y="24" width="18" height="2" rx="1" fill="#12c2b0" opacity=".55" />
    </svg>
  );
}

/** Neutral dot-grid mark used next to the "MedaVida hackathon" credit. */
export function DotGrid({ size = 18, color = "#12c2b0" }: { size?: number; color?: string }) {
  const dots = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) dots.push(<circle key={`${r}${c}`} cx={4 + c * 8} cy={4 + r * 8} r={2.6} fill={color} />);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {dots}
    </svg>
  );
}

export function MedaVidaCredit({ dark = false }: { dark?: boolean }) {
  return (
    <a className="medavida-pill" href={MEDAVIDA_URL} target="_blank" rel="noopener noreferrer" style={dark ? { background: "#141e20", borderColor: "#2a3739", color: "#fff" } : undefined}>
      <DotGrid />
      <span>
        Built at the <strong>MedaVida</strong> Intern Hackathon
      </span>
    </a>
  );
}
