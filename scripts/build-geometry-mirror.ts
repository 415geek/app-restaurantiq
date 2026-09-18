/**
 * Build the block-group / tract boundary mirror that D2 reads instead of
 * querying TIGERweb per report (lib/iq/data/geometry-mirror.ts).
 *
 *   npx tsx scripts/build-geometry-mirror.ts --counties 06075,06081,06037
 *   npx tsx scripts/build-geometry-mirror.ts --counties 06037 --layer bg --out qa/out/geometry-mirror
 *
 * Run it anywhere that can reach tigerweb.geo.census.gov — a laptop is fine —
 * then upload the `out` directory to any static host and point
 * IQ_GEOMETRY_MIRROR_URL at it:
 *
 *   supabase storage cp -r qa/out/geometry-mirror ss:///iq-geometry
 *   npx wrangler r2 object put iq-geometry/... --file ...
 *
 * Census boundaries are annual, so this runs about once a year, plus whenever a
 * new county needs covering. Coordinates are rounded to COORD_DECIMALS, which is
 * roughly a metre — far finer than a trade-area ring needs — and typically halves
 * the file size.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIGERWEB_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer';
const LAYERS = { bg: 1, tract: 0 } as const;
type Layer = keyof typeof LAYERS;
/** ~1 m. Ring allocation works at hundreds of metres; more precision is only bytes. */
const COORD_DECIMALS = 5;
const PAGE_SIZE = 1000;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const round = (n: number) => Number(n.toFixed(COORD_DECIMALS));
function roundCoords(c: unknown): unknown {
  if (typeof c === 'number') return round(c);
  return Array.isArray(c) ? c.map(roundCoords) : c;
}

interface Feature {
  geoid: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

/**
 * ArcGIS caps a response at its own `maxRecordCount`, so paginate with
 * resultOffset and stop only when a page comes back short. Taking the first page
 * as the whole county is the same mistake §3.1 fixed on the Places side.
 */
async function fetchLayer(layer: Layer, county: string): Promise<Feature[]> {
  const state = county.slice(0, 2);
  const cty = county.slice(2);
  const out: Feature[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`${TIGERWEB_BASE}/${LAYERS[layer]}/query`);
    url.searchParams.set('where', `STATE='${state}' AND COUNTY='${cty}'`);
    url.searchParams.set('outFields', 'GEOID');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('resultOffset', String(offset));
    url.searchParams.set('resultRecordCount', String(PAGE_SIZE));
    url.searchParams.set('f', 'geojson');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { features?: unknown[]; error?: { message?: string } };
    if (json.error) throw new Error(json.error.message ?? 'arcgis error');
    const page = Array.isArray(json.features) ? json.features : [];
    for (const f of page) {
      const props = (f as { properties?: Record<string, unknown> }).properties ?? {};
      const geoid = props.GEOID ?? props.geoid;
      const geometry = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
      if (typeof geoid !== 'string' || !geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue;
      out.push({ geoid, geometry: { type: geometry.type, coordinates: roundCoords(geometry.coordinates) } });
    }
    if (page.length < PAGE_SIZE) return out;
  }
}

async function main() {
  const counties = (arg('counties') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!counties.length) {
    console.error('usage: --counties 06075,06081 [--layer bg|tract|both] [--out DIR] [--year 2023]');
    process.exitCode = 2;
    return;
  }
  const layers: Layer[] = arg('layer') === 'bg' ? ['bg'] : arg('layer') === 'tract' ? ['tract'] : ['bg', 'tract'];
  const outDir = resolve(arg('out') ?? 'qa/out/geometry-mirror');
  const year = Number(arg('year') ?? new Date().getFullYear() - 2);

  const failures: string[] = [];
  let written = 0;
  let bytes = 0;

  for (const layer of layers) {
    mkdirSync(resolve(outDir, layer), { recursive: true });
    for (const county of counties) {
      if (!/^\d{5}$/.test(county)) {
        failures.push(`${county}: not a 5-digit county FIPS`);
        console.error(`skip ${county}: not a 5-digit county FIPS`);
        continue;
      }
      const file = resolve(outDir, layer, `${county}.json`);
      // Resumable: a long run that dies partway should not re-download what it
      // already has. Delete the file to force a refresh.
      if (existsSync(file) && !process.argv.includes('--force')) {
        console.log(`${layer}/${county}.json  (exists, skipped — pass --force to refetch)`);
        continue;
      }
      try {
        const features = await fetchLayer(layer, county);
        if (!features.length) {
          failures.push(`${county} ${layer}: no features returned`);
          console.error(`FAILED ${county} ${layer}: no features returned`);
          continue;
        }
        const body = JSON.stringify({ year, layer, county, features });
        writeFileSync(file, body);
        written++;
        bytes += body.length;
        console.log(`${layer}/${county}.json  ${features.length} features  ${(body.length / 1_048_576).toFixed(1)} MB`);
      } catch (e) {
        failures.push(`${county} ${layer}: ${(e as Error).message}`);
        console.error(`FAILED ${county} ${layer}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n${written} file(s), ${(bytes / 1_048_576).toFixed(1)} MB total → ${outDir}`);
  if (failures.length) {
    // Never end on "upload it" when the directory is incomplete: a half-mirror
    // silently falls back to TIGERweb for the counties it is missing, which is
    // the dependency this whole thing exists to remove.
    console.error(`\n${failures.length} FAILED — the mirror is incomplete, fix these before uploading:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log('upload it, then set IQ_GEOMETRY_MIRROR_URL to the base that serves <layer>/<county>.json');
}

void main();
