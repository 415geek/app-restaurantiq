/**
 * Loads the ReportModel the /print pages render.
 *
 * - production: `iqGetReport(id).report_model_json` + `narrative_json` merged
 *   into `model.narrative` (LLM narrative wins over the template fallback).
 * - non-production: `?fixture=<name>` reads qa/fixtures/report_model_<name>.json
 *   so the print route works without a database.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { isLocale, toLocale } from '@/lib/i18n/locale';
import { reportModelSchema, type ReportModel } from '../model/schema';

const FIXTURE_RE = /^[a-z0-9_-]{1,40}$/;

export function fixtureAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function loadFixtureModel(name: string): Promise<ReportModel | null> {
  if (!fixtureAllowed() || !FIXTURE_RE.test(name)) return null;
  const file = path.join(process.cwd(), 'qa', 'fixtures', `report_model_${name}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    return coerceModel(raw, `fixture:${name}`);
  } catch (err) {
    console.warn(`[iq/render/load] fixture ${name} unreadable:`, err instanceof Error ? err.message : err);
    return null;
  }
}

type NarrativeEntry = ReportModel['narrative'][string];

function isNarrativeEntry(v: unknown): v is NarrativeEntry {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.title === 'string' && typeof o.body === 'string';
}

/** Validate with the schema; on drift log the issue and still render the raw document (a paid report must not 404 over a zod mismatch). */
function coerceModel(raw: unknown, label: string): ReportModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = reportModelSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.warn(`[iq/render/load] ${label}: report_model failed schema validation (rendering raw)`, parsed.error.issues.slice(0, 3));
  const m = raw as ReportModel;
  if (!m.meta || !m.input || !m.score || !m.trade_area) return null;
  if (!m.narrative || typeof m.narrative !== 'object') m.narrative = {};
  return m;
}

/**
 * Merge the stored narrative_json into the model. `narrative_json.__lang`
 * (written by generateReport360) records the language the narratives were
 * generated in; it lands on `meta.narrative_language` so the renderer can fall
 * back to the template when the requested report language differs.
 */
export function mergeNarrative(model: ReportModel, narrativeJson: Record<string, unknown> | null | undefined): ReportModel {
  if (!narrativeJson) return model;
  // Accept either { page_1: {...} } or { pages: { page_1: {...} } }.
  const src = (narrativeJson.pages && typeof narrativeJson.pages === 'object' ? narrativeJson.pages : narrativeJson) as Record<string, unknown>;
  const merged: ReportModel['narrative'] = { ...model.narrative };
  for (const [k, v] of Object.entries(src)) {
    if (/^page_\d+$/.test(k) && isNarrativeEntry(v)) {
      merged[k] = { title: v.title, body: v.body, refs: Array.isArray(v.refs) ? v.refs.filter((r): r is string => typeof r === 'string') : [], provider: v.provider, guard: v.guard };
    }
  }
  const stamped = narrativeJson.__lang ?? src.__lang;
  const narrative_language = isLocale(stamped) ? stamped : toLocale(model.meta.language);
  return { ...model, meta: { ...model.meta, narrative_language }, narrative: merged };
}

export interface LoadedPrintModel {
  model: ReportModel;
  paid: boolean;
  fromFixture: boolean;
}

export async function loadPrintModel(opts: { reportId: string; fixture?: string | null }): Promise<LoadedPrintModel | null> {
  if (opts.fixture) {
    const model = await loadFixtureModel(opts.fixture);
    return model ? { model, paid: true, fromFixture: true } : null;
  }
  const report = await iqGetReport(opts.reportId);
  if (!report?.report_model_json) return null;
  const base = coerceModel(report.report_model_json, `report:${opts.reportId}`);
  if (!base) return null;
  return { model: mergeNarrative(base, report.narrative_json), paid: Boolean(report.paid), fromFixture: false };
}
