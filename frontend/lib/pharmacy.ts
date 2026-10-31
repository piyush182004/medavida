/** Real online pharmacies. Each link opens that retailer's own search for the medicine. */

export interface Store {
  name: string;
  url: (q: string) => string;
}

const enc = encodeURIComponent;
const slug = (q: string) => q.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const STORES: Record<"IN" | "UK" | "US", { label: string; stores: Store[] }> = {
  IN: {
    label: "India",
    stores: [
      { name: "Tata 1mg", url: (q) => `https://www.1mg.com/search/all?name=${enc(q)}` },
      { name: "PharmEasy", url: (q) => `https://pharmeasy.in/search/all?name=${enc(q)}` },
      { name: "Apollo Pharmacy", url: (q) => `https://www.apollopharmacy.in/search-medicines/${enc(q)}` },
      { name: "Netmeds", url: (q) => `https://www.netmeds.com/catalogsearch/result/${enc(q)}/all` },
      { name: "Google (all stores)", url: (q) => `https://www.google.com/search?q=${enc(q + " buy online")}&gl=in` },
    ],
  },
  UK: {
    label: "United Kingdom",
    stores: [
      { name: "Boots", url: (q) => `https://www.boots.com/sitesearch?searchTerm=${enc(q)}` },
      { name: "Superdrug", url: (q) => `https://www.superdrug.com/search?text=${enc(q)}` },
      { name: "NHS medicine guide", url: (q) => `https://www.nhs.uk/search/results?q=${enc(q)}` },
      { name: "Google (all stores)", url: (q) => `https://www.google.com/search?q=${enc(q + " buy online")}&gl=uk` },
    ],
  },
  US: {
    label: "United States",
    stores: [
      { name: "CVS Pharmacy", url: (q) => `https://www.cvs.com/search?searchTerm=${enc(q)}` },
      { name: "Walgreens", url: (q) => `https://www.walgreens.com/search/results.jsp?Ntt=${enc(q)}` },
      { name: "GoodRx prices", url: (q) => `https://www.goodrx.com/${slug(q)}` },
      {
        name: "MedlinePlus info",
        url: (q) => `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=${enc(q)}`,
      },
      { name: "Google (all stores)", url: (q) => `https://www.google.com/search?q=${enc(q + " buy online")}&gl=us` },
    ],
  },
};

export interface Pharmacy {
  id: number;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  phone?: string;
  openingHours?: string;
}

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Live pharmacies from OpenStreetMap (Overpass API, no key). */
export async function findPharmacies(lat: number, lon: number, radiusM: number): Promise<Pharmacy[]> {
  const query = `[out:json][timeout:25];(node["amenity"="pharmacy"](around:${radiusM},${lat},${lon});way["amenity"="pharmacy"](around:${radiusM},${lat},${lon}););out center 60;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error("The OpenStreetMap pharmacy service is busy. Please try again in a moment.");
  const json = await res.json();
  type El = { id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
  return (json.elements as El[])
    .map((el) => {
      const pLat = el.lat ?? el.center?.lat;
      const pLon = el.lon ?? el.center?.lon;
      if (pLat === undefined || pLon === undefined) return null;
      const t = el.tags || {};
      const address = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] || t["addr:city"], t["addr:postcode"]]
        .filter(Boolean)
        .join(", ");
      return {
        id: el.id,
        name: t.name || t.brand || "Pharmacy (unnamed on OpenStreetMap)",
        lat: pLat,
        lon: pLon,
        distanceKm: haversineKm([lat, lon], [pLat, pLon]),
        address,
        phone: t.phone || t["contact:phone"],
        openingHours: t.opening_hours,
      } as Pharmacy;
    })
    .filter((p): p is Pharmacy => p !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Place search (OpenStreetMap Nominatim) for users who don't share location. */
export async function geocode(place: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error("Location search is unavailable right now. Try 'Use my location' instead.");
  const rows = await res.json();
  if (!rows.length) return null;
  return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon), label: rows[0].display_name };
}

export interface DrugInfo {
  text: string;
  source: string;
  url: string;
}

/** "Calpol 650 mg tablet" -> ["Calpol 650 mg tablet", "Calpol"] — try the full name, then the brand word. */
function nameVariants(name: string): string[] {
  const full = name.trim();
  const core = full.replace(/d+(.d+)?s*(mg|mcg|g|ml|iu|%)?/gi, "").replace(/(tablets?|tabs?|capsules?|caps?|syrup|suspension|injection|cream|drops?)/gi, "").replace(/s+/g, " ").trim();
  return Array.from(new Set([full, core, core.split(" ")[0]].filter((x) => x.length >= 3)));
}

async function fromOpenFda(term: string): Promise<DrugInfo | null> {
  const t = encodeURIComponent(`"${term}"`);
  const res = await fetch(`https://api.fda.gov/drug/label.json?search=openfda.generic_name:${t}+openfda.brand_name:${t}&limit=1`);
  if (!res.ok) return null;
  const r = (await res.json()).results?.[0];
  const text: string | undefined = (r?.purpose || r?.indications_and_usage)?.[0];
  if (!text) return null;
  return {
    text: text.length > 420 ? text.slice(0, 420).trimEnd() + "…" : text,
    source: "US FDA drug label (openFDA)",
    url: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=${encodeURIComponent(term)}`,
  };
}

async function fromWikipedia(term: string): Promise<DrugInfo | null> {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, "_"))}`);
  if (!res.ok) return null;
  const j = await res.json();
  if (j.type !== "standard" || !j.extract) return null;
  const medical = /drug|medicat|medicine|analges|antibiot|tablet|paracetamol|pharmac|treat|dose|pain|fever|brand/i;
  if (!medical.test(j.extract)) return null;
  return { text: j.extract, source: "Wikipedia", url: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}` };
}

/** Real reference info: official FDA label first, then the Wikipedia summary (covers Indian/UK brands like Calpol). */
export async function drugInfo(name: string): Promise<DrugInfo | null> {
  for (const v of nameVariants(name)) {
    const hit = (await fromOpenFda(v).catch(() => null)) || (await fromWikipedia(v).catch(() => null));
    if (hit) return hit;
  }
  return null;
}
