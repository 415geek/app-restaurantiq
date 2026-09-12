/**
 * D11 · Development pipeline — ONE web search for approved / under-construction
 * projects near the site. Output is a list of RISK HINTS (supply of new
 * residents / retail competition arriving later); it never feeds current
 * demand, which the coverage_note states explicitly for the narrative layer.
 */
import { runWebSearch, queryHash, type WebSearchHit } from './rent-comps';
import type { DataResult, FetchContext } from './types';
import { DATA_SOURCE_NAMES, failed, nowIso } from './types';

export const DEV_PIPELINE_SOURCE_ID = 'D11' as const;
export const DEV_PIPELINE_LICENSE = 'Web search snippets (fair use; links to original planning / news pages)';
export const DEV_PIPELINE_CACHE_TTL_S = 30 * 24 * 3600;
const CACHE_SOURCE = 'iq360_dev_pipeline';
const MAX_PROJECTS = 6;
const RISK_HINT_NOTE = '在建/已批项目仅作供给侧风险提示，不计入当前需求';

export interface DevProject {
  name: string;
  url: string;
  source_title: string;
  expected_delivery: string | null;
  units_or_sqft: string | null;
  snippet: string;
}

export interface DevPipelineData {
  projects: DevProject[];
  query: string;
}

export interface DevPipelineInput {
  city: string;
  state: string;
  address: string;
}

export function buildDevPipelineQuery(input: Pick<DevPipelineInput, 'city' | 'state'>, year: number): string {
  return `${input.city.trim()} ${input.state.trim().toUpperCase()} planning "under construction" OR "approved" mixed-use OR apartments OR development ${year}`;
}

/** "Q3 2026" > bare "2028" > null. Prefers the latest token ≥ the current year (deliveries lie in the future). */
export function extractExpectedDelivery(text: string, currentYear: number): string | null {
  const quarters = [...text.matchAll(/\bQ([1-4])\s*(?:of\s*)?(20\d\d)\b/gi)].map((m) => ({
    year: Number(m[2]),
    label: `Q${m[1]} ${m[2]}`,
  }));
  const future = quarters.filter((q) => q.year >= currentYear).sort((a, b) => b.year - a.year);
  if (future.length) return future[0].label;
  const years = [...text.matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1])).filter((y) => y >= currentYear && y <= currentYear + 10);
  if (years.length) return String(Math.max(...years));
  return null;
}

export function extractUnitsOrSqft(text: string): string | null {
  const units = text.match(/(\d{1,3}(?:,\d{3})*)[-\s]*(?:residential\s+)?(?:units?|apartments|homes|condos?|rooms?)\b/i);
  if (units) return `${units[1]} units`;
  const sqft = text.match(/(\d{1,3}(?:,\d{3})*|\d+(?:\.\d+)?\s*million)\s*(?:SF|sq\.?\s?ft|square feet)\b/i);
  if (sqft) return `${sqft[1].replace(/\s+/g, ' ')} SF`;
  return null;
}

function toProject(hit: WebSearchHit, currentYear: number): DevProject | null {
  if (!/^https?:\/\//i.test(hit.url)) return null;
  const text = `${hit.title} ${hit.snippet}`;
  const name = hit.title.split(/\s[-|–—:]\s|\s\|\s/)[0].trim().slice(0, 120) || hit.url;
  return {
    name,
    url: hit.url,
    source_title: hit.title.slice(0, 200),
    expected_delivery: extractExpectedDelivery(text, currentYear),
    units_or_sqft: extractUnitsOrSqft(text),
    snippet: hit.snippet.slice(0, 300),
  };
}

export async function fetchDevPipeline(input: DevPipelineInput, ctx: FetchContext): Promise<DataResult<DevPipelineData>> {
  const started = Date.now();
  const currentYear = ctx.now().getFullYear();
  const query = buildDevPipelineQuery(input, currentYear);
  const cacheKey = queryHash(query);
  let cache: DataResult<DevPipelineData>['cache'] = 'none';
  let hits: WebSearchHit[] | null = null;
  let costUsd = 0;

  try {
    const cached = await ctx.cache.get<{ hits: WebSearchHit[] }>(CACHE_SOURCE, cacheKey);
    if (cached?.hits) {
      hits = cached.hits;
      cache = 'hit';
    }
  } catch (e) {
    ctx.log('[dev-pipeline] cache read failed', e);
  }

  let provider = 'cache';
  if (!hits) {
    const out = await runWebSearch(query, ctx, { maxResults: 10, costNote: 'D11 dev pipeline' });
    costUsd = out.cost_usd;
    provider = out.provider ?? 'none';
    if (out.error === 'no_key') {
      return failed<DevPipelineData>(DEV_PIPELINE_SOURCE_ID, ctx, {
        source: 'Web search (Tavily / Brave)',
        license: DEV_PIPELINE_LICENSE,
        note: `未获取（无搜索 key）；${RISK_HINT_NOTE}`,
        error: 'no_key',
      });
    }
    if (out.error) {
      return {
        ...failed<DevPipelineData>(DEV_PIPELINE_SOURCE_ID, ctx, {
          source: `Web search (${provider})`,
          license: DEV_PIPELINE_LICENSE,
          note: `搜索失败（${out.error}）；${RISK_HINT_NOTE}`,
          error: out.error,
          cost_usd: costUsd,
        }),
        elapsed_ms: Date.now() - started,
      };
    }
    hits = out.hits;
    cache = 'miss';
    try {
      await ctx.cache.set(CACHE_SOURCE, cacheKey, { hits, provider }, DEV_PIPELINE_CACHE_TTL_S);
    } catch (e) {
      ctx.log('[dev-pipeline] cache write failed', e);
    }
  }

  const projects: DevProject[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const p = toProject(h, currentYear);
    if (!p) continue;
    const key = p.url.toLowerCase().replace(/[#?].*$/, '').replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    projects.push(p);
    if (projects.length >= MAX_PROJECTS) break;
  }

  const withDelivery = projects.filter((p) => p.expected_delivery).length;
  const note =
    projects.length === 0
      ? `检索无结果（${hits.length} 条结果均无 URL 或为空）；${RISK_HINT_NOTE}`
      : `${projects.length} 个项目线索（${withDelivery} 个含交付时间，${projects.filter((p) => p.units_or_sqft).length} 个含规模）· 搜索结果 ${hits.length} 条；${RISK_HINT_NOTE}，交付时间/规模来自摘要正则，需人工核对`;

  return {
    id: DEV_PIPELINE_SOURCE_ID,
    name: DATA_SOURCE_NAMES.D11,
    status: 'ok',
    data: { projects, query },
    source: `Web search (${provider === 'cache' ? '缓存' : provider}) · ${currentYear}`,
    fetched_at: nowIso(ctx),
    license: DEV_PIPELINE_LICENSE,
    cost_usd: costUsd,
    coverage_note: note,
    cache,
    elapsed_ms: Date.now() - started,
  };
}
