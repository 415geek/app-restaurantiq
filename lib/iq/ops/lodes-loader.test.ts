import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createMemoryCache } from '@/lib/iq/data/context';
import { loadLodes, parseCountyList, parseWacHeader, parseWacLine, type WacRow } from './lodes-loader';

const HEADER = 'w_geocode,C000,CA01,CA02,CA03,CE01,CE02,CE03,CNS07,CNS12,CNS15,CNS18,CR04,createdate';

/** Build a sorted WAC-style CSV: `perCounty` blocks for each county prefix. */
function buildCsv(counties: string[], perCounty: number, extraLines: string[] = []): string {
  const lines = [HEADER];
  for (const c of [...counties].sort()) {
    for (let i = 0; i < perCounty; i++) {
      const geocode = `${c}${String(i + 1).padStart(10, '0')}`;
      const n = i + 1;
      lines.push(`${geocode},${n * 10},${n},${n * 2},${n * 3},1,2,3,4,5,6,${n * 7},8,20240101`);
    }
  }
  lines.push(...extraLines);
  return lines.join('\n') + '\n';
}

function gzSource(csv: string) {
  const buf = gzipSync(Buffer.from(csv, 'utf8'));
  return async () => Readable.from([buf]);
}

function collector() {
  const batches: WacRow[][] = [];
  return {
    batches,
    upsert: async (rows: WacRow[]) => {
      batches.push(rows);
    },
    rows: () => batches.flat(),
  };
}

test('lodes header/line parsing keeps mapped columns, drops others, filters by county', () => {
  const spec = parseWacHeader(HEADER);
  assert.equal(spec.geocodeIdx, 0);
  assert.equal(spec.colIndex.length, 12);
  assert.deepEqual(spec.missing, []);

  const row = parseWacLine('060816017001001,412,100,200,112,50,150,212,30,40,5,150,410,20240101', spec, ['06081'], 2022, 'ca');
  assert.ok(row);
  assert.equal(row.block_geoid, '060816017001001');
  assert.equal(row.year, 2022);
  assert.equal(row.state, 'ca');
  assert.equal(row.c000, 412);
  assert.equal(row.cns18, 150);
  assert.equal(row.cr04, 410);
  assert.equal('createdate' in row, false);

  // Other county → filtered out; short geocode → filtered out.
  assert.equal(parseWacLine('060750101001001,1,1,1,1,1,1,1,1,1,1,1,1,x', spec, ['06081'], 2022, 'ca'), null);
  assert.equal(parseWacLine('0608160170010,1,1,1,1,1,1,1,1,1,1,1,1,x', spec, ['06081'], 2022, 'ca'), null);

  // Missing columns are reported and stored as null; C000 falls back to 0.
  const partial = parseWacHeader('w_geocode,CA01,createdate');
  assert.ok(partial.missing.includes('C000'));
  const r2 = parseWacLine('060816017001001,7,20240101', partial, ['06081'], 2022, 'ca');
  assert.ok(r2);
  assert.equal(r2.c000, 0);
  assert.equal(r2.ca01, 7);
  assert.equal('ce01' in r2, false);

  assert.deepEqual(parseCountyList(' 06081, 06075 ,06081'), ['06081', '06075']);
  assert.throws(() => parseCountyList('6081'), /5 digits/);
});

test('loadLodes streams gz, filters counties, batches upserts and marks every county done', async () => {
  const csv = buildCsv(['06001', '06075', '06081', '06085'], 5, ['999999999999999,1,1,1,1,1,1,1,1,1,1,1,1,x']);
  const sink = collector();
  const progress = createMemoryCache();
  const logs: string[] = [];
  const r = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06081', '06075'],
    batchSize: 4,
    source: gzSource(csv),
    upsert: sink.upsert,
    progress,
    log: (m) => logs.push(m),
  });
  assert.equal(r.rows_upserted, 10);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.counties_done, ['06081', '06075']);
  assert.deepEqual(r.counties_remaining, []);
  assert.deepEqual(r.counties_skipped, []);
  assert.deepEqual(sink.batches.map((b) => b.length), [4, 4, 2]);
  const ids = sink.rows().map((x) => x.block_geoid);
  assert.ok(ids.every((g) => g.startsWith('06081') || g.startsWith('06075')));
  assert.equal(new Set(ids).size, 10);
  assert.equal(r.url, 'https://lehd.ces.census.gov/data/lodes/LODES8/ca/wac/ca_wac_S000_JT00_2022.csv.gz');
  // Progress recorded for the next run.
  const rec = await progress.get<{ done: string[] }>('iq360_ops_progress', 'lodes:ca:2022');
  assert.deepEqual(rec?.done, ['06075', '06081']);
  // Sorted early stop: the 06085 rows after the last requested county were never scanned.
  assert.ok(r.rows_scanned < 20, `scanned ${r.rows_scanned}`);
  assert.ok(logs.some((l) => /done/.test(l)));
});

