/**
 * Build map pins for competitor visualization from market_data + report competitors.
 */

export type CompetitorMapTier = 'site' | 'direct' | 'semi_direct' | 'substitute' | 'traffic' | 'other';

export type CompetitorMapPin = {
  lat: number;
  lng: number;
  name: string;
  tier: CompetitorMapTier;
  distanceMi?: number;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tierFromThreat(threat: string | undefined, category: string | undefined): CompetitorMapTier {
  const t = String(threat ?? '').toLowerCase();
  const c = String(category ?? '').toLowerCase();
  if (t.includes('high') || t.includes('高') || c.includes('direct') || c.includes('直接')) {
    return 'direct';
  }
  if (c.includes('semi') || c.includes('半直接') || c.includes('indirect') || c.includes('间接')) {
    return 'semi_direct';
  }
  if (c.includes('substitut') || c.includes('替代') || c.includes('boba') || c.includes('奶茶')) {
    return 'substitute';
  }
  if (c.includes('traffic') || c.includes('流量')) return 'traffic';
  return 'other';
}

function pinsFromGoogleSamples(
  summary: Record<string, unknown> | undefined,
  nameToTier: Map<string, CompetitorMapTier>,
): CompetitorMapPin[] {
  const g = Array.isArray(summary?.sample_competitors_google)
    ? summary.sample_competitors_google
    : [];
  const out: CompetitorMapPin[] = [];
  for (const row of g) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const lat = num(r.lat);
    const lng = num(r.lng);
    const name = String(r.name ?? '').trim();
    if (!name || lat === null || lng === null) continue;
    const tier = nameToTier.get(name.toLowerCase()) ?? 'other';
    out.push({ lat, lng, name, tier });
  }
  return out;
}

export function buildCompetitorMapPins(input: {
  marketData?: Record<string, unknown> | null;
  reportCompetitors?: unknown[];
}): { center: { lat: number; lng: number } | null; pins: CompetitorMapPin[] } {
  const md = input.marketData ?? {};
  const geo = md.geocode as { lat?: number; lng?: number } | undefined;
  const centerLat = num(geo?.lat);
  const centerLng = num(geo?.lng);

  const nameToTier = new Map<string, CompetitorMapTier>();
  const reportRows = Array.isArray(input.reportCompetitors) ? input.reportCompetitors : [];
  for (const row of reportRows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? '').trim();
    if (!name) continue;
    nameToTier.set(
      name.toLowerCase(),
      tierFromThreat(String(r.threat_level ?? ''), String(r.category ?? '')),
    );
  }

  const summary =
    (md.summary as Record<string, unknown> | undefined) ??
    ((md.external_data as Record<string, unknown> | undefined)?.summary as
      | Record<string, unknown>
      | undefined);

  const pins = pinsFromGoogleSamples(summary, nameToTier);

  if (centerLat !== null && centerLng !== null) {
    return {
      center: { lat: centerLat, lng: centerLng },
      pins,
    };
  }

  if (pins.length > 0) {
    const avgLat = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
    const avgLng = pins.reduce((s, p) => s + p.lng, 0) / pins.length;
    return { center: { lat: avgLat, lng: avgLng }, pins };
  }

  return { center: null, pins: [] };
}

/** Google Static Maps image URL (server-side only — requires GOOGLE_MAPS_API_KEY). */
export function buildGoogleStaticMapUrl(input: {
  center: { lat: number; lng: number };
  pins: CompetitorMapPin[];
  width?: number;
  height?: number;
}): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return null;

  const w = input.width ?? 640;
  const h = input.height ?? 360;
  const markers: string[] = [
    `color:green|label:S|${input.center.lat},${input.center.lng}`,
  ];

  const colorByTier: Record<CompetitorMapTier, string> = {
    site: 'green',
    direct: 'red',
    semi_direct: 'orange',
    substitute: 'blue',
    traffic: 'purple',
    other: 'gray',
  };

  for (const p of input.pins.slice(0, 12)) {
    const color = colorByTier[p.tier] ?? 'gray';
    const label = p.name.charAt(0).toUpperCase().slice(0, 1);
    markers.push(`color:${color}|label:${label}|${p.lat},${p.lng}`);
  }

  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  url.searchParams.set('size', `${w}x${h}`);
  url.searchParams.set('scale', '2');
  url.searchParams.set('maptype', 'roadmap');
  url.searchParams.set('key', key);
  url.searchParams.set('center', `${input.center.lat},${input.center.lng}`);
  url.searchParams.set('zoom', '14');
  for (const m of markers) {
    url.searchParams.append('markers', m);
  }
  return url.toString();
}
