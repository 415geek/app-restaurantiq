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

export function computeConfidence(input: {
  sources: SourceStatusMap;
  guard_passed: boolean;
  user: Pick<SiteInput, 'rent_usd' | 'sqft' | 'seats' | 'capex_usd'>;
}): ReportModel['confidence'] {
  const w = getDefaults().confidence_weights;
  const s = input.sources;
  const comp = (status: number, note: string) => ({ quality: status, note });

  const compQ = input.guard_passed ? Math.max(q(s.D5), q(s.D6)) : 0;
  const provided = [input.user.rent_usd, input.user.sqft, input.user.seats].filter((x) => x != null).length;
  const userQ = provided >= 3 ? 1 : provided >= 1 ? 0.5 : 0;

  const components: ReportModel['confidence']['components'] = {
    acs: { weight: w.acs, ...comp(q(s.D2), s.D2?.coverage_note ?? '未获取') },
    competitors: { weight: w.competitors, ...comp(compQ, input.guard_passed ? `D5 ${s.D5?.status ?? '—'} / D6 ${s.D6?.status ?? '—'}` : '竞品守卫未通过') },
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
