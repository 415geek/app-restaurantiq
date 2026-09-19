/**
 * Upload a built boundary mirror to Vercel Blob.
 *
 *   BLOB_READ_WRITE_TOKEN=... npx tsx scripts/upload-geometry-mirror.ts \
 *     --dir qa/out/geometry-mirror --layer bg
 *
 * Pairs with scripts/build-geometry-mirror.ts. Uses the Blob REST API directly
 * rather than @vercel/blob so this stays a zero-dependency script — it runs a
 * few times a year and should not pull a package into the app's tree for it.
 *
 * Prints the base URL to put in IQ_GEOMETRY_MIRROR_URL. Objects are uploaded
 * WITHOUT a random suffix so the path is stable and re-running replaces in
 * place: the reader builds `{base}/{layer}/{county}.json` and must not have to
 * learn a new URL every upload.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const BLOB_API = 'https://blob.vercel-storage.com';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function putObject(token: string, pathname: string, body: Buffer): Promise<string> {
  const res = await fetch(`${BLOB_API}/${pathname}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-version': '7',
      'x-content-type': 'application/json',
      // Stable paths: the reader derives the URL from county + layer, so a random
      // suffix would make every upload a breaking change.
      'x-add-random-suffix': '0',
      'x-cache-control-max-age': String(30 * 24 * 3600),
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error('no url in blob response');
  return json.url;
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error('BLOB_READ_WRITE_TOKEN is required (Vercel → Storage → your Blob store → .env.local tab)');
    process.exitCode = 2;
    return;
  }
  const dir = resolve(arg('dir') ?? 'qa/out/geometry-mirror');
  const layers = (arg('layer') ?? 'bg').split(',').map((s) => s.trim()).filter(Boolean);

  const urls: string[] = [];
  const failures: string[] = [];
  let bytes = 0;

  for (const layer of layers) {
    const layerDir = resolve(dir, layer);
    let files: string[];
    try {
      files = readdirSync(layerDir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      failures.push(`${layer}: directory not found at ${layerDir}`);
      continue;
    }
    for (const f of files) {
      const full = resolve(layerDir, f);
      const body = readFileSync(full);
      try {
        const url = await putObject(token, `${layer}/${f}`, body);
        urls.push(url);
        bytes += statSync(full).size;
        console.log(`${layer}/${f}  ${(body.length / 1_048_576).toFixed(1)} MB → ${url}`);
      } catch (e) {
        failures.push(`${layer}/${f}: ${(e as Error).message}`);
        console.error(`FAILED ${layer}/${f}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\n${urls.length} object(s), ${(bytes / 1_048_576).toFixed(1)} MB uploaded`);
  if (failures.length) {
    // Same rule as the build script: never end on a success message when the
    // mirror is incomplete — the missing counties fall back to TIGERweb.
    console.error(`\n${failures.length} FAILED — the mirror is incomplete:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }
  if (urls.length) {
    // Every object shares the store's base; strip the layer/file to get it.
    const base = urls[0].replace(/\/[^/]+\/[^/]+$/, '');
    console.log(`\nIQ_GEOMETRY_MIRROR_URL=${base}`);
  }
}

void main();
