/**
 * Audience segments (report page 5) — 评审 Spec P1-i「客群指数异常」.
 *
 * ONE basis for both numbers a segment prints, so a 31% share can never sit
 * next to an index of 20:
 *
 *   share_s = the segment's share of the PRIMARY RING's households
 *             (the four segments partition the ring, so they sum to ~1)
 *   index_s = share_s ÷ (the SAME segment's share of the COUNTY's households) × 100
 *             (100 = exactly the county average; 120 = 20 % over-represented)
 *
 * The county share is built with the identical allocation formula, fed county
 * values instead of ring values — same weights, same normalisation — so the
 * ratio is a like-for-like comparison and never mixes two denominators (the
 * old code divided a ring *level* by a county *level* of a different quantity,
 * which is what produced 「通勤白领 31%，指数 20」).
 *
 * When a county input is missing the index is `null` (「未获取」), never an
 * estimate; `share` is always present because the ring allocation is closed.
 */
import type { ReportModel, Ring } from '../model/schema';

export type SegmentId = ReportModel['audience']['segments'][number]['id'];

/** The denominator both numbers share, printed as the page-6 footnote (trilingual in i18n `p5.indexBasis`). */
export const SEGMENT_BASIS_NOTE_ZH = '占比 = 该客群占主商圈家庭数的比例（四类合计 100%）；指数 = 该占比 ÷ 同一客群在全县的占比 × 100（100 = 与全县持平）';

/** Inputs the allocation needs, for either geography. */
interface AllocationInputs {
  chinese_hh_share: number | null;
  family_share: number | null;
  age_25_44_share: number | null;
  /** Daytime jobs ÷ resident population of the same geography — the commuter weight. */
  jobs_per_pop: number | null;
}

/**
 * The one allocation formula. Relative weights, normalised to shares that sum
 * to 1 — run on the ring for `share` and on the county for the index baseline,
 * so both sides of the ratio are the same quantity.
 */
export function allocateSegments(a: AllocationInputs): Record<SegmentId, number> {
  const cn = a.chinese_hh_share ?? 0;
  const fam = a.family_share ?? 0.3;
  const young = a.age_25_44_share ?? 0.3;
  const weights: Record<SegmentId, number> = {
    chinese_family: cn * fam * 3,
    young_chinese: cn * young * 2,
    commuter_professional: Math.min(0.4, a.jobs_per_pop ?? 0) + 0.05,
    non_chinese_explorer: (1 - cn) * 0.25,
  };
  const sum = (Object.values(weights) as number[]).reduce((s, x) => s + x, 0) || 1;
  return {
    chinese_family: weights.chinese_family / sum,
    commuter_professional: weights.commuter_professional / sum,
    young_chinese: weights.young_chinese / sum,
    non_chinese_explorer: weights.non_chinese_explorer / sum,
  };
}

const BASIS_ZH: Record<SegmentId, string> = {
  chinese_family: '中文家庭 × 有孩家庭（主商圈家庭数占比，指数对标全县同一算法）',
  commuter_professional: '白天岗位 ÷ 常住人口（主商圈家庭数占比，指数对标全县同一算法）',
  young_chinese: '中文家庭 × 25–44 岁（主商圈家庭数占比，指数对标全县同一算法）',
  non_chinese_explorer: '非中文家庭（主商圈家庭数占比，指数对标全县同一算法）',
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function computeAudience(input: {
  primary: Ring;
  walk10: Ring | undefined;
  county: { chinese_hh_share: number | null; median_income: number | null; family_share?: number | null; age_25_44_share?: number | null; jobs_per_pop?: number | null };
  lunch_usd: number | null;
  dinner_usd: number | null;
  /** §4.3 four-daypart capture; drives lunch_dinner_split when present. */
  dayparts?: Array<{ id: string; share: number; monthly_usd: number }>;
}): ReportModel['audience'] {
  const p = input.primary;
  const pop = p.pop ?? 0;
  const jobs = input.walk10?.jobs ?? 0;

  const ringShares = allocateSegments({
    chinese_hh_share: p.chinese_hh_share,
    family_share: p.family_share,
    age_25_44_share: p.age_25_44_share,
    jobs_per_pop: pop > 0 ? jobs / pop : null,
  });
  // The county baseline: same formula, county values. `null` for any input the
  // county row does not carry → that input falls back to the formula's own
  // neutral default, exactly as it does for the ring, so the two stay comparable.
  const countyHasShare = input.county.chinese_hh_share != null;
  const countyShares = allocateSegments({
    chinese_hh_share: input.county.chinese_hh_share,
    family_share: input.county.family_share ?? null,
    age_25_44_share: input.county.age_25_44_share ?? null,
    jobs_per_pop: input.county.jobs_per_pop ?? null,
  });

  const ids: SegmentId[] = ['chinese_family', 'commuter_professional', 'young_chinese', 'non_chinese_explorer'];
  const segments: ReportModel['audience']['segments'] = ids.map((id) => {
    const share = r3(ringShares[id]);
    const base = countyShares[id];
    return {
      id,
      share,
      index: countyHasShare && base > 0 ? Math.round((ringShares[id] / base) * 100) : null,
      basis: BASIS_ZH[id],
    };
  });
  // Rounding drift goes to the largest segment so the four still sum to exactly 1.
  const drift = r3(1 - segments.reduce((s, x) => s + x.share, 0));
  if (drift !== 0) {
    const biggest = segments.reduce((a, b) => (b.share > a.share ? b : a));
    biggest.share = r3(biggest.share + drift);
  }

  const dp = input.dayparts ?? [];
  const lunchDp = dp.find((x) => x.id === 'lunch')?.monthly_usd;
  const dinnerDp = dp.find((x) => x.id === 'dinner')?.monthly_usd;
  const l = lunchDp ?? input.lunch_usd ?? 0;
  const d = dinnerDp ?? input.dinner_usd ?? 0;
  const lunchShare = l + d > 0 ? Math.round((l / (l + d)) * 100) / 100 : 0.3;
  return { segments, lunch_dinner_split: [lunchShare, Math.round((1 - lunchShare) * 100) / 100] };
}