test('loadLodes stops on budget, keeps partial county in counties_remaining, records only completed ones', async () => {
  const csv = buildCsv(['06001', '06013', '06075'], 6);
  const sink = collector();
  const progress = createMemoryCache();
  let clock = 0;
  // Every upsert "takes" 30 s; budget 100 s → soft deadline 90 s → stop after 3 flushes.
  const r = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06001', '06013', '06075'],
    batchSize: 2,
    budgetMs: 100_000,
    countiesPerRun: 3,
    now: () => clock,
    source: gzSource(csv),
    upsert: async (rows) => {
      clock += 30_000;
      await sink.upsert(rows);
    },
    progress,
    log: () => {},
  });
  assert.equal(r.truncated, true);
  assert.equal(r.truncated_reason, 'budget');
  assert.equal(r.rows_upserted, 6); // three batches of two, all inside 06001
  assert.deepEqual(r.counties_done, []);
  assert.deepEqual(r.counties_remaining, ['06001', '06013', '06075']);
  assert.equal(await progress.get('iq360_ops_progress', 'lodes:ca:2022'), null);

  // Run again with a wider budget: 06001 completes, 06013 is cut mid-way.
  clock = 0;
  const sink2 = collector();
  const r2 = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06001', '06013', '06075'],
    batchSize: 2,
    budgetMs: 160_000, // soft deadline 144 s → 5 flushes at 30 s
    countiesPerRun: 3,
    now: () => clock,
    source: gzSource(csv),
    upsert: async (rows) => {
      clock += 30_000;
      await sink2.upsert(rows);
    },
    progress,
    log: () => {},
  });
  assert.equal(r2.truncated, true);
  assert.equal(r2.rows_upserted, 10);
  assert.deepEqual(r2.counties_done, ['06001']);
  assert.deepEqual(r2.counties_remaining, ['06013', '06075']);
  const rec = await progress.get<{ done: string[] }>('iq360_ops_progress', 'lodes:ca:2022');
  assert.deepEqual(rec?.done, ['06001']);
});

test('loadLodes loads one county per call under a short budget and skips counties already done', async () => {
  const csv = buildCsv(['06001', '06013', '06075'], 3);
  const progress = createMemoryCache();
  const sink = collector();
  const r = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06075', '06001', '06013'],
    budgetMs: 60_000,
    source: gzSource(csv),
    upsert: sink.upsert,
    progress,
    log: () => {},
  });
  assert.equal(r.truncated, false);
  assert.deepEqual(r.counties_done, ['06075']);
  assert.deepEqual(r.counties_remaining, ['06001', '06013']);
  assert.ok(sink.rows().every((x) => x.block_geoid.startsWith('06075')));

  // Next invocation with the same query string continues with the next county.
  const sink2 = collector();
  const r2 = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06075', '06001', '06013'],
    budgetMs: 60_000,
    source: gzSource(csv),
    upsert: sink2.upsert,
    progress,
    log: () => {},
  });
  assert.deepEqual(r2.counties_skipped, ['06075']);
  assert.deepEqual(r2.counties_done, ['06001']);
  assert.deepEqual(r2.counties_remaining, ['06013']);
  assert.ok(sink2.rows().every((x) => x.block_geoid.startsWith('06001')));

  // Third + fourth: finish, then nothing left to do (no stream opened).
  await loadLodes({ state: 'ca', year: 2022, counties: ['06075', '06001', '06013'], budgetMs: 60_000, source: gzSource(csv), upsert: sink2.upsert, progress, log: () => {} });
  let opened = false;
  const r4 = await loadLodes({
    state: 'ca',
    year: 2022,
    counties: ['06075', '06001', '06013'],
    budgetMs: 60_000,
    source: async () => {
      opened = true;
      return Readable.from([gzipSync(Buffer.from(HEADER + '\n'))]);
    },
    upsert: sink2.upsert,
    progress,
    log: () => {},
  });
  assert.equal(opened, false);
  assert.deepEqual(r4.counties_skipped, ['06075', '06001', '06013']);
  assert.deepEqual(r4.counties_remaining, []);
  assert.equal(r4.rows_upserted, 0);
});

test('loadLodes maxRows truncates, dry run never upserts nor records progress, bad args throw', async () => {
  const csv = buildCsv(['06081'], 10);
  const sink = collector();
  const progress = createMemoryCache();
  const r = await loadLodes({ state: 'ca', year: 2022, counties: ['06081'], maxRows: 3, batchSize: 2, source: gzSource(csv), upsert: sink.upsert, progress, log: () => {} });
  assert.equal(r.truncated_reason, 'max_rows');
  assert.equal(r.rows_upserted, 3);
  assert.deepEqual(r.counties_remaining, ['06081']);

  let upserts = 0;
  const dry = await loadLodes({
    state: 'CA',
    year: 2022,
    counties: ['06081'],
    dryRun: true,
    source: gzSource(csv),
    upsert: async () => {
      upserts++;
    },
    progress,
    log: () => {},
  });
  assert.equal(dry.dry_run, true);
  assert.equal(dry.rows_upserted, 10);
  assert.ok(upserts > 0, 'injected upsert still called so tests can observe the batches');
  assert.equal(await progress.get('iq360_ops_progress', 'lodes:ca:2022'), null);

  await assert.rejects(loadLodes({ state: 'cal', year: 2022, counties: ['06081'], source: gzSource(csv), upsert: sink.upsert }), /two-letter/);
  await assert.rejects(loadLodes({ state: 'ca', year: 1999, counties: ['06081'], source: gzSource(csv), upsert: sink.upsert }), /vintage/);
  await assert.rejects(loadLodes({ state: 'ca', year: 2022, counties: [], source: gzSource(csv), upsert: sink.upsert }), /at least one/);
  await assert.rejects(
    loadLodes({ state: 'ca', year: 2022, counties: ['06081'], source: gzSource('foo,bar\n1,2\n'), upsert: sink.upsert, progress }),
    /w_geocode/,
  );
});
