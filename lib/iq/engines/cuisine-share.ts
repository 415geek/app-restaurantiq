/**
 * cuisine_share(c) — the share of Chinese-restaurant spend that goes to
 * sub-cuisine c (研发提示词 §2.3). Not hand-picked: derived from the supply mix
 * in the trade area (Overture + Google), weighting each open Chinese POI by its
 * Google review count when known (supply share ≈ demand share, self-calibrating).
 */
import type { MergedPoi } from './competitor';

export interface CuisineShareResult {
  share: number;
  method: string;
  weighted_total: number;
  n_chinese: number;
}

export function computeCuisineShare(merged: MergedPoi[], cuisine: string): CuisineShareResult {
  const chinese = merged.filter((m) => m.is_chinese && m.is_food && !/closed_permanently|CLOSED_PERMANENTLY/i.test(m.operating_status));
  if (chinese.length === 0) return { share: 0.08, method: '无中餐供给样本 → 先验 8%', weighted_total: 0, n_chinese: 0 };
  const hasCounts = chinese.some((m) => (m.rating_count ?? 0) > 0);
  const w = (m: MergedPoi) => (hasCounts ? Math.log(1 + (m.rating_count ?? 0)) + 0.5 : 1);
  const total = chinese.reduce((s, m) => s + w(m), 0);
  const mine = chinese.filter((m) => (m.sub_cuisine ?? 'other_chinese') === cuisine).reduce((s, m) => s + w(m), 0);
  // Laplace smoothing so a cuisine absent from local supply still gets a floor
  // (destination cuisines draw from beyond the trade area); cap so a single
  // dominant cuisine cannot claim the whole pool.
  const raw = (mine + 0.5) / (total + 0.5 * 14);
  const share = Math.max(0.03, Math.min(0.5, raw));
  return {
    share: Math.round(share * 1000) / 1000,
    method: hasCounts ? '供给份额 ≈ 需求份额：按评论数 log 权重（D5+D6），Laplace 平滑，[3%,50%] 截断' : '供给份额 ≈ 需求份额：按门店数（无评论数），Laplace 平滑',
    weighted_total: Math.round(total * 100) / 100,
    n_chinese: chinese.length,
  };
}
