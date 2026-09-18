/**
 * ConfidenceEngine (研发提示词 Phase 4.4): computed from data-source status,
 * never stated by an LLM.  confidence = Σ w_s × q_s, q ∈ {0, 0.5, 1}.
 */
import { getDefaults } from '../params';
import type { DataResult, DataSourceId, SiteInput } from '../data/types';
import type { ReportModel } from '../model/schema';

export type SourceStatusMap = Partial<Record<DataSourceId, Pick<DataResult<unknown>, 'status' | 'coverage_note'>>>;

function q(s: DataStatusLike | undefined): number {
  if (!s) return 0;
  return s.status === 'ok' ? 1 : s.status === 'partial' ? 0.5 : 0;
}
type DataStatusLike = Pick<DataResult<unknown>, 'status' | 'coverage_note'>;

/**
 * 底层重构 §3.1 / INV-2: the Overture basemap is the PRIMARY source of competitor
 * completeness and Google only supplements it. Scoring the pair with `max` let a
 * report whose basemap had failed still take full marks for competitor data —
 * the report said "餐饮门店底图未获取" on its methods page and scored the
 * component 25% × 1.00 on the same run.
 */
const BASEMAP_WEIGHT = 0.6;
const PLACES_WEIGHT = 0.4;

/**
 * 底层重构 §3.1: what a truncated pool costs.
 *
 * Zeroing the component was disproportionate. In Chinatown, the San Gabriel
 * Valley and Flushing — the markets this product exists for — a search is
 * truncated as a matter of course, so scoring 156 found competitors as
 * zero-quality data meant no address in the core market could ever reach GO.
 *
 * The harm from truncation is "we may have missed some", and that matters most
 * when we found few. So a substantive pool is discounted, and only a thin one
 * that is ALSO unexhausted is treated as unknown: there, the shops we missed
 * could be the ones that decide the answer.
 */
export const TRUNCATION_DISCOUNT = 0.6;
/** Competitors (direct + same category) above which a truncated pool still counts. */
export const TRUNCATION_SUBSTANTIVE_COUNT = 12;

export function computeConfidence(input: {
  sources: SourceStatusMap;
  guard_passed: boolean;
  user: Pick<SiteInput, 'rent_usd' | 'sqft' | 'seats' | 'capex_usd'>;
  /** §3.1: a search was still at the API's per-call cap when it stopped. */
  pool_truncated?: boolean;
  /** Competitors actually found (direct + same category) — a truncated pool of 150 is not a truncated pool of 2. */
  competitor_count?: number;
}): ReportModel['confidence'] {
  const w = getDefaults().confidence_weights;
  const s = input.sources;
  const comp = (status: number, note: string) => ({ quality: status, note });

  const sourceQ = BASEMAP_WEIGHT * q(s.D5) + PLACES_WEIGHT * q(s.D6);
  const substantive = (input.competitor_count ?? 0) >= TRUNCATION_SUBSTANTIVE_COUNT;
  const compQ = !input.guard_passed ? 0 : !input.pool_truncated ? sourceQ : substantive ? sourceQ * TRUNCATION_DISCOUNT : 0;
  const compNote = !input.guard_passed
    ? '竞品守卫未通过'
    : !input.pool_truncated
      ? `D5 ${s.D5?.status ?? '—'} / D6 ${s.D6?.status ?? '—'}`
      : substantive
        ? `竞品检索触及单次返回上限（已找到 ${input.competitor_count} 家，按 ${TRUNCATION_DISCOUNT} 折算）`
        : `竞品检索触及单次返回上限，且已找到的门店过少（${input.competitor_count ?? 0} 家），范围未穷尽`;
  const provided = [input.user.rent_usd, input.user.sqft, input.user.seats].filter((x) => x != null).length;
  const userQ = provided >= 3 ? 1 : provided >= 1 ? 0.5 : 0;

  const components: ReportModel['confidence']['components'] = {
    acs: { weight: w.acs, ...comp(q(s.D2), s.D2?.coverage_note ?? '未获取') },
    competitors: { weight: w.competitors, ...comp(compQ, compNote) },
    traffic_proxy: { weight: w.traffic_proxy, ...comp(q(s.D7), s.D7?.coverage_note ?? '未获取') },
    rent_comps: { weight: w.rent_comps, ...comp(q(s.D8), s.D8?.coverage_note ?? '未获取') },
    daytime_pop: { weight: w.daytime_pop, ...comp(q(s.D3), s.D3?.coverage_note ?? '未获取') },
    transit: { weight: w.transit, ...comp(q(s.D9), s.D9?.coverage_note ?? '未获取') },
    dev_pipeline: { weight: w.dev_pipeline, ...comp(q(s.D11), s.D11?.coverage_note ?? '未获取') },
    user_inputs: { weight: w.user_inputs, ...comp(userQ, `用户提供 ${provided}/3（租金/面积/座位）`) },
  };
  const total = Math.round(Object.values(components).reduce((sum, c) => sum + c.weight * c.quality, 0));
  return { total, level: total >= 80 ? 'high' : total >= 60 ? 'medium' : 'low', components };
}
