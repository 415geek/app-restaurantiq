/**
 * Deterministic fallback narratives (研发提示词 Phase 6 门槛 5: "再失败 → 用模板句替代").
 * Every sentence is built only from report_model numbers and carries [src:path]
 * citations, so it passes NumberGuard by construction. Also defines the 15-page
 * structure (§5.2 + 总结与建议) shared by the LLM narrative generator and the
 * /print renderer.
 *
 * Wording rule: written for a restaurant owner in the report language (en /
 * zh / es) — plain words, concrete numbers, no ring ids / layer codes / field
 * names. The three builders cite the same numbers so a template passes the
 * guard in every language whenever it passes in one.
 */
import { toLocale, type Locale } from '@/lib/i18n/locale';
import { CONCEPT_CATEGORY_LABELS } from '../concept/labels';
import type { ReportModel } from '../model/schema';
import { localizedField, plainEn, plainEs, plainZh } from './plain';

export { hasCjk, localizedField, plainEn, plainEs, plainText, plainZh } from './plain';

export type PageId = `page_${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15}`;

export const PAGES: Array<{ id: PageId; n: number; zh: string; en: string; es: string; fragment: string[] }> = [
  { id: 'page_1', n: 1, zh: '报告概览', en: 'At a Glance', es: 'Resumen rápido', fragment: ['meta', 'input', 'score.total', 'score.verdict', 'confidence.total'] },
  { id: 'page_2', n: 2, zh: '执行摘要', en: 'Executive Summary', es: 'Resumen ejecutivo', fragment: ['score', 'demand', 'finance.breakeven_monthly', 'finance.safety_monthly', 'finance.rent_excluded', 'risks', 'competitors.l1', 'competitors.l2_count', 'trade_area.primary_ring'] },
  { id: 'page_3', n: 3, zh: '商圈地图', en: 'Trade Area Map', es: 'Mapa del área comercial', fragment: ['trade_area.primary_ring', 'trade_area.rings', 'competitors.l1', 'competitors.l2_count', 'competitors.l4', 'access.transit'] },
  { id: 'page_4', n: 4, zh: '商圈需求', en: 'Demand Coverage', es: 'Demanda del área', fragment: ['trade_area', 'demand.cuisine_share'] },
  { id: 'page_5', n: 5, zh: '客群画像', en: 'Audience', es: 'Perfil de clientes', fragment: ['audience', 'trade_area.rings', 'demand.lunch_usd', 'demand.dinner_usd'] },
  { id: 'page_6', n: 6, zh: '竞争格局', en: 'Competitive Landscape', es: 'Panorama competitivo', fragment: ['competitors'] },
  { id: 'page_7', n: 7, zh: '直接竞品对标', en: 'Direct Competitors', es: 'Competidores directos', fragment: ['competitors.l1', 'competitors.benchmark_revenue_band', 'finance.breakeven_monthly', 'finance.rent_excluded', 'competitors.pool_radius_mi', 'competitors.l1_nearest_outside_pool', 'competitors.guard_passed', 'competitors.l1_search_radius_m', 'competitors.l1_layers_tried', 'competitors.brand_anchors'] },
  { id: 'page_8', n: 8, zh: '品类缺口与替代菜系', en: 'Category Gap & Alternatives', es: 'Hueco de categoría y alternativas', fragment: ['competitors.void', 'competitors.density_per_10k_chinese', 'score.alternatives', 'score.user_cuisine_rank'] },
  { id: 'page_9', n: 9, zh: '需求捕获模型', en: 'Demand Capture', es: 'Captura de demanda', fragment: ['demand', 'finance.breakeven_monthly', 'finance.rent_excluded'] },
  { id: 'page_10', n: 10, zh: '财务模型', en: 'Financial Model', es: 'Modelo financiero', fragment: ['finance', 'input.rent_usd', 'input.seats'] },
  { id: 'page_11', n: 11, zh: '菜系匹配评分', en: 'Cuisine Fit Score', es: 'Puntuación de encaje', fragment: ['score.total', 'score.verdict', 'score.dimensions', 'score.conditions'] },
  { id: 'page_12', n: 12, zh: '风险登记', en: 'Risk Register', es: 'Registro de riesgos', fragment: ['risks', 'finance.occupancy_cost_ratio', 'finance.rent_excluded', 'demand.coverage_ratio'] },
  { id: 'page_13', n: 13, zh: '签约核查与 90 天计划', en: 'Pre-lease Checklist & 90-day Plan', es: 'Lista previa al contrato y plan de 90 días', fragment: ['score.conditions', 'finance.inputs_missing', 'input'] },
  { id: 'page_14', n: 14, zh: '方法与数据来源', en: 'Method & Sources', es: 'Método y fuentes', fragment: ['sources', 'meta', 'confidence', 'demand.cuisine_share_method', 'finance.method'] },
  { id: 'page_15', n: 15, zh: '总结与建议', en: 'Summary', es: 'Conclusiones y recomendaciones', fragment: ['score', 'demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'finance.occupancy_cost_ratio', 'finance.rent_excluded', 'finance.max_rent_for_10pct_usd', 'finance.inputs_missing', 'risks', 'input'] },
];

/** Occupancy-cost warning line (rent ÷ revenue) the conditions and summaries quote as "10%". */
export const OCCUPANCY_WARNING_PCT = 10;

/** Page name (kicker) in the report language. */
export function pageName(page: PageId, lang: Locale): string {
  const spec = PAGES.find((p) => p.id === page)!;
  return spec[lang];
}

/** 「未获取」 in each language — the report never shows a blank or a fabricated 0. */
export const NA_LABEL: Record<Locale, string> = { zh: '未获取', en: 'n/a', es: 'n/d' };

const fmtUsdL = (lang: Locale) => (v: number | null | undefined) => (v == null ? NA_LABEL[lang] : `$${Math.round(v).toLocaleString('en-US')}`);
const fmtPctL = (lang: Locale) => (v: number | null | undefined, digits = 0) => (v == null ? NA_LABEL[lang] : `${(v * 100).toFixed(digits)}%`);
const fmtIntL = (lang: Locale) => (v: number | null | undefined) => (v == null ? NA_LABEL[lang] : Math.round(v).toLocaleString('en-US'));

/** Ring id → plain words in the report language, using the ring's own minutes when present. */
export function ringLabel(m: ReportModel, id: string, lang: Locale): string {
  const r = m.trade_area.rings.find((x) => x.id === id);
  const minutes = r?.minutes ?? (id === 'walk10' ? 10 : Number(id.replace(/\D/g, '')) || 10);
  const walk = id === 'walk10';
  if (lang === 'zh') return walk ? `步行 ${minutes} 分钟范围` : `开车 ${minutes} 分钟范围`;
  if (lang === 'es') return walk ? `área a ${minutes} minutos a pie` : `área a ${minutes} minutos en coche`;
  return walk ? `${minutes}-minute walk area` : `${minutes}-minute drive area`;
}

/** Ring id → plain Chinese ("步行 10 分钟范围"), using the ring's own minutes when present. */
export function ringZh(m: ReportModel, id: string): string {
  return ringLabel(m, id, 'zh');
}

export const VERDICT_ZH: Record<ReportModel['score']['verdict'], string> = { GO: '可做', CONDITIONAL_GO: '有条件可做', NO_GO: '不建议' };
export const VERDICT_WORD: Record<Locale, Record<ReportModel['score']['verdict'], string>> = {
  zh: VERDICT_ZH,
  en: { GO: 'GO', CONDITIONAL_GO: 'CONDITIONAL GO', NO_GO: 'NO GO' },
  es: { GO: 'VIABLE', CONDITIONAL_GO: 'VIABLE CON CONDICIONES', NO_GO: 'NO VIABLE' },
};

/** Verdict as a sentence-level word ("viable" / "not recommended"). */
export function verdictWord(v: string, lang: Locale): string {
  return VERDICT_WORD[lang][v as ReportModel['score']['verdict']] ?? v;
}

const SEGMENT_NAME: Record<Locale, Record<string, string>> = {
  zh: { chinese_family: '华人家庭', commuter_professional: '通勤白领', young_chinese: '年轻华人', non_chinese_explorer: '非华裔尝鲜' },
  en: { chinese_family: 'Chinese families', commuter_professional: 'Commuting professionals', young_chinese: 'Young Chinese', non_chinese_explorer: 'Non-Chinese explorers' },
  es: { chinese_family: 'Familias chinas', commuter_professional: 'Profesionales que viajan al trabajo', young_chinese: 'Jóvenes chinos', non_chinese_explorer: 'Exploradores no chinos' },
};

const DIMENSION_NAME: Record<Locale, Record<string, string>> = {
  zh: { demand_coverage: '需求覆盖', audience_fit: '客群匹配', competitive_position: '竞争态势', access_traffic: '可达与流量', financial_viability: '财务可行', occasion_delivery: '场景与外卖' },
  en: { demand_coverage: 'Demand coverage', audience_fit: 'Audience fit', competitive_position: 'Competitive position', access_traffic: 'Access & traffic', financial_viability: 'Financial viability', occasion_delivery: 'Occasion & delivery' },
  es: { demand_coverage: 'Cobertura de demanda', audience_fit: 'Encaje de clientela', competitive_position: 'Posición competitiva', access_traffic: 'Acceso y tráfico', financial_viability: 'Viabilidad financiera', occasion_delivery: 'Ocasión y delivery' },
};

const SENSITIVITY_NAME: Record<Locale, Record<string, string>> = {
  zh: { rent_plus_10: '租金 +10%', rent_per_1000: '月租每 +$1,000', turns_minus_05: '翻台 −0.5', ticket_minus_125: '客单价 −12.5%', delivery_plus_15pt: '外卖占比 +15pt' },
  en: { rent_plus_10: 'Rent +10%', rent_per_1000: 'Each +$1,000 rent', turns_minus_05: 'Turns −0.5', ticket_minus_125: 'Ticket −12.5%', delivery_plus_15pt: 'Delivery +15 pt' },
  es: { rent_plus_10: 'Alquiler +10%', rent_per_1000: 'Cada +$1,000 de renta', turns_minus_05: 'Rotaciones −0.5', ticket_minus_125: 'Ticket −12.5%', delivery_plus_15pt: 'Delivery +15 pt' },
};

/** "(不含租金)" / " (excluding rent)" / " (sin renta)" — appended to every break-even / coverage mention when no rent was provided. */
export const EX_RENT: Record<Locale, string> = { zh: '（不含租金）', en: ' (excluding rent)', es: ' (sin renta)' };

const CUISINE_ES: Record<string, string> = {
  cantonese: 'Cantonesa / asados',
  hk_cafe: 'Cafetería estilo Hong Kong',
  dim_sum: 'Dim sum',
  sichuan: 'Sichuan',
  hunan: 'Hunan',
  northeastern: 'China del noreste',
  shanghai: 'Shanghái / Jiangnan',
  taiwanese: 'Taiwanesa',
  hot_pot: 'Hot pot',
  skewers: 'Brochetas / asado chino',
  noodles: 'Fideos / malatang',
  chinese_fast: 'Comida rápida china / chino-americana',
  boba: 'Boba / postres',
  other_chinese: 'Otra cocina china',
};

/** Segment / dimension / sensitivity / cuisine names in the report language (Spanish has its own table; English uses the engine's label_en). */
export function segmentName(id: string, lang: Locale): string {
  return SEGMENT_NAME[lang][id] ?? SEGMENT_NAME.en[id] ?? id;
}
export function dimensionName(d: { id: string; label_zh: string; label_en: string }, lang: Locale): string {
  return DIMENSION_NAME[lang][d.id] ?? (lang === 'zh' ? d.label_zh : d.label_en);
}
export function sensitivityName(s: { id: string; label_zh: string; label_en: string }, lang: Locale): string {
  return SENSITIVITY_NAME[lang][s.id] ?? (lang === 'zh' ? s.label_zh : s.label_en);
}
type CuisineLike = { cuisine: string } & ({ label_zh: string; label_en: string; label_es?: string } | { cuisine_label_zh: string; cuisine_label_en: string; cuisine_label_es?: string });
/** Taxonomy label in the report language: the model's own `label_es` (§4.1) first, the legacy table for models stored before it, English last. */
export function cuisineName(c: CuisineLike, lang: Locale): string {
  const zh = 'label_zh' in c ? c.label_zh : c.cuisine_label_zh;
  const en = 'label_en' in c ? c.label_en : c.cuisine_label_en;
  if (lang === 'zh') return zh;
  if (lang === 'es') {
    const es = 'label_es' in c ? c.label_es : 'cuisine_label_es' in c ? c.cuisine_label_es : undefined;
    return es || CUISINE_ES[c.cuisine] || en;
  }
  return en;
}

/**
 * Layer words for the narrative (§4.1 step 5): a Chinese concept keeps
 * 同菜系竞品 / 其他中餐; any other concept reads "direct competitors / other
 * <category>" so an egg-tart shop never sees "其他中餐".
 */
export function layerWords(m: Pick<ReportModel, 'input'>, lang: Locale): { chinese: boolean; l1: string; l2: string; all: string; anchors: string } {
  const category = m.input.concept_category ?? 'chinese_regional';
  const chinese = category === 'chinese_regional' || category === 'chinese_format';
  if (chinese) {
    if (lang === 'zh') return { chinese, l1: '同菜系竞品', l2: '其他中餐', all: '中餐', anchors: '华人客流聚集点' };
    if (lang === 'es') return { chinese, l1: 'competidores de la misma cocina', l2: 'otros restaurantes chinos', all: 'restaurantes chinos', anchors: 'anclas de la comunidad china' };
    return { chinese, l1: 'same-cuisine competitors', l2: 'other Chinese restaurants', all: 'Chinese restaurants', anchors: 'Chinese-community anchors' };
  }
  const cat = CONCEPT_CATEGORY_LABELS[category][lang];
  if (lang === 'zh') return { chinese, l1: '同品类直接竞品', l2: '同类目其他业态', all: '同类目门店', anchors: '客流聚集点' };
  if (lang === 'es') return { chinese, l1: 'competidores directos', l2: `otros locales de ${cat.toLowerCase()}`, all: `locales de ${cat.toLowerCase()}`, anchors: 'anclas de tráfico' };
  return { chinese, l1: 'direct competitors', l2: `other ${cat.toLowerCase()} places`, all: `${cat.toLowerCase()} places`, anchors: 'traffic anchors' };
}

/** The report language the model was generated in (defaults to en, never guessed from content). */
export function modelLocale(m: Pick<ReportModel, 'meta'>): Locale {
  return toLocale(m.meta?.language);
}

export function ringIndex(m: ReportModel, id: string): number {
  return m.trade_area.rings.findIndex((r) => r.id === id);
}

type Narrative = { title: string; body: string; refs: string[] };

/**
 * Deterministic narrative for a page in the given language (default: the
 * model's own language). Numbers and citations are identical across languages.
 */
export function templateNarrative(m: ReportModel, page: PageId, lang: Locale = modelLocale(m)): Narrative {
  if (lang === 'en') return templateEn(m, page);
  if (lang === 'es') return templateEs(m, page);
  return templateZh(m, page);
}

/* ------------------------------------------------------------------ */
/* Shared derived facts                                                  */
/* ------------------------------------------------------------------ */
function facts(m: ReportModel) {
  const pr = m.trade_area.primary_ring;
  const pi = ringIndex(m, pr);
  const d10i = ringIndex(m, 'drive10');
  const cb = m.trade_area.county_benchmark.chinese_hh_share;
  const d10 = m.trade_area.rings[d10i];
  const ratio = d10?.chinese_hh_share != null && cb ? (d10.chinese_hh_share / cb).toFixed(1) : null;
  const seg = [...m.audience.segments].sort((a, b) => b.share - a.share)[0];
  const weakest = [...m.score.dimensions].sort((a, b) => a.score - b.score)[0];
  const high = m.risks.filter((r) => r.prob === 'high');
  const top = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const bandIdx = m.competitors.walk10_l1_l2_count === 0 ? 0 : m.competitors.walk10_l1_l2_count <= 3 ? 1 : m.competitors.walk10_l1_l2_count <= 8 ? 2 : m.competitors.walk10_l1_l2_count <= 15 ? 3 : 4;
  const base = m.finance.scenarios.find((x) => x.id === 'base');
  const breaking = m.finance.sensitivity.find((x) => x.breaks_breakeven);
  const degraded = m.sources.filter((s) => s.status !== 'ok').length;
  // No rent provided: every break-even / coverage figure is ex-rent and must say so.
  const rentExcluded = m.finance.rent_excluded === true;
  const maxRent = rentExcluded ? (m.finance.max_rent_for_10pct_usd ?? null) : null;
  return { pr, pi, p: m.trade_area.rings[pi], d10i, d10, ratio, seg, weakest, high, top, bandIdx, base, breaking, degraded, cov: m.demand.coverage_ratio, rentExcluded, maxRent };
}

/* ------------------------------------------------------------------ */
/* 中文                                                                  */
/* ------------------------------------------------------------------ */
function templateZh(m: ReportModel, page: PageId): Narrative {
  const fmtUsd = fmtUsdL('zh');
  const fmtPct = fmtPctL('zh');
  const fmtInt = fmtIntL('zh');
  const f = facts(m);
  const { pr, pi, p, d10i, d10, cov } = f;
  const verdictZh = VERDICT_ZH[m.score.verdict] ?? m.score.verdict;
  const cuisine = m.input.cuisine_label_zh;
  const L = layerWords(m, 'zh');
  const condsZh = m.score.conditions.map((c) => c.text_zh).join('；') || '无';
  const xr = f.rentExcluded ? EX_RENT.zh : '';
  switch (page) {
    case 'page_1':
      return { title: `${cuisine}：${verdictZh}`, body: `综合评分 ${m.score.total} 分 [src:score.total]，数据完整度 ${m.confidence.total} 分 [src:confidence.total]。`, refs: ['score.total', 'confidence.total'] };
    case 'page_2': {
      const title = cov == null ? `${verdictZh}：需求覆盖率未获取` : cov >= 1 ? `预计需求是保本线${xr}的 ${cov.toFixed(2)} 倍，${verdictZh}` : `预计需求只够保本线${xr}的 ${fmtPct(cov)}，${verdictZh}`;
      return {
        title,
        body: `模型预计本店每月能拿到的需求（捕获需求）${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]，保本线（${f.rentExcluded ? '不含租金；' : ''}每月至少要做到的营收）${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]，需求覆盖率${xr} ${fmtPct(cov)} [src:demand.coverage_ratio]。综合评分 ${m.score.total} 分 [src:score.total]；签约前条件：${condsZh}。`,
        refs: ['demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'score.total', 'score.conditions'],
      };
    }
    case 'page_3':
      return {
        title: `主商圈为${ringZh(m, pr)}，覆盖 ${fmtInt(p?.pop)} 位居民`,
        body: `主商圈（客源主要来自的范围）为${ringZh(m, pr)} [src:trade_area.primary_ring]，常住人口 ${fmtInt(p?.pop)} [src:trade_area.rings.${pi}.pop]；${L.l1} ${m.competitors.l1.length} 家 [src:competitors.l1]，${L.l2} ${m.competitors.l2_count} 家 [src:competitors.l2_count]，${L.anchors}（超市、银行、学校等）${m.competitors.l4.length} 处 [src:competitors.l4]。${m.trade_area.isochrone_method === 'radius' ? '可达范围以直线半径近似 [src:trade_area.isochrone_method]。' : ''}`,
        refs: ['trade_area.primary_ring', `trade_area.rings.${pi}.pop`, 'competitors.l1', 'competitors.l2_count', 'competitors.l4'],
      };
    case 'page_4':
      return {
        title: d10 ? `开车 10 分钟内 ${fmtInt(d10.hh)} 户，中文家庭占 ${fmtPct(d10.chinese_hh_share)}${f.ratio ? `，是全县的 ${f.ratio} 倍` : ''}` : '商圈人口数据未获取',
        body: d10 ? `${ringZh(m, 'drive10')}内 ${fmtInt(d10.hh)} 户 [src:trade_area.rings.${d10i}.hh]，家庭收入中位 ${fmtUsd(d10.median_income)} [src:trade_area.rings.${d10i}.median_income]，在家说中文的家庭占 ${fmtPct(d10.chinese_hh_share, 1)} [src:trade_area.rings.${d10i}.chinese_hh_share]，白天上班岗位 ${fmtInt(d10.jobs)} 个 [src:trade_area.rings.${d10i}.jobs]，居民每年外出就餐支出 ${fmtUsd(d10.restaurant_spend_usd)} [src:trade_area.rings.${d10i}.restaurant_spend_usd]。` : '未获取 [src:trade_area.rings]',
        refs: [`trade_area.rings.${d10i}.hh`, `trade_area.rings.${d10i}.median_income`, `trade_area.rings.${d10i}.chinese_hh_share`],
      };
    case 'page_5': {
      const label = segmentName(f.seg.id, 'zh');
      return {
        title: `${label}占 ${fmtPct(f.seg.share)}，午市占比 ${fmtPct(m.audience.lunch_dinner_split[0])}`,
        body: `主要客群是${label}，占 ${fmtPct(f.seg.share)} [src:audience.segments.0.share]；午市 / 晚市 = ${fmtPct(m.audience.lunch_dinner_split[0])} / ${fmtPct(m.audience.lunch_dinner_split[1])} [src:audience.lunch_dinner_split]；午市客源主要靠${ringZh(m, 'walk10')}内的 ${fmtInt(m.trade_area.rings[0]?.jobs)} 个上班岗位 [src:trade_area.rings.0.jobs]。`,
        refs: ['audience.segments', 'audience.lunch_dinner_split', 'trade_area.rings.0.jobs'],
      };
    }
    case 'page_6': {
      const c = m.competitors;
      const bands = [`冷启动区间（周边几乎没有${L.all}）`, '低集聚区间', '集聚红利区间（扎堆带客流）', '偏饱和区间', '饱和区间'];
      const band = bands[f.bandIdx];
      return {
        title: `${L.l1} ${c.l1.length} 家、${L.all}共 ${c.l1.length + c.l2_count} 家，处于${band.split('（')[0]}`,
        body: `${ringZh(m, 'walk10')}内${L.all} ${c.walk10_l1_l2_count} 家 [src:competitors.walk10_l1_l2_count]，集聚分（衡量周边${L.all}多少是否合适）${c.cluster_score} [src:competitors.cluster_score]，处于${band}；${L.l1} Google 平均评分 ${c.avg_rating_l1 ?? '未获取'} [src:competitors.avg_rating_l1]；关店率 ${fmtPct(c.closure_rate)} [src:competitors.closure_rate]。`,
        refs: ['competitors.walk10_l1_l2_count', 'competitors.cluster_score', 'competitors.avg_rating_l1', 'competitors.closure_rate'],
      };
    }
    case 'page_7': {
      const b = m.competitors.benchmark_revenue_band;
      const be = m.finance.breakeven_monthly;
      if (m.competitors.l1.length === 0 && m.competitors.guard_passed) {
        const r = m.competitors.pool_radius_mi ?? 5;
        const near = m.competitors.l1_nearest_outside_pool;
        return {
          title: `${r} 英里内没有${L.chinese ? '同菜系门店' : '同品类直接竞品'}，本址是${cuisine}的空档`,
          body: `周边 ${r} 英里内没有一家${L.chinese ? '同菜系餐厅' : '同品类直接竞品'} [src:competitors.pool_radius_mi]` + (near ? `，最近的一家「${near.name}」在 ${near.distance_mi} 英里外 [src:competitors.l1_nearest_outside_pool.distance_mi]` : '') + `（关键词检索已完成 800 / 1600 米两级 [src:competitors.l1_layers_tried]）。没有同行分客流，也没有同行替你教育市场；保本线${xr} ${fmtUsd(be)} [src:finance.breakeven_monthly]。`,
          refs: ['competitors.pool_radius_mi', 'competitors.l1_nearest_outside_pool', 'competitors.l1_layers_tried', 'finance.breakeven_monthly'],
        };
      }
      const title = b.median != null && be != null ? `同类门店中位月营收 ${fmtUsd(b.median)}，${b.median < be ? '低于' : '高于'}本址保本线${xr}` : '同类门店营收缺历史数据，只能给相对客流等级';
      return {
        title,
        body: `${b.median != null ? `同类门店月营收：低位 ${fmtUsd(b.p25)} / 中位 ${fmtUsd(b.median)} / 高位 ${fmtUsd(b.p75)} [src:competitors.benchmark_revenue_band]` : '同类门店营收区间未获取 [src:competitors.benchmark_revenue_band.method]'}；本址保本线${xr} ${fmtUsd(be)} [src:finance.breakeven_monthly]。`,
        refs: ['competitors.benchmark_revenue_band', 'finance.breakeven_monthly'],
      };
    }
    case 'page_8': {
      const top = f.top;
      return {
        title: top.length ? `本址更适合${top[0].label_zh}（${top[0].total} 分），${cuisine}排第 ${m.score.user_cuisine_rank} 位` : `${cuisine}排第 ${m.score.user_cuisine_rank} 位`,
        body: `${m.competitors.void.is_void ? '该品类为空白 [src:competitors.void.is_void]' : `该品类供给较少，但未满足「品类缺口」的三个条件（华裔人口、门店密度、${L.l2}数量） [src:competitors.void.is_void]`}；更适合的替代菜系前三：${top.map((a) => `${a.label_zh} ${a.total} 分`).join('、')} [src:score.alternatives]；您选的${cuisine}排第 ${m.score.user_cuisine_rank} 位 [src:score.user_cuisine_rank]。`,
        refs: ['competitors.void.is_void', 'score.alternatives', 'score.user_cuisine_rank'],
      };
    }
    case 'page_9':
      return {
        title: cov == null ? '需求测算缺少输入' : `预计每月能拿到 ${fmtUsd(m.demand.captured_monthly_usd)}，是保本线${xr}的 ${fmtPct(cov)}`,
        body: `预计捕获月需求 ${fmtUsd(m.demand.captured_monthly_usd)} [src:demand.captured_monthly_usd]（午市 ${fmtUsd(m.demand.lunch_usd)} [src:demand.lunch_usd]，晚市 ${fmtUsd(m.demand.dinner_usd)} [src:demand.dinner_usd]），每天 ${fmtInt(m.demand.captured_covers_day)} 单 [src:demand.captured_covers_day]；参与分流的竞品 ${m.demand.huff.competitor_set} 家 [src:demand.huff.competitor_set]。`,
        refs: ['demand.captured_monthly_usd', 'demand.lunch_usd', 'demand.dinner_usd', 'demand.captured_covers_day', 'demand.huff.competitor_set'],
      };
    case 'page_10': {
      const s = f.breaking;
      const base = f.base;
      return {
        title: s ? `${s.label_zh}就会跌破保本线${xr}` : `基准情景月营收 ${fmtUsd(base?.monthly_revenue)}，高于保本线${xr}`,
        // No-rent edition: same numbers, the safety-line gloss gives way to the rent statement (the page is full).
        body: f.rentExcluded
          ? `未提供月租 [src:finance.rent_excluded]，保本线${xr} ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]、安全线${xr} ${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]；基准情景 ${base?.seats} 座 × 每天翻台 ${base?.turns_per_day} 次 = 每天 ${base?.dine_in_covers_day} 位堂食客人 [src:finance.scenarios.1]，月营收 ${fmtUsd(base?.monthly_revenue)} [src:finance.scenarios.1.monthly_revenue]。${m.finance.payback_months == null ? (m.input.capex_usd != null ? '租金未提供，回收期不显示 [src:finance.payback_months]。' : '未提供开办投入，回收期不显示 [src:finance.payback_months]。') : `回收期 ${m.finance.payback_months} 个月 [src:finance.payback_months]。`}`
          : `保本线 ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]、安全线（比保本线高出一截，留出缓冲）${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]；基准情景 ${base?.seats} 座 × 每天翻台 ${base?.turns_per_day} 次 = 每天 ${base?.dine_in_covers_day} 位堂食客人 [src:finance.scenarios.1]，月营收 ${fmtUsd(base?.monthly_revenue)} [src:finance.scenarios.1.monthly_revenue]。${m.finance.payback_months == null ? '未提供开办投入（装修与设备），回收期不显示 [src:finance.payback_months]。' : `回收期 ${m.finance.payback_months} 个月 [src:finance.payback_months]。`}`,
        refs: ['finance.breakeven_monthly', 'finance.safety_monthly', 'finance.scenarios.1', 'finance.payback_months'],
      };
    }
    case 'page_11': {
      const weakest = f.weakest;
      return {
        title: `${m.score.total} 分 · ${verdictZh}：${weakest.label_zh}最弱（${weakest.score} 分）`,
        body: m.score.dimensions.map((d, i) => `${d.label_zh} ${d.score} 分 × 权重 ${d.weight}% [src:score.dimensions.${i}]`).join('；') + `。签约前条件：${condsZh} [src:score.conditions]。`,
        refs: ['score.dimensions', 'score.conditions', 'score.total'],
      };
    }
    case 'page_12': {
      const high = f.high;
      return {
        title: high.length ? `${high.length} 项高概率风险：${high.map((r) => plainZh(r.risk_zh).split('，')[0]).slice(0, 2).join('；')}` : `${m.risks.length} 项风险都能靠经营手段对冲`,
        body: m.risks.slice(0, 5).map((r, i) => `${plainZh(r.risk_zh)}（概率${r.prob === 'high' ? '高' : r.prob === 'medium' ? '中' : '低'}） [src:risks.${i}]`).join('；') + '。',
        refs: m.risks.slice(0, 5).map((_, i) => `risks.${i}`),
      };
    }
    case 'page_13': {
      // Counts of conditions / missing inputs are not values in the fragment, so the
      // title names the lists instead of counting them (NumberGuard-safe).
      const parts = [m.score.conditions.length ? '签约条件' : null, m.finance.inputs_missing.length ? '缺失输入' : null].filter((x): x is string => x != null);
      return {
        title: parts.length ? `签约前必须先落实${parts.join('与')}，再谈租约` : '签约前无额外条件与缺失输入',
        body: `条件：${condsZh} [src:score.conditions]；需要补充的输入：${m.finance.inputs_missing.map(plainZh).join('、') || '无'} [src:finance.inputs_missing]。`,
        refs: ['score.conditions', 'finance.inputs_missing'],
      };
    }
    case 'page_14':
      return {
        title: '每个数字都可追溯到公开数据来源',
        body: `本报告共使用 ${m.sources.length} 个数据来源 [src:sources]，数据完整度 ${m.confidence.total} 分 [src:confidence.total]${f.degraded ? `；其中 ${f.degraded} 个来源部分缺失或未获取，已在「数据说明」中逐条写明 [src:sources]` : ''}。所有「未获取」的字段都没有做估计。`,
        refs: ['sources', 'confidence.total'],
      };
    case 'page_15': {
      const top = f.top;
      const title = cov == null ? `${cuisine}：${verdictZh}` : `${cuisine}：${verdictZh}，需求覆盖率${xr} ${fmtPct(cov)}`;
      const occZh = f.rentExcluded
        ? `租金未提供，占用成本比无法计算 [src:finance.occupancy_cost_ratio]${f.maxRent != null ? `，按 ${OCCUPANCY_WARNING_PCT}% 占用成本月租上限 ${fmtUsd(f.maxRent)} [src:finance.max_rent_for_10pct_usd]` : ''}`
        : `占用成本比（租金 ÷ 预计营收）${fmtPct(m.finance.occupancy_cost_ratio)} [src:finance.occupancy_cost_ratio]`;
      return {
        title,
        body:
          `结论：${cuisine}在本址${verdictZh}。三个决定性数字：需求覆盖率${xr} ${fmtPct(cov)} [src:demand.coverage_ratio]，${occZh}，综合评分 ${m.score.total} 分 [src:score.total]。` +
          `签约前必须做的事：${condsZh} [src:score.conditions]。` +
          (top.length ? `更适合的替代菜系：${top.map((a) => `${a.label_zh} ${a.total} 分`).join('、')} [src:score.alternatives]。` : '') +
          (f.rentExcluded
            ? '下一步：先在「补充信息」里填写实际月租并补齐缺失输入，重新生成报告；租金谈判以本报告给出的租金上限为目标；实地踩点午市、晚市与周末客流。'
            : '下一步：先落实签约前条件并补齐缺失输入，重跑报告；租金谈判以本报告给出的租金上限为目标；实地踩点午市、晚市与周末客流。'),
        refs: ['demand.coverage_ratio', 'finance.occupancy_cost_ratio', 'score.total', 'score.conditions', 'score.alternatives'],
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* English                                                               */
/* ------------------------------------------------------------------ */
function templateEn(m: ReportModel, page: PageId): Narrative {
  const fmtUsd = fmtUsdL('en');
  const fmtPct = fmtPctL('en');
  const fmtInt = fmtIntL('en');
  const f = facts(m);
  const { pr, pi, p, d10i, d10, cov } = f;
  const verdict = verdictWord(m.score.verdict, 'en');
  const cuisine = m.input.cuisine_label_en;
  const L = layerWords(m, 'en');
  const conds = m.score.conditions.map((c) => plainEn(c.text_en)).join('; ') || 'none';
  const ringL = (id: string) => ringLabel(m, id, 'en');
  const xr = f.rentExcluded ? EX_RENT.en : '';
  const capEn = f.maxRent != null ? `; at ${OCCUPANCY_WARNING_PCT}% occupancy cost the rent ceiling is ${fmtUsd(f.maxRent)} [src:finance.max_rent_for_10pct_usd]` : '';
  switch (page) {
    case 'page_1':
      return { title: `${cuisine}: ${verdict}`, body: `Overall score ${m.score.total} [src:score.total]; data completeness ${m.confidence.total} [src:confidence.total].`, refs: ['score.total', 'confidence.total'] };
    case 'page_2': {
      // no-rent titles are shorter so the ex-rent label still fits on one line
      const title =
        cov == null
          ? `${verdict}: demand coverage not available`
          : f.rentExcluded
            ? cov >= 1
              ? `Demand is ${cov.toFixed(2)}× break-even${xr}: ${verdict}`
              : `Only ${fmtPct(cov)} of break-even${xr} covered: ${verdict}`
            : cov >= 1
              ? `Captured demand is ${cov.toFixed(2)}× break-even: ${verdict}`
              : `Captured demand covers only ${fmtPct(cov)} of break-even: ${verdict}`;
      return {
        title,
        body: `The model expects this site to capture ${fmtUsd(m.demand.captured_monthly_usd)} of demand a month [src:demand.captured_monthly_usd] against a break-even${xr} (the minimum monthly revenue${f.rentExcluded ? ' before rent' : ''}) of ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly], a demand coverage${xr} of ${fmtPct(cov)} [src:demand.coverage_ratio]. Overall score ${m.score.total} [src:score.total]. Pre-lease conditions: ${conds}.`,
        refs: ['demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'score.total', 'score.conditions'],
      };
    }
    case 'page_3':
      return {
        title: `The primary trade area is the ${ringL(pr)}, home to ${fmtInt(p?.pop)} residents`,
        body: `The primary trade area (where most guests come from) is the ${ringL(pr)} [src:trade_area.primary_ring] with ${fmtInt(p?.pop)} residents [src:trade_area.rings.${pi}.pop]; ${m.competitors.l1.length} ${L.l1} [src:competitors.l1], ${m.competitors.l2_count} ${L.l2} [src:competitors.l2_count] and ${m.competitors.l4.length} ${L.anchors} (grocers, banks, schools) [src:competitors.l4].${m.trade_area.isochrone_method === 'radius' ? ' Reach is approximated with straight-line radii [src:trade_area.isochrone_method].' : ''}`,
        refs: ['trade_area.primary_ring', `trade_area.rings.${pi}.pop`, 'competitors.l1', 'competitors.l2_count', 'competitors.l4'],
      };
    case 'page_4':
      return {
        title: d10 ? `${fmtInt(d10.hh)} households within a 10-minute drive; ${fmtPct(d10.chinese_hh_share)} speak Chinese${f.ratio ? `, ${f.ratio}× the county` : ''}` : 'Trade-area population not available',
        body: d10 ? `The ${ringL('drive10')} holds ${fmtInt(d10.hh)} households [src:trade_area.rings.${d10i}.hh] with a median household income of ${fmtUsd(d10.median_income)} [src:trade_area.rings.${d10i}.median_income]; ${fmtPct(d10.chinese_hh_share, 1)} speak Chinese at home [src:trade_area.rings.${d10i}.chinese_hh_share]; ${fmtInt(d10.jobs)} daytime jobs [src:trade_area.rings.${d10i}.jobs]; residents spend ${fmtUsd(d10.restaurant_spend_usd)} a year eating out [src:trade_area.rings.${d10i}.restaurant_spend_usd].` : 'Not available [src:trade_area.rings]',
        refs: [`trade_area.rings.${d10i}.hh`, `trade_area.rings.${d10i}.median_income`, `trade_area.rings.${d10i}.chinese_hh_share`],
      };
    case 'page_5': {
      const label = segmentName(f.seg.id, 'en');
      return {
        title: `${label} are ${fmtPct(f.seg.share)} of guests; lunch is ${fmtPct(m.audience.lunch_dinner_split[0])}`,
        body: `The largest segment is ${label} at ${fmtPct(f.seg.share)} [src:audience.segments.0.share]; lunch / dinner = ${fmtPct(m.audience.lunch_dinner_split[0])} / ${fmtPct(m.audience.lunch_dinner_split[1])} [src:audience.lunch_dinner_split]; lunch relies on the ${fmtInt(m.trade_area.rings[0]?.jobs)} jobs inside the ${ringL('walk10')} [src:trade_area.rings.0.jobs].`,
        refs: ['audience.segments', 'audience.lunch_dinner_split', 'trade_area.rings.0.jobs'],
      };
    }
    case 'page_6': {
      const c = m.competitors;
      const bands = [`the cold-start band (almost no ${L.all} nearby)`, 'the low-cluster band', 'the cluster-dividend band (a cluster draws traffic)', 'the near-saturated band', 'the saturated band'];
      const band = bands[f.bandIdx];
      return {
        title: `${c.l1.length} ${L.l1}, ${c.l1.length + c.l2_count} ${L.all} in all: ${band.split(' (')[0]}`,
        body: `${c.walk10_l1_l2_count} ${L.all} inside the ${ringL('walk10')} [src:competitors.walk10_l1_l2_count]; cluster score (whether the amount of nearby ${L.all} is healthy) ${c.cluster_score} [src:competitors.cluster_score], in ${band}; ${L.l1} average ${c.avg_rating_l1 ?? 'n/a'} on Google [src:competitors.avg_rating_l1]; closure rate ${fmtPct(c.closure_rate)} [src:competitors.closure_rate].`,
        refs: ['competitors.walk10_l1_l2_count', 'competitors.cluster_score', 'competitors.avg_rating_l1', 'competitors.closure_rate'],
      };
    }
    case 'page_7': {
      const b = m.competitors.benchmark_revenue_band;
      const be = m.finance.breakeven_monthly;
      if (m.competitors.l1.length === 0 && m.competitors.guard_passed) {
        const r = m.competitors.pool_radius_mi ?? 5;
        const near = m.competitors.l1_nearest_outside_pool;
        return {
          title: `No ${L.chinese ? 'same-cuisine restaurant' : 'direct competitor'} within ${r} miles: an opening for ${cuisine}`,
          body: `There is no ${L.chinese ? 'same-cuisine restaurant' : 'direct competitor'} within ${r} miles [src:competitors.pool_radius_mi]` + (near ? `; the nearest, "${near.name}", is ${near.distance_mi} miles away [src:competitors.l1_nearest_outside_pool.distance_mi]` : '') + ` (keyword search completed at both 800 and 1600 m [src:competitors.l1_layers_tried]). Nobody splits the traffic, but nobody has educated the market either; break-even${xr} is ${fmtUsd(be)} [src:finance.breakeven_monthly].`,
          refs: ['competitors.pool_radius_mi', 'competitors.l1_nearest_outside_pool', 'competitors.l1_layers_tried', 'finance.breakeven_monthly'],
        };
      }
      const title = b.median != null && be != null ? `Peer median revenue ${fmtUsd(b.median)} a month, ${b.median < be ? 'below' : 'above'} this site's break-even${xr}` : 'No revenue history for peers: only a relative traffic tier';
      return {
        title,
        body: `${b.median != null ? `Peer monthly revenue: low ${fmtUsd(b.p25)} / median ${fmtUsd(b.median)} / high ${fmtUsd(b.p75)} [src:competitors.benchmark_revenue_band]` : 'Peer revenue band not available [src:competitors.benchmark_revenue_band.method]'}; this site's break-even${xr} is ${fmtUsd(be)} [src:finance.breakeven_monthly].`,
        refs: ['competitors.benchmark_revenue_band', 'finance.breakeven_monthly'],
      };
    }
    case 'page_8': {
      const top = f.top;
      return {
        title: top.length ? `${top[0].label_en} fits this site better (${top[0].total}); ${cuisine} ranks #${m.score.user_cuisine_rank}` : `${cuisine} ranks #${m.score.user_cuisine_rank}`,
        body: `${m.competitors.void.is_void ? 'The category is a true gap [src:competitors.void.is_void]' : `Supply in this category is thin, but the three category-gap tests (Chinese population, store density, ${L.l2}) are not all met [src:competitors.void.is_void]`}; the three best-fit alternatives are ${top.map((a) => `${a.label_en} ${a.total}`).join(', ')} [src:score.alternatives]; your ${cuisine} ranks #${m.score.user_cuisine_rank} [src:score.user_cuisine_rank].`,
        refs: ['competitors.void.is_void', 'score.alternatives', 'score.user_cuisine_rank'],
      };
    }
    case 'page_9':
      return {
        title: cov == null ? 'Demand estimate is missing inputs' : `Expected capture ${fmtUsd(m.demand.captured_monthly_usd)} a month, ${fmtPct(cov)} of break-even${xr}`,
        body: `Expected captured demand ${fmtUsd(m.demand.captured_monthly_usd)} a month [src:demand.captured_monthly_usd] (lunch ${fmtUsd(m.demand.lunch_usd)} [src:demand.lunch_usd], dinner ${fmtUsd(m.demand.dinner_usd)} [src:demand.dinner_usd]), ${fmtInt(m.demand.captured_covers_day)} orders a day [src:demand.captured_covers_day]; ${m.demand.huff.competitor_set} competitors share the pool [src:demand.huff.competitor_set].`,
        refs: ['demand.captured_monthly_usd', 'demand.lunch_usd', 'demand.dinner_usd', 'demand.captured_covers_day', 'demand.huff.competitor_set'],
      };
    case 'page_10': {
      const s = f.breaking;
      const base = f.base;
      return {
        title: s ? `${s.label_en} alone breaks even${xr}` : f.rentExcluded ? `Base case ${fmtUsd(base?.monthly_revenue)} a month, above break-even${xr}` : `Base-case revenue ${fmtUsd(base?.monthly_revenue)} a month, above break-even`,
        body: `Break-even${xr} ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]; safety line${xr} (break-even plus a buffer) ${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]; base case ${base?.seats} seats × ${base?.turns_per_day} turns a day = ${base?.dine_in_covers_day} dine-in guests a day [src:finance.scenarios.1], ${fmtUsd(base?.monthly_revenue)} a month [src:finance.scenarios.1.monthly_revenue]. ${f.rentExcluded ? `No monthly rent was provided: fixed cost and break-even exclude rent [src:finance.rent_excluded]${capEn}. ` : ''}${m.finance.payback_months == null ? (f.rentExcluded && m.input.capex_usd != null ? 'Rent not provided, so no payback period is shown [src:finance.payback_months].' : 'Start-up investment (build-out and equipment) not provided, so no payback period is shown [src:finance.payback_months].') : `Payback ${m.finance.payback_months} months [src:finance.payback_months].`}`,
        refs: ['finance.breakeven_monthly', 'finance.safety_monthly', 'finance.scenarios.1', 'finance.payback_months'],
      };
    }
    case 'page_11': {
      const weakest = f.weakest;
      return {
        title: `${m.score.total} · ${verdict}: ${weakest.label_en} is the weakest (${weakest.score})`,
        body: m.score.dimensions.map((d, i) => `${d.label_en} ${d.score} × weight ${d.weight}% [src:score.dimensions.${i}]`).join('; ') + `. Pre-lease conditions: ${conds} [src:score.conditions].`,
        refs: ['score.dimensions', 'score.conditions', 'score.total'],
      };
    }
    case 'page_12': {
      const high = f.high;
      const prob = (x: string) => (x === 'high' ? 'high' : x === 'medium' ? 'medium' : 'low');
      return {
        title: high.length ? `${high.length} high-probability risks: ${high.map((r) => plainEn(r.risk_en).split(/[,:;]/)[0]).slice(0, 2).join('; ')}` : `All ${m.risks.length} risks can be hedged operationally`,
        body: m.risks.slice(0, 5).map((r, i) => `${plainEn(r.risk_en)} (probability ${prob(r.prob)}) [src:risks.${i}]`).join('; ') + '.',
        refs: m.risks.slice(0, 5).map((_, i) => `risks.${i}`),
      };
    }
    case 'page_13': {
      const parts = [m.score.conditions.length ? 'the pre-lease conditions' : null, m.finance.inputs_missing.length ? 'the missing inputs' : null].filter((x): x is string => x != null);
      return {
        title: parts.length ? `Settle ${parts.join(' and ')} before negotiating the lease` : 'No extra conditions or missing inputs before signing',
        body: `Conditions: ${conds} [src:score.conditions]; inputs still needed: ${m.finance.inputs_missing.map(plainEn).join(', ') || 'none'} [src:finance.inputs_missing].`,
        refs: ['score.conditions', 'finance.inputs_missing'],
      };
    }
    case 'page_14':
      return {
        title: 'Every number traces back to a public data source',
        body: `This report draws on ${m.sources.length} data sources [src:sources] with a data completeness of ${m.confidence.total} [src:confidence.total]${f.degraded ? `; ${f.degraded} of them are partial or unavailable and are listed one by one under "Data notes" [src:sources]` : ''}. No field marked "n/a" has been estimated.`,
        refs: ['sources', 'confidence.total'],
      };
    case 'page_15': {
      const top = f.top;
      const title = cov == null ? `${cuisine}: ${verdict}` : `${cuisine}: ${verdict}, demand coverage${xr} ${fmtPct(cov)}`;
      const occEn = f.rentExcluded
        ? `occupancy cost ratio not computable because no rent was provided [src:finance.occupancy_cost_ratio]${f.maxRent != null ? `, rent ceiling at ${OCCUPANCY_WARNING_PCT}% occupancy cost ${fmtUsd(f.maxRent)} [src:finance.max_rent_for_10pct_usd]` : ''}`
        : `occupancy cost ratio (rent ÷ expected revenue) ${fmtPct(m.finance.occupancy_cost_ratio)} [src:finance.occupancy_cost_ratio]`;
      return {
        title,
        body:
          `Verdict: ${cuisine} at this address is ${verdict}. The three deciding numbers: demand coverage${xr} ${fmtPct(cov)} [src:demand.coverage_ratio], ${occEn}, overall score ${m.score.total} [src:score.total]. ` +
          `Must do before signing: ${conds} [src:score.conditions]. ` +
          (top.length ? `Better-fit alternatives: ${top.map((a) => `${a.label_en} ${a.total}`).join(', ')} [src:score.alternatives]. ` : '') +
          (f.rentExcluded
            ? 'Next steps: add the actual monthly rent under "Add details" and fill the missing inputs, then regenerate the report; negotiate rent toward the ceiling this report gives; walk the site at lunch, dinner and on a weekend.'
            : 'Next steps: settle the pre-lease conditions and fill the missing inputs, then re-run the report; negotiate rent toward the cap this report gives; walk the site at lunch, dinner and on a weekend.'),
        refs: ['demand.coverage_ratio', 'finance.occupancy_cost_ratio', 'score.total', 'score.conditions', 'score.alternatives'],
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Español                                                               */
/* ------------------------------------------------------------------ */
function templateEs(m: ReportModel, page: PageId): Narrative {
  const fmtUsd = fmtUsdL('es');
  const fmtPct = fmtPctL('es');
  const fmtInt = fmtIntL('es');
  const f = facts(m);
  const { pr, pi, p, d10i, d10, cov } = f;
  const verdict = verdictWord(m.score.verdict, 'es');
  const cuisine = cuisineName(m.input, 'es');
  const L = layerWords(m, 'es');
  const conds = m.score.conditions.map((c) => localizedField(c.text_zh, c.text_en, 'es')).join('; ') || 'ninguna';
  const ringL = (id: string) => ringLabel(m, id, 'es');
  const alt = (a: ReportModel['score']['alternatives'][number]) => cuisineName(a, 'es');
  const xr = f.rentExcluded ? EX_RENT.es : '';
  const capEs = f.maxRent != null ? `; con un costo de ocupación del ${OCCUPANCY_WARNING_PCT}%, el tope de alquiler es ${fmtUsd(f.maxRent)} [src:finance.max_rent_for_10pct_usd]` : '';
  switch (page) {
    case 'page_1':
      return { title: `${cuisine}: ${verdict}`, body: `Puntuación global ${m.score.total} [src:score.total]; integridad de datos ${m.confidence.total} [src:confidence.total].`, refs: ['score.total', 'confidence.total'] };
    case 'page_2': {
      // no-rent titles are shorter so the ex-rent label still fits on one line
      const title =
        cov == null
          ? `${verdict}: cobertura de demanda no disponible`
          : f.rentExcluded
            ? cov >= 1
              ? `Demanda ${cov.toFixed(2)}× el equilibrio${xr}: ${verdict}`
              : `Solo el ${fmtPct(cov)} del equilibrio${xr} cubierto: ${verdict}`
            : cov >= 1
              ? `La demanda captada es ${cov.toFixed(2)}× el punto de equilibrio: ${verdict}`
              : `La demanda captada cubre solo el ${fmtPct(cov)} del equilibrio: ${verdict}`;
      return {
        title,
        body: `El modelo prevé que este local capte ${fmtUsd(m.demand.captured_monthly_usd)} de demanda al mes [src:demand.captured_monthly_usd] frente a un punto de equilibrio${xr} (ingreso mensual mínimo${f.rentExcluded ? ' antes del alquiler' : ''}) de ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly], una cobertura de demanda${xr} del ${fmtPct(cov)} [src:demand.coverage_ratio]. Puntuación global ${m.score.total} [src:score.total]. Condiciones previas al contrato: ${conds}.`,
        refs: ['demand.coverage_ratio', 'demand.captured_monthly_usd', 'finance.breakeven_monthly', 'score.total', 'score.conditions'],
      };
    }
    case 'page_3':
      return {
        title: `La zona principal es el ${ringL(pr)}, con ${fmtInt(p?.pop)} residentes`,
        body: `La zona principal (de donde vienen la mayoría de los clientes) es el ${ringL(pr)} [src:trade_area.primary_ring], con ${fmtInt(p?.pop)} residentes [src:trade_area.rings.${pi}.pop]; ${m.competitors.l1.length} ${L.l1} [src:competitors.l1], ${m.competitors.l2_count} ${L.l2} [src:competitors.l2_count] y ${m.competitors.l4.length} ${L.anchors} (supermercados, bancos, escuelas) [src:competitors.l4].${m.trade_area.isochrone_method === 'radius' ? ' El alcance se aproxima con radios en línea recta [src:trade_area.isochrone_method].' : ''}`,
        refs: ['trade_area.primary_ring', `trade_area.rings.${pi}.pop`, 'competitors.l1', 'competitors.l2_count', 'competitors.l4'],
      };
    case 'page_4':
      return {
        title: d10 ? `${fmtInt(d10.hh)} hogares a 10 minutos en coche; el ${fmtPct(d10.chinese_hh_share)} habla chino${f.ratio ? `, ${f.ratio}× el condado` : ''}` : 'Población del área no disponible',
        body: d10 ? `El ${ringL('drive10')} tiene ${fmtInt(d10.hh)} hogares [src:trade_area.rings.${d10i}.hh] con un ingreso mediano de ${fmtUsd(d10.median_income)} [src:trade_area.rings.${d10i}.median_income]; el ${fmtPct(d10.chinese_hh_share, 1)} habla chino en casa [src:trade_area.rings.${d10i}.chinese_hh_share]; ${fmtInt(d10.jobs)} empleos diurnos [src:trade_area.rings.${d10i}.jobs]; los residentes gastan ${fmtUsd(d10.restaurant_spend_usd)} al año en restaurantes [src:trade_area.rings.${d10i}.restaurant_spend_usd].` : 'No disponible [src:trade_area.rings]',
        refs: [`trade_area.rings.${d10i}.hh`, `trade_area.rings.${d10i}.median_income`, `trade_area.rings.${d10i}.chinese_hh_share`],
      };
    case 'page_5': {
      const label = segmentName(f.seg.id, 'es');
      return {
        title: `${label}: ${fmtPct(f.seg.share)} de los clientes; el almuerzo es el ${fmtPct(m.audience.lunch_dinner_split[0])}`,
        body: `El segmento principal es ${label}, con el ${fmtPct(f.seg.share)} [src:audience.segments.0.share]; almuerzo / cena = ${fmtPct(m.audience.lunch_dinner_split[0])} / ${fmtPct(m.audience.lunch_dinner_split[1])} [src:audience.lunch_dinner_split]; el almuerzo depende de los ${fmtInt(m.trade_area.rings[0]?.jobs)} empleos dentro del ${ringL('walk10')} [src:trade_area.rings.0.jobs].`,
        refs: ['audience.segments', 'audience.lunch_dinner_split', 'trade_area.rings.0.jobs'],
      };
    }
    case 'page_6': {
      const c = m.competitors;
      const bands = [`la franja de arranque en frío (casi sin ${L.all} cerca)`, 'la franja de baja aglomeración', 'la franja de dividendo de aglomeración (el grupo atrae tráfico)', 'la franja cercana a la saturación', 'la franja saturada'];
      const band = bands[f.bandIdx];
      return {
        title: `${c.l1.length} ${L.l1}, ${c.l1.length + c.l2_count} ${L.all} en total: ${band.split(' (')[0]}`,
        body: `${c.walk10_l1_l2_count} ${L.all} dentro del ${ringL('walk10')} [src:competitors.walk10_l1_l2_count]; puntuación de aglomeración (si la cantidad de ${L.all} cercanos es adecuada) ${c.cluster_score} [src:competitors.cluster_score], en ${band}; los ${L.l1} promedian ${c.avg_rating_l1 ?? 'n/d'} en Google [src:competitors.avg_rating_l1]; tasa de cierre ${fmtPct(c.closure_rate)} [src:competitors.closure_rate].`,
        refs: ['competitors.walk10_l1_l2_count', 'competitors.cluster_score', 'competitors.avg_rating_l1', 'competitors.closure_rate'],
      };
    }
    case 'page_7': {
      const b = m.competitors.benchmark_revenue_band;
      const be = m.finance.breakeven_monthly;
      if (m.competitors.l1.length === 0 && m.competitors.guard_passed) {
        const r = m.competitors.pool_radius_mi ?? 5;
        const near = m.competitors.l1_nearest_outside_pool;
        return {
          title: `Sin ${L.chinese ? 'restaurantes de la misma cocina' : 'competidores directos'} en ${r} millas: una oportunidad para ${cuisine}`,
          body: `No hay ningún ${L.chinese ? 'restaurante de la misma cocina' : 'competidor directo'} en ${r} millas [src:competitors.pool_radius_mi]` + (near ? `; el más cercano, "${near.name}", está a ${near.distance_mi} millas [src:competitors.l1_nearest_outside_pool.distance_mi]` : '') + ` (búsqueda por palabra clave completada a 800 y 1600 m [src:competitors.l1_layers_tried]). Nadie reparte el tráfico, pero nadie ha educado al mercado; el punto de equilibrio${xr} es ${fmtUsd(be)} [src:finance.breakeven_monthly].`,
          refs: ['competitors.pool_radius_mi', 'competitors.l1_nearest_outside_pool', 'competitors.l1_layers_tried', 'finance.breakeven_monthly'],
        };
      }
      const title = b.median != null && be != null ? `Ingreso mediano de locales similares ${fmtUsd(b.median)} al mes, ${b.median < be ? 'por debajo' : 'por encima'} del equilibrio${xr} de este local` : 'Sin historial de ingresos de locales similares: solo un nivel relativo de tráfico';
      return {
        title,
        body: `${b.median != null ? `Ingreso mensual de locales similares: bajo ${fmtUsd(b.p25)} / mediano ${fmtUsd(b.median)} / alto ${fmtUsd(b.p75)} [src:competitors.benchmark_revenue_band]` : 'Rango de ingresos de locales similares no disponible [src:competitors.benchmark_revenue_band.method]'}; el punto de equilibrio${xr} de este local es ${fmtUsd(be)} [src:finance.breakeven_monthly].`,
        refs: ['competitors.benchmark_revenue_band', 'finance.breakeven_monthly'],
      };
    }
    case 'page_8': {
      const top = f.top;
      return {
        title: top.length ? `${alt(top[0])} encaja mejor en este local (${top[0].total}); ${cuisine} queda en el puesto ${m.score.user_cuisine_rank}` : `${cuisine} queda en el puesto ${m.score.user_cuisine_rank}`,
        body: `${m.competitors.void.is_void ? 'La categoría es un hueco real [src:competitors.void.is_void]' : `La oferta de esta categoría es escasa, pero no se cumplen las tres condiciones de hueco de categoría (población china, densidad de locales, ${L.l2}) [src:competitors.void.is_void]`}; las tres mejores alternativas son ${top.map((a) => `${alt(a)} ${a.total}`).join(', ')} [src:score.alternatives]; su ${cuisine} queda en el puesto ${m.score.user_cuisine_rank} [src:score.user_cuisine_rank].`,
        refs: ['competitors.void.is_void', 'score.alternatives', 'score.user_cuisine_rank'],
      };
    }
    case 'page_9':
      return {
        title: cov == null ? 'A la estimación de demanda le faltan datos' : `Captura prevista ${fmtUsd(m.demand.captured_monthly_usd)} al mes, el ${fmtPct(cov)} del equilibrio${xr}`,
        body: `Demanda captada prevista ${fmtUsd(m.demand.captured_monthly_usd)} al mes [src:demand.captured_monthly_usd] (almuerzo ${fmtUsd(m.demand.lunch_usd)} [src:demand.lunch_usd], cena ${fmtUsd(m.demand.dinner_usd)} [src:demand.dinner_usd]), ${fmtInt(m.demand.captured_covers_day)} pedidos al día [src:demand.captured_covers_day]; ${m.demand.huff.competitor_set} competidores se reparten la demanda [src:demand.huff.competitor_set].`,
        refs: ['demand.captured_monthly_usd', 'demand.lunch_usd', 'demand.dinner_usd', 'demand.captured_covers_day', 'demand.huff.competitor_set'],
      };
    case 'page_10': {
      const s = f.breaking;
      const base = f.base;
      return {
        title: f.rentExcluded
          ? s
            ? `${sensitivityName(s, 'es')}: cae bajo el equilibrio${xr}`
            : `Escenario base ${fmtUsd(base?.monthly_revenue)} al mes, sobre el equilibrio${xr}`
          : s
            ? `${sensitivityName(s, 'es')} basta para caer bajo el equilibrio`
            : `Ingresos del escenario base ${fmtUsd(base?.monthly_revenue)} al mes, por encima del equilibrio`,
        body: `Punto de equilibrio${xr} ${fmtUsd(m.finance.breakeven_monthly)} [src:finance.breakeven_monthly]; línea de seguridad${xr} (equilibrio más un colchón) ${fmtUsd(m.finance.safety_monthly)} [src:finance.safety_monthly]; escenario base ${base?.seats} asientos × ${base?.turns_per_day} rotaciones al día = ${base?.dine_in_covers_day} comensales en sala al día [src:finance.scenarios.1], ${fmtUsd(base?.monthly_revenue)} al mes [src:finance.scenarios.1.monthly_revenue]. ${f.rentExcluded ? `No se indicó el alquiler mensual: el costo fijo y el punto de equilibrio se calculan sin renta [src:finance.rent_excluded]${capEs}. ` : ''}${m.finance.payback_months == null ? (f.rentExcluded && m.input.capex_usd != null ? 'Sin alquiler indicado no se muestra el plazo de recuperación [src:finance.payback_months].' : 'No se indicó la inversión inicial (obra y equipo), así que no se muestra el plazo de recuperación [src:finance.payback_months].') : `Recuperación en ${m.finance.payback_months} meses [src:finance.payback_months].`}`,
        refs: ['finance.breakeven_monthly', 'finance.safety_monthly', 'finance.scenarios.1', 'finance.payback_months'],
      };
    }
    case 'page_11': {
      const weakest = f.weakest;
      return {
        title: `${m.score.total} · ${verdict}: ${dimensionName(weakest, 'es')} es la más débil (${weakest.score})`,
        body: m.score.dimensions.map((d, i) => `${dimensionName(d, 'es')} ${d.score} × peso ${d.weight}% [src:score.dimensions.${i}]`).join('; ') + `. Condiciones previas al contrato: ${conds} [src:score.conditions].`,
        refs: ['score.dimensions', 'score.conditions', 'score.total'],
      };
    }
    case 'page_12': {
      const high = f.high;
      const prob = (x: string) => (x === 'high' ? 'alta' : x === 'medium' ? 'media' : 'baja');
      const risk = (r: ReportModel['risks'][number]) => localizedField(r.risk_zh, r.risk_en, 'es');
      return {
        title: high.length ? `${high.length} riesgos de alta probabilidad: ${high.map((r) => risk(r).split(/[,:;]/)[0]).slice(0, 2).join('; ')}` : `Los ${m.risks.length} riesgos se pueden cubrir con la operación`,
        body: m.risks.slice(0, 5).map((r, i) => `${risk(r)} (probabilidad ${prob(r.prob)}) [src:risks.${i}]`).join('; ') + '.',
        refs: m.risks.slice(0, 5).map((_, i) => `risks.${i}`),
      };
    }
    case 'page_13': {
      const parts = [m.score.conditions.length ? 'las condiciones previas' : null, m.finance.inputs_missing.length ? 'los datos que faltan' : null].filter((x): x is string => x != null);
      return {
        title: parts.length ? `Resuelva ${parts.join(' y ')} antes de negociar el contrato` : 'Sin condiciones adicionales ni datos faltantes antes de firmar',
        body: `Condiciones: ${conds} [src:score.conditions]; datos pendientes: ${m.finance.inputs_missing.map(plainEs).join(', ') || 'ninguno'} [src:finance.inputs_missing].`,
        refs: ['score.conditions', 'finance.inputs_missing'],
      };
    }
    case 'page_14':
      return {
        title: 'Cada cifra se remonta a una fuente de datos pública',
        body: `Este informe usa ${m.sources.length} fuentes de datos [src:sources] con una integridad de datos de ${m.confidence.total} [src:confidence.total]${f.degraded ? `; ${f.degraded} de ellas son parciales o no están disponibles y se detallan una a una en "Notas sobre los datos" [src:sources]` : ''}. Ningún campo marcado "n/d" ha sido estimado.`,
        refs: ['sources', 'confidence.total'],
      };
    case 'page_15': {
      const top = f.top;
      const title = cov == null ? `${cuisine}: ${verdict}` : `${cuisine}: ${verdict}, cobertura de demanda${xr} ${fmtPct(cov)}`;
      const occEs = f.rentExcluded
        ? `ratio de costo de ocupación no calculable porque no se indicó el alquiler [src:finance.occupancy_cost_ratio]${f.maxRent != null ? `, tope de alquiler con un ${OCCUPANCY_WARNING_PCT}% de costo de ocupación ${fmtUsd(f.maxRent)} [src:finance.max_rent_for_10pct_usd]` : ''}`
        : `ratio de costo de ocupación (alquiler ÷ ingresos previstos) ${fmtPct(m.finance.occupancy_cost_ratio)} [src:finance.occupancy_cost_ratio]`;
      return {
        title,
        body:
          `Conclusión: ${cuisine} en esta dirección es ${verdict}. Las tres cifras decisivas: cobertura de demanda${xr} ${fmtPct(cov)} [src:demand.coverage_ratio], ${occEs}, puntuación global ${m.score.total} [src:score.total]. ` +
          `Imprescindible antes de firmar: ${conds} [src:score.conditions]. ` +
          (top.length ? `Alternativas con mejor encaje: ${top.map((a) => `${alt(a)} ${a.total}`).join(', ')} [src:score.alternatives]. ` : '') +
          (f.rentExcluded
            ? 'Próximos pasos: indique el alquiler mensual real en "Añadir datos" y complete los datos que faltan, luego vuelva a generar el informe; negocie el alquiler hacia el tope que da este informe; visite el local al mediodía, por la noche y un fin de semana.'
            : 'Próximos pasos: resuelva las condiciones previas y complete los datos que faltan, luego vuelva a generar el informe; negocie el alquiler hacia el tope que da este informe; visite el local al mediodía, por la noche y un fin de semana.'),
        refs: ['demand.coverage_ratio', 'finance.occupancy_cost_ratio', 'score.total', 'score.conditions', 'score.alternatives'],
      };
    }
  }
}

/** Pick the JSON fragment a page's narrative may cite (dot paths, arrays allowed). */
export function pageFragment(m: ReportModel, page: PageId): Record<string, unknown> {
  const spec = PAGES.find((p) => p.id === page)!;
  const out: Record<string, unknown> = {};
  for (const path of spec.fragment) {
    const parts = path.split('.');
    let cur: unknown = m;
    for (const part of parts) {
      if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
      else {
        cur = undefined;
        break;
      }
    }
    // strip heavy geometry from ring fragments
    if (path === 'trade_area' || path === 'trade_area.rings') {
      const ta = (path === 'trade_area' ? (cur as ReportModel['trade_area']).rings : (cur as ReportModel['trade_area']['rings'])) ?? [];
      const rings = ta.map((r) => ({ ...r, geometry: undefined }));
      out[path] = path === 'trade_area' ? { ...(cur as object), rings } : rings;
    } else out[path] = cur;
  }
  // Derived counts the prose naturally cites (totals, list lengths). NumberGuard only
  // accepts numbers present in the fragment, so expose them explicitly.
  out._derived = {
    l1_count: m.competitors.l1.length,
    l1_l2_total: m.competitors.l1.length + m.competitors.l2_count,
    l4_count: m.competitors.l4.length,
    alternatives_count: m.score.alternatives.length,
    conditions_count: m.score.conditions.length,
    risks_count: m.risks.length,
    sources_total: m.sources.length,
    sources_ok: m.sources.filter((s) => s.status === 'ok').length,
    sources_degraded: m.sources.filter((s) => s.status !== 'ok').length,
    rings_count: m.trade_area.rings.length,
    // "步行 10 分钟范围" / "10-minute walk area" / "área a 15 minutos en coche" name the ring by its minutes on every page
    ring_minutes: Object.fromEntries(m.trade_area.rings.map((r) => [r.id, r.minutes])),
    inputs_missing_count: m.finance.inputs_missing.length,
    // the 10 % occupancy-cost warning line quoted by the rent conditions and the summaries
    occupancy_warning_pct: OCCUPANCY_WARNING_PCT,
    lunch_share_pct: m.demand.lunch_usd != null && m.demand.dinner_usd != null && m.demand.lunch_usd + m.demand.dinner_usd > 0 ? Math.round((m.demand.lunch_usd / (m.demand.lunch_usd + m.demand.dinner_usd)) * 100) : null,
  };
  return out;
}
