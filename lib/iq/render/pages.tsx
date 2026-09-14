/**
 * The fifteen /print pages (研发提示词 Phase 5.2 + 总结与建议). Every page has
 * the same fixed structure:
 *   <h1 class="action-title">  — judgment title from model.narrative (LLM) or
 *                                templateNarrative() fallback; never invented here
 *   one-line English subtitle
 *   ONE core chart or table
 *   interpretation (narrative body, citations stripped)
 *   source chips
 * Only report_model fields are shown; null → 「未获取」.
 *
 * Wording: the reader is a restaurant owner. Customer-facing text is plain
 * Chinese — no ring ids (walk10), layer codes (L1), field names
 * (coverage_ratio), model names (Huff) or Greek letters. Engine strings that
 * reach the page (drivers, conditions, notes) pass through plainZh().
 */
import type { ComponentType, ReactNode } from 'react';
import {
  Calculator,
  Check,
  ClipboardCheck,
  Database,
  FileText,
  Flag,
  Gauge,
  Layers,
  ListChecks,
  MapPin,
  ShieldAlert,
  Store,
  Target,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { Competitor, ReportModel } from '../model/schema';
import { PAGES, templateNarrative, type PageId } from '../narrative/templates';
import { SourceChips, type SourceKind } from './chips';
import {
  ClusterCurve,
  CoverageGauge,
  DensityBar,
  HBars,
  PriceLadder,
  RiskMatrix,
  ScoreMeter,
  SegmentBars,
  SensitivityWaterfall,
  SplitBar,
  StackedRingBar,
  Timeline,
  TwinBars,
} from './charts';
import {
  BAND_METHOD_ZH,
  CONFIDENCE_COMPONENT_ZH,
  LEVEL_LABEL,
  NA,
  PROB_LABEL,
  RING_LABEL,
  SCENARIO_LABEL,
  SEGMENT_LABEL,
  SOURCE_ZH,
  dataNotesZh,
  fmtDate,
  fmtInt,
  fmtMiles,
  fmtMinutes,
  fmtMulti,
  fmtNum,
  fmtPct,
  fmtUsd,
  nameKey,
  plainZh,
  precheckReasonsZh,
  priceLevelLabel,
  probColor,
  ring,
  scoreColor,
  sourceShortZh,
  stripCitations,
  verdictLabel,
  PALETTE,
} from './format';
import { MapFigure } from './map';
import type { StaticMaps } from './static-map';

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;

/** Props every page receives; `staticMaps` is the optional raster basemap pair resolved server-side (static-map.ts). */
export interface PageProps {
  model: ReportModel;
  staticMaps?: StaticMaps;
}

const PAGE_ICON: Record<PageId, IconType> = {
  page_1: FileText,
  page_2: ClipboardCheck,
  page_3: MapPin,
  page_4: Users,
  page_5: Users,
  page_6: Store,
  page_7: UtensilsCrossed,
  page_8: Layers,
  page_9: Target,
  page_10: Calculator,
  page_11: Gauge,
  page_12: ShieldAlert,
  page_13: ListChecks,
  page_14: Database,
  page_15: Flag,
};

const SUBTITLE_EN: Record<PageId, string> = {
  page_1: '360° site-selection report for a Chinese restaurant concept',
  page_2: 'Executive Summary · verdict, evidence, risks and pre-lease conditions',
  page_3: 'Trade Area Map · reach rings, competitors, anchors and rail access',
  page_4: 'Demand Coverage · four-ring profile against the county benchmark',
  page_5: 'Audience · segment share, index and the lunch / dinner split',
  page_6: 'Competitive Landscape · store counts, price ladder and cluster position',
  page_7: 'Direct Competitors · same-cuisine benchmarks against the break-even line',
  page_8: 'Category Gap & Alternatives · gap test and the cuisine ranking',
  page_9: 'Demand Capture · modelled demand by ring, daypart and coverage',
  page_10: 'Financial Model · cost base, break-even, scenarios and sensitivity',
  page_11: 'Cuisine Fit Score · six weighted dimensions and the verdict',
  page_12: 'Risk Register · probability × impact with triggers and hedges',
  page_13: 'Pre-lease Checklist & 90-day Plan · what to settle before signing',
  page_14: 'Method & Sources · data lineage, formulas, parameters and disclaimer',
  page_15: 'Summary · verdict, the three deciding numbers, must-dos and next steps',
};

/** Narratives stored by earlier engine versions counted sources and quoted the report cost; page 14 is a lineage page now. */
const LEGACY_SOURCES_NARRATIVE = /个数据源中|报告成本|数据源状态：|\bD\d+ (ok|partial|failed)\b/;

export function narrativeFor(model: ReportModel, pageId: PageId) {
  const n = model.narrative?.[pageId];
  if (n && typeof n.title === 'string' && n.title.trim() && typeof n.body === 'string') {
    if (pageId === 'page_14' && LEGACY_SOURCES_NARRATIVE.test(`${n.title} ${n.body}`)) return templateNarrative(model, pageId);
    return n;
  }
  return templateNarrative(model, pageId);
}

function PageShell({ model, pageId, chips, children, tail }: { model: ReportModel; pageId: PageId; chips: ReactNode; children: ReactNode; tail?: ReactNode }) {
  const spec = PAGES.find((p) => p.id === pageId)!;
  const n = narrativeFor(model, pageId);
  const Icon = PAGE_ICON[pageId];
  return (
    <section className={`page page-${spec.n}`} data-page={spec.n} aria-label={`${spec.zh} · ${spec.en}`}>
      <header className="page-head">
        <div className="kicker">
          <Icon size={12} strokeWidth={1.75} aria-hidden />
          <span>
            {spec.zh} · {spec.en}
          </span>
        </div>
        <h1 className="action-title">{plainZh(n.title)}</h1>
        <p className="subtitle-en">{SUBTITLE_EN[pageId]}</p>
      </header>
      <div className="page-body">{children}</div>
      <div className="page-tail">
        {tail}
        <p className="interp">{stripCitations(plainZh(n.body)) || NA}</p>
        {chips}
      </div>
      <footer className="page-foot">
        <span>{model.meta.report_id}</span>
        <span>{model.meta.data_as_of}</span>
        <span className="page-num">
          {spec.n} / {PAGES.length}
        </span>
      </footer>
    </section>
  );
}

const Cell = ({ children, num, className }: { children: ReactNode; num?: boolean; className?: string }) => <td className={[num ? 'num' : '', className ?? ''].join(' ').trim() || undefined}>{children ?? NA}</td>;

function VerdictBadge({ verdict, size = 'lg' }: { verdict: ReportModel['score']['verdict']; size?: 'lg' | 'sm' }) {
  const v = verdictLabel(verdict);
  return (
    <span className={`verdict-badge verdict-${size}`} data-verdict={verdict}>
      <span className="verdict-en">{v.en}</span>
      <span className="verdict-zh">{v.zh}</span>
    </span>
  );
}

function KeyNumber({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="key-number">
      <div className="key-label">{label}</div>
      <div className="key-value">{value}</div>
      {sub ? <div className="key-sub">{sub}</div> : null}
    </div>
  );
}

function XRef({ children }: { children: ReactNode }) {
  return <p className="xref">{children}</p>;
}

/** One line per competitor: Chinese name first, English smaller on the same line. */
function CompetitorName({ c }: { c: Pick<Competitor, 'name' | 'name_zh'> }) {
  const zh = c.name_zh?.trim();
  const en = c.name.trim();
  if (zh && nameKey(zh) !== nameKey(en)) {
    return (
      <span className="comp-name">
        {zh}
        <span className="comp-name-en">{en}</span>
      </span>
    );
  }
  return <span className="comp-name">{zh || en}</span>;
}

/**
 * Presentation-level dedupe: the same business must never get two cards.
 * Rows sharing a name (either language) collapse into the first one, which
 * inherits a Chinese name from the duplicate when it lacks one.
 */
function uniqueCompetitors(list: Competitor[]): Competitor[] {
  const out: Competitor[] = [];
  const index = new Map<string, number>();
  for (const c of list) {
    const keys = [nameKey(c.name), c.name_zh ? nameKey(c.name_zh) : ''].filter(Boolean);
    const hit = keys.map((k) => index.get(k)).find((i) => i != null);
    if (hit != null) {
      if (!out[hit].name_zh && c.name_zh) out[hit] = { ...out[hit], name_zh: c.name_zh };
      for (const k of keys) index.set(k, hit);
      continue;
    }
    for (const k of keys) index.set(k, out.length);
    out.push(c);
  }
  return out;
}

const rangeClassZh = (rc: ReportModel['input']['range_class']) => (rc === 'destination' ? '目的地型（顾客愿意专程开车来）' : rc === 'regular' ? '常规型' : '日常型（就近吃）');

/* ------------------------------------------------------------------ */
/* 0 · Cover page (unnumbered title page before the 15 analysis pages)   */
/* ------------------------------------------------------------------ */
function CoverPage({ model, staticMaps }: PageProps) {
  const m = model;
  const address = m.input.matched_address ?? m.input.address;
  const region = m.geo.county_name ?? null;
  return (
    <section className="page page-cover" data-page="0" aria-label="封面 · Cover">
      <div className="cover-page">
        <div className="cover-page-brand">
          <span className="brand-name">RestaurantIQ</span>
          <span className="brand-sub">餐饮选址智能分析 · Restaurant Site Intelligence</span>
        </div>
        <div className="cover-page-title">
          <div className="cover-page-kicker">{m.meta.tier === 'paid' ? '付费专业版 · Professional Edition' : '预检版 · Precheck Edition'}</div>
          <h2 className="cover-page-h">商圈选址分析报告</h2>
          <p className="cover-page-sub">360° Site Selection Report</p>
        </div>
        <div className="cover-page-site">
          <div className="cover-page-address">{address}</div>
          <div className="cover-page-cuisine">
            拟开业态：{m.input.cuisine_label_zh}（{m.input.cuisine_label_en}）
            {region ? <span className="muted"> · {region}</span> : null}
          </div>
        </div>
        <div className="cover-page-map">
          <MapFigure model={m} staticMap={staticMaps?.thumb ?? null} variant="thumb" />
        </div>
        <div className="cover-page-meta">
          <div>
            <div className="cover-label">报告编号 · Report ID</div>
            <div className="cover-page-meta-v">{m.meta.report_id}</div>
          </div>
          <div>
            <div className="cover-label">生成日期 · Generated</div>
            <div className="cover-page-meta-v">{fmtDate(m.meta.generated_at)}</div>
          </div>
          <div>
            <div className="cover-label">数据截止 · Data as of</div>
            <div className="cover-page-meta-v">{m.meta.data_as_of}</div>
          </div>
          <div>
            <div className="cover-label">编制 · Prepared by</div>
            <div className="cover-page-meta-v">RestaurantIQ 360° 分析引擎</div>
          </div>
        </div>
        <p className="cover-page-foot">本报告基于美国人口普查、公开地图与平台数据及您提供的信息，按统一模型计算；每个数字都可追溯到来源（见第 14 页）。报告仅供选址决策参考，不构成投资、法律或租赁建议。</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · At a glance                                                       */
/* ------------------------------------------------------------------ */
function Page1({ model, staticMaps }: PageProps) {
  const m = model;
  return (
    <PageShell model={m} pageId="page_1" chips={<SourceChips model={m} ids={['D1', 'D12']} model_labels={['综合评分 · Score']} />}>
      <div className="cover">
        <div className="cover-brand">
          <span className="brand-name">RestaurantIQ</span>
          <span className="brand-sub">360° 选址报告 · Site Selection Report</span>
        </div>
        <div className="cover-grid">
          <div className="cover-left">
            <div className="cover-field">
              <div className="cover-label">地址 · Address</div>
              <div className="cover-value">{m.input.matched_address ?? m.input.address}</div>
              {m.input.matched_address && m.input.matched_address !== m.input.address ? <div className="cover-note">您填写的地址：{m.input.address}</div> : null}
            </div>
            <div className="cover-field">
              <div className="cover-label">菜系 · Cuisine</div>
              <div className="cover-value">
                {m.input.cuisine_label_zh} · {m.input.cuisine_label_en}
                <span className="muted"> · {rangeClassZh(m.input.range_class)}</span>
              </div>
            </div>
            <div className="cover-verdict">
              <VerdictBadge verdict={m.score.verdict} />
              <div className="cover-keys">
                <KeyNumber label="综合评分 · Score" value={`${fmtNum(m.score.total, 1)} / 100`} />
                <KeyNumber label="数据完整度 · Data completeness" value={`${fmtInt(m.confidence.total)} / 100`} sub={LEVEL_LABEL[m.confidence.level]} />
              </div>
            </div>
          </div>
          <div className="cover-right">
            <table className="meta-table">
              <tbody>
                <tr>
                  <th>报告编号</th>
                  <Cell>{m.meta.report_id}</Cell>
                </tr>
                <tr>
                  <th>生成日期</th>
                  <Cell>{fmtDate(m.meta.generated_at)}</Cell>
                </tr>
                <tr>
                  <th>数据截止</th>
                  <Cell>{m.meta.data_as_of}</Cell>
                </tr>
                <tr>
                  <th>报告版本</th>
                  <Cell>{m.meta.tier === 'paid' ? '完整版 · Paid' : '预检版 · Precheck'}</Cell>
                </tr>
                <tr>
                  <th>所在地区</th>
                  <Cell>
                    {m.geo.county_name ?? m.geo.county}
                    {m.geo.metro ? ` · ${m.geo.metro}` : ''}
                  </Cell>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="cover-map">
          <MapFigure model={m} staticMap={staticMaps?.thumb ?? null} variant="thumb" />
        </div>
        <div className="cover-map-caption">
          主商圈 {RING_LABEL[m.trade_area.primary_ring].zh} · 图中为步行 10 分钟与开车 5·10·15 分钟可达范围 · 同菜系竞品 {m.competitors.l1.length} 家 · 华人客流聚集点 {m.competitors.l4.length} 处 · 详见第 3 页
        </div>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Executive summary                                                 */
/* ------------------------------------------------------------------ */
function Page2({ model }: PageProps) {
  const m = model;
  const reasons = [...m.score.dimensions].sort((a, b) => b.score - a.score).slice(0, 3);
  const probRank = { high: 0, medium: 1, low: 2 } as const;
  const risks = [...m.risks].sort((a, b) => probRank[a.prob] - probRank[b.prob] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0)).slice(0, 3);
  const conds = m.score.conditions.slice(0, 3);
  return (
    <PageShell model={m} pageId="page_2" chips={<SourceChips model={m} ids={['D2', 'D5', 'D6', 'D12']} model_labels={['需求分流模型', '保本模型']} />}>
      <div className="summary-top">
        <VerdictBadge verdict={m.score.verdict} />
        <div className="summary-keys">
          <KeyNumber label="综合评分" value={`${fmtNum(m.score.total, 1)}`} sub="/ 100 · 六项加权，见第 11 页" />
          <KeyNumber label="需求覆盖率" value={fmtPct(m.demand.coverage_ratio)} sub="预计月需求 ÷ 保本线" />
          <KeyNumber label="数据完整度" value={`${fmtInt(m.confidence.total)}`} sub={`/ 100 · ${LEVEL_LABEL[m.confidence.level]} · 见第 14 页`} />
        </div>
      </div>
      <div className="twin-wrap">
        <h2 className="h2">保本线 vs 预计需求 · Break-even vs Captured Demand</h2>
        <TwinBars breakeven={m.finance.breakeven_monthly} captured={m.demand.captured_monthly_usd} safety={m.finance.safety_monthly} />
      </div>
      <div className="three-col">
        <div className="panel">
          <div className="panel-title">三个支撑 · Evidence</div>
          <ol className="tight-list">
            {reasons.map((d) => (
              <li key={d.id}>
                <span className="li-head">
                  {d.label_zh} {fmtNum(d.score, 0)} 分
                </span>
                <span className="li-body">{plainZh(d.drivers[0]) || NA}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">三个风险 · Risks</div>
          <ol className="tight-list">
            {risks.length === 0 ? <li>{NA}</li> : null}
            {risks.map((r) => (
              <li key={r.id}>
                <span className="dot" style={{ background: probColor(r.prob) }} />
                <span className="li-body">
                  {plainZh(r.risk_zh)}
                  <span className="muted">（概率{PROB_LABEL[r.prob]}）</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">签约前条件 · Conditions</div>
          <ol className="tight-list">
            {conds.length === 0 ? <li>无附加条件</li> : null}
            {conds.map((c, i) => (
              <li key={i}>
                <span className="li-body">{plainZh(c.text_zh)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <XRef>
        主商圈 {RING_LABEL[m.trade_area.primary_ring].zh}（第 3–4 页）· 同菜系竞品 {m.competitors.l1.length} 家、其他中餐 {m.competitors.l2_count} 家（第 6–7 页）· 保本线 {fmtUsd(m.finance.breakeven_monthly)}（第 10 页）· 总结与建议见第 15 页
      </XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Trade-area map                                                    */
/* ------------------------------------------------------------------ */
function Page3({ model, staticMaps }: PageProps) {
  const m = model;
  const p = ring(m, m.trade_area.primary_ring);
  const c = m.competitors;
  return (
    <PageShell model={m} pageId="page_3" chips={<SourceChips model={m} ids={['D4', 'D5', 'D6', 'D9']} />}>
      <div className="map-wrap">
        <MapFigure model={m} staticMap={staticMaps?.hero ?? null} variant="hero" />
      </div>
      <div className="map-facts">
        <KeyNumber label="主商圈（客源主要来自的范围）" value={RING_LABEL[m.trade_area.primary_ring].zh} sub={`面积 ${fmtNum(p?.area_sq_mi, 2)} 平方英里 · 覆盖 ${p?.block_groups ?? 0} 个人口普查小区`} />
        <KeyNumber label="范围怎么算" value={m.trade_area.isochrone_method === 'mapbox' ? '按实际路网' : '按直线半径近似'} sub="步行 10 分钟 · 开车 5 / 10 / 15 分钟" />
        <KeyNumber label="周边餐饮门店" value={fmtInt(c.candidates_total)} sub={`同菜系 ${c.l1.length} · 其他中餐 ${c.l2_count} · 其他亚洲餐 ${c.l3_count} · 华人聚集点 ${c.l4.length}`} />
      </div>
      <XRef>各范围的人口与消费见第 4 页；竞品明细见第 6–7 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Ring table                                                        */
/* ------------------------------------------------------------------ */
function Page4({ model }: PageProps) {
  const m = model;
  const rings = m.trade_area.rings;
  const cb = m.trade_area.county_benchmark;
  const NOT_APPLICABLE = '不适用';
  const rows: Array<{ label: string; en: string; get: (r: ReportModel['trade_area']['rings'][number]) => string; county: string }> = [
    { label: '常住人口', en: 'Population', get: (r) => fmtInt(r.pop), county: NOT_APPLICABLE },
    { label: '户数', en: 'Households', get: (r) => fmtInt(r.hh), county: NOT_APPLICABLE },
    { label: '家庭收入中位', en: 'Median HH income', get: (r) => fmtUsd(r.median_income), county: fmtUsd(cb.median_income) },
    { label: '中文家庭占比', en: 'Chinese-speaking HH', get: (r) => fmtPct(r.chinese_hh_share, 1), county: fmtPct(cb.chinese_hh_share, 1) },
    { label: '华裔人口', en: 'Chinese population', get: (r) => fmtInt(r.chinese_pop), county: NOT_APPLICABLE },
    { label: '白天上班岗位', en: 'Daytime jobs', get: (r) => fmtInt(r.jobs), county: NOT_APPLICABLE },
    { label: '年餐饮支出', en: 'Restaurant spend / yr', get: (r) => fmtUsd(r.restaurant_spend_usd), county: NOT_APPLICABLE },
    { label: '年中餐支出', en: 'Chinese-food spend / yr', get: (r) => fmtUsd(r.chinese_spend_usd), county: NOT_APPLICABLE },
    { label: `${m.input.cuisine_label_zh}年需求`, en: 'Cuisine demand / yr', get: (r) => fmtUsd(r.cuisine_demand_usd), county: NOT_APPLICABLE },
    { label: '25–44 岁占比', en: 'Age 25–44', get: (r) => fmtPct(r.age_25_44_share, 1), county: NOT_APPLICABLE },
    { label: '有孩家庭占比', en: 'Families w/ children', get: (r) => fmtPct(r.family_share, 1), county: NOT_APPLICABLE },
    { label: '面积（平方英里）', en: 'Area (sq mi)', get: (r) => fmtNum(r.area_sq_mi, 2), county: NOT_APPLICABLE },
  ];
  const jobsMethod = rings.find((r) => r.jobs_method !== 'none')?.jobs_method;
  const jobsMethodZh = jobsMethod === 'lodes_wac' ? '人口普查局就业点数据' : jobsMethod === 'acs_b08301_estimate' ? '按通勤人口反推（就业点数据未加载，精度较低）' : NA;
  return (
    <PageShell model={m} pageId="page_4" chips={<SourceChips model={m} ids={['D2', 'D3', 'D10']} model_labels={[`菜系份额 ${fmtPct(m.demand.cuisine_share, 1)}`]} />}>
      <table className="data-table ring-table">
        <thead>
          <tr>
            <th className="row-head">指标 · Metric</th>
            {rings.map((r) => (
              <th key={r.id} className={r.id === m.trade_area.primary_ring ? 'primary' : undefined}>
                {RING_LABEL[r.id].zh}
                <span className="th-en">{RING_LABEL[r.id].en}{r.id === m.trade_area.primary_ring ? ' · 主商圈' : ''}</span>
              </th>
            ))}
            <th className="county">
              全县基准
              <span className="th-en">{m.geo.county_name ?? m.geo.county}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.en}>
              <th className="row-head">
                {row.label}
                <span className="th-en">{row.en}</span>
              </th>
              {rings.map((r) => (
                <Cell key={r.id} num className={r.id === m.trade_area.primary_ring ? 'primary' : undefined}>
                  {row.get(r)}
                </Cell>
              ))}
              <Cell num className="county">
                {row.county}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="table-note">
        计算方式：按每个人口普查小区落在范围内的面积比例加权，数据来自美国人口普查局 2023 年五年调查；白天上班岗位：{jobsMethodZh}；「不适用」= 全县基准只提供收入与中文家庭占比。
      </p>
      <XRef>预计能拿到多少需求见第 9 页；客群画像见第 5 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Audience                                                          */
/* ------------------------------------------------------------------ */
function Page5({ model }: PageProps) {
  const m = model;
  const segs = m.audience.segments.map((s) => ({ ...s, label: SEGMENT_LABEL[s.id]?.zh ?? s.id }));
  const [lunch, dinner] = m.audience.lunch_dinner_split;
  return (
    <PageShell model={m} pageId="page_5" chips={<SourceChips model={m} ids={['D2', 'D3']} model_labels={['客群指数', '午晚市拆分']} />}>
      <h2 className="h2">四类客群 · Segments</h2>
      <SegmentBars rows={segs.map((s) => ({ label: s.label, share: s.share, index: s.index }))} />
      <div className="two-col">
        <div>
          <h2 className="h2">午市 / 晚市 · Daypart</h2>
          <SplitBar a={lunch} b={dinner} labelA="午市" labelB="晚市" valueA="靠上班人群" valueB="靠周边居民" />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>步行 10 分钟范围内岗位</th>
                <Cell num>{fmtInt(ring(m, 'walk10')?.jobs)}</Cell>
              </tr>
              <tr>
                <th>主商圈户均人数</th>
                <Cell num>{fmtNum(ring(m, m.trade_area.primary_ring)?.avg_hh_size, 2)}</Cell>
              </tr>
              <tr>
                <th>主商圈租房家庭占比</th>
                <Cell num>{fmtPct(ring(m, m.trade_area.primary_ring)?.renter_share, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">怎么算的 · Basis</h2>
          <table className="data-table compact">
            <tbody>
              {segs.map((s) => (
                <tr key={s.id}>
                  <th>
                    {s.label}
                    <span className="th-en">{SEGMENT_LABEL[s.id]?.en}</span>
                  </th>
                  <Cell>{plainZh(s.basis)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <XRef>午市 / 晚市各能拿到多少营收见第 9 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Competitive landscape                                             */
/* ------------------------------------------------------------------ */
function Page6({ model }: PageProps) {
  const c = model.competitors;
  return (
    <PageShell model={model} pageId="page_6" chips={<SourceChips model={model} ids={['D5', 'D6', 'D7']} model_labels={['集聚分']} />}>
      <div className="two-col">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>类别 · Group</th>
                <th className="num">数量</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>同菜系竞品</th>
                <Cell num>{fmtInt(c.l1.length)}</Cell>
                <Cell>同样做{model.input.cuisine_label_zh}的店</Cell>
              </tr>
              <tr>
                <th>其他中餐</th>
                <Cell num>{fmtInt(c.l2_count)}</Cell>
                <Cell>其他菜系的中餐店</Cell>
              </tr>
              <tr>
                <th>其他亚洲餐饮</th>
                <Cell num>{fmtInt(c.l3_count)}</Cell>
                <Cell>日 / 韩 / 越 / 泰等</Cell>
              </tr>
              <tr>
                <th>华人客流聚集点</th>
                <Cell num>{fmtInt(c.l4.length)}</Cell>
                <Cell>华人超市 / 银行 / 学校 / 茶饮</Cell>
              </tr>
              <tr>
                <th>步行 10 分钟内的中餐店</th>
                <Cell num>{fmtInt(c.walk10_l1_l2_count)}</Cell>
                <Cell>同菜系 + 其他中餐，用于算集聚分</Cell>
              </tr>
              <tr>
                <th>每万居民的中餐店数</th>
                <Cell num>{fmtNum(c.density_per_10k_residents, 1)}</Cell>
                <Cell>中餐店 ÷ 主商圈人口</Cell>
              </tr>
              <tr>
                <th>每万华裔的中餐店数</th>
                <Cell num>{fmtNum(c.density_per_10k_chinese, 1)}</Cell>
                <Cell>用于品类缺口检验，见第 8 页</Cell>
              </tr>
              <tr>
                <th>集中度</th>
                <Cell num>{fmtNum(c.hhi, 3)}</Cell>
                <Cell>少数几家店占多大份额（按评论数），越接近 1 越集中</Cell>
              </tr>
              <tr>
                <th>同菜系竞品 Google 评分</th>
                <Cell num>
                  {fmtNum(c.avg_rating_l1, 1)} / {fmtNum(c.weighted_rating_l1, 2)}
                </Cell>
                <Cell>平均 / 按评论数加权</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">价位分布 · Price ladder</h2>
          <PriceLadder ladder={c.price_ladder} />
          <div className="key-row">
            <KeyNumber label="关店率 · Closure" value={fmtPct(c.closure_rate, 1)} sub="Google 标记永久关闭 ÷ 去重后门店数" />
            <KeyNumber label="集聚分 · Cluster" value={fmtNum(c.cluster_score, 0)} sub="满分 100：周边中餐店太少或太多都扣分" />
          </div>
        </div>
      </div>
      <h2 className="h2">集聚曲线 · Cluster curve</h2>
      <ClusterCurve walk10Count={c.walk10_l1_l2_count} clusterScore={c.cluster_score} />
      {!c.guard_passed ? <p className="table-note">竞品数据异常：{c.guard_notes.map(plainZh).join('；') || NA}</p> : null}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Competitor cards                                                  */
/* ------------------------------------------------------------------ */
function Page7({ model }: PageProps) {
  const m = model;
  const sorted = [...m.competitors.l1].sort((a, b) => (b.huff_share ?? 0) - (a.huff_share ?? 0) || a.distance_mi - b.distance_mi);
  const cards = uniqueCompetitors(sorted).slice(0, 8);
  const b = m.competitors.benchmark_revenue_band;
  const be = m.finance.breakeven_monthly;
  const bandRows = [
    { label: '低位（较差的店）', value: b.p25 },
    { label: '中位（一般的店）', value: b.median },
    { label: '高位（较好的店）', value: b.p75 },
    { label: '本址保本线', value: be, color: PALETTE.coral },
  ];
  const tierLabel = (t: number | null) => (t == null ? NA : `${t} / 5 级`);
  return (
    <PageShell model={m} pageId="page_7" chips={<SourceChips model={m} ids={['D5', 'D6', 'D7']} model_labels={['分流比例']} />}>
      <div className="cards-grid">
        {cards.length === 0 ? (
          m.competitors.guard_passed ? (
            <div className="panel void-panel">
              <div className="panel-title">同菜系竞品 · Same-cuisine competitors</div>
              <p>
                周边 <strong>{m.competitors.pool_radius_mi ?? 5} 英里</strong>内没有一家{m.input.cuisine_label_zh}餐厅
                {m.competitors.l1_nearest_outside_pool ? (
                  <>
                    ，最近的一家「{m.competitors.l1_nearest_outside_pool.name}」在 <strong>{fmtMiles(m.competitors.l1_nearest_outside_pool.distance_mi)}</strong> 外
                  </>
                ) : null}
                。这是一个空档：没有同行分走客流，但也没有同行替你把这个菜系的市场培育起来，需求要靠自己做。
              </p>
            </div>
          ) : (
            <div className="panel">同菜系竞品：{NA}（竞品数据源未获取）</div>
          )
        ) : null}
        {cards.map((c, i) => (
          <div className="comp-card" key={c.id}>
            <div className="comp-head">
              <span className="comp-rank">{i + 1}</span>
              <CompetitorName c={c} />
              {c.is_chain ? <span className="tag">连锁</span> : null}
            </div>
            <dl className="comp-facts">
              <dt>距离</dt>
              <dd className="num">{fmtMiles(c.distance_mi)}</dd>
              <dt>车程</dt>
              <dd className="num">{fmtMinutes(c.drive_min)}</dd>
              <dt>Google 评分</dt>
              <dd className="num">{fmtNum(c.rating, 1)}</dd>
              <dt>Google 评论数</dt>
              <dd className="num">{fmtInt(c.rating_count)}</dd>
              <dt>价位</dt>
              <dd className="num">{priceLevelLabel(c.price_level)}</dd>
              <dt>客流等级</dt>
              <dd className="num">{tierLabel(c.traffic_tier)}</dd>
              <dt>每周营业时长</dt>
              <dd className="num">{c.hours_per_week == null ? NA : `${fmtInt(c.hours_per_week)} 小时`}</dd>
              <dt>分流比例</dt>
              <dd className="num">{fmtPct(c.huff_share, 1)}</dd>
              <dt>月新增评论</dt>
              <dd className="num">{fmtInt(c.monthly_review_growth)}</dd>
              <dt>外卖</dt>
              <dd>{c.offers_delivery == null ? NA : c.offers_delivery ? '提供' : '不提供'}</dd>
            </dl>
          </div>
        ))}
      </div>
      <h2 className="h2">同类门店月营收区间 vs 本址保本线 · Benchmark band</h2>
      <HBars rows={bandRows} valueLabel={(v) => fmtUsd(v)} labelWidth={110} valueWidth={90} height={16} gap={6} />
      <p className="table-note">
        营收区间怎么来的：{BAND_METHOD_ZH[b.method] ?? plainZh(b.method)}
        {b.median == null ? '；因此这里只有本址保本线，没有同类门店的营收数字' : ''}。分流比例 = 需求分流模型算出的该店在周边中餐消费中占的份额。
      </p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Void analysis + alternatives                                      */
/* ------------------------------------------------------------------ */
function Page8({ model }: PageProps) {
  const m = model;
  const v = m.competitors.void;
  const alts = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const mine = m.score.alternatives.find((a) => a.cuisine === m.input.cuisine);
  const conds = [
    { ok: v.conditions.chinese_pop_ok, label: '华裔人口达到门槛', en: 'Chinese population' },
    { ok: v.conditions.density_ok, label: '每万华裔的中餐店数低于华人聚居区的中位', en: 'Density vs hub median' },
    { ok: v.conditions.l2_ok, label: '其他中餐店数量足够', en: 'Other Chinese supply present' },
  ];
  const rankOf = (cuisine: string) => m.score.alternatives.findIndex((a) => a.cuisine === cuisine) + 1;
  return (
    <PageShell model={m} pageId="page_8" chips={<SourceChips model={m} ids={['D2', 'D5']} model_labels={['品类缺口三条件', '替代菜系评分']} />}>
      <div className="two-col">
        <div>
          <h2 className="h2">门店密度 vs 华人聚居区中位 · Density</h2>
          <DensityBar density={m.competitors.density_per_10k_chinese} ratioVsHub={v.density_vs_hub_median} />
          <p className="table-note">本址每万华裔的中餐店数 ÷ 华人聚居区中位 = {fmtMulti(v.density_vs_hub_median)}；整个都会区同菜系门店 {fmtInt(m.competitors.metro_sub_cuisine_total)} 家。</p>
        </div>
        <div>
          <h2 className="h2">品类缺口三条件 · Gap test</h2>
          <ul className="check-list">
            {conds.map((c) => (
              <li key={c.en} className={c.ok ? 'ok' : 'fail'}>
                {c.ok ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <X size={14} strokeWidth={2.5} aria-hidden />}
                <span>
                  {c.label} <span className="muted">{c.en}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="verdict-line">
            结论：<strong>{v.is_void ? '品类空白（这类店明显不够）' : '供给较少，但算不上空白'}</strong>
            <span className="muted"> · {plainZh(v.reason)}</span>
          </div>
        </div>
      </div>
      <h2 className="h2">更适合的替代菜系前三 · Alternatives</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th className="num">名次</th>
            <th>菜系 · Cuisine</th>
            <th className="num">综合分</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {alts.map((a) => (
            <tr key={a.cuisine}>
              <Cell num>{rankOf(a.cuisine)}</Cell>
              <Cell>
                {a.label_zh} <span className="muted">{a.label_en}</span>
              </Cell>
              <Cell num>{fmtNum(a.total, 1)}</Cell>
              <Cell>{verdictLabel(a.verdict).zh}</Cell>
            </tr>
          ))}
          <tr className="highlight">
            <Cell num>{fmtInt(m.score.user_cuisine_rank)}</Cell>
            <Cell>
              {m.input.cuisine_label_zh} <span className="muted">{m.input.cuisine_label_en} · 您选的菜系</span>
            </Cell>
            <Cell num>{fmtNum(mine?.total ?? m.score.total, 1)}</Cell>
            <Cell>{verdictLabel(mine?.verdict ?? m.score.verdict).zh}</Cell>
          </tr>
        </tbody>
      </table>
      <XRef>共比较了 {m.score.alternatives.length} 个菜系；您选的菜系的六项得分见第 11 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 9 · Demand capture                                                    */
/* ------------------------------------------------------------------ */
function Page9({ model }: PageProps) {
  const d = model.demand;
  const parts = d.by_ring.map((r) => ({ label: RING_LABEL[r.ring].en, value: r.monthly_usd, share: r.share }));
  return (
    <PageShell model={model} pageId="page_9" chips={<SourceChips model={model} ids={['D2', 'D10', 'D5', 'D6']} model_labels={['需求分流模型']} />}>
      <h2 className="h2">各范围能拿到的月需求 · Captured demand by ring</h2>
      {parts.length ? <StackedRingBar parts={parts} total={d.captured_monthly_usd} /> : <p className="table-note">{NA}</p>}
      <div className="two-col">
        <div>
          <h2 className="h2">午市 / 晚市 · Daypart</h2>
          <SplitBar a={d.lunch_usd ?? 0} b={d.dinner_usd ?? 0} labelA="午市" labelB="晚市" valueA={fmtUsd(d.lunch_usd)} valueB={fmtUsd(d.dinner_usd)} />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>预计每月能拿到的需求</th>
                <Cell num>{fmtUsd(d.captured_monthly_usd)}</Cell>
              </tr>
              <tr>
                <th>预计每天单数</th>
                <Cell num>{fmtInt(d.captured_covers_day)}</Cell>
              </tr>
              <tr>
                <th>菜系份额（本菜系占中餐消费的比例）</th>
                <Cell num>{fmtPct(d.cuisine_share, 1)}</Cell>
              </tr>
              <tr>
                <th>分流参数（吸引力 / 距离衰减）</th>
                <Cell num>
                  {fmtNum(d.huff.alpha, 2)} / {fmtNum(d.huff.beta, 2)}
                </Cell>
              </tr>
              <tr>
                <th>本址吸引力</th>
                <Cell num>{fmtNum(d.huff.site_attractiveness, 2)}</Cell>
              </tr>
              <tr>
                <th>参与分流的竞品数</th>
                <Cell num>{fmtInt(d.huff.competitor_set)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">需求覆盖率 · Coverage</h2>
          <CoverageGauge ratio={d.coverage_ratio} />
        </div>
      </div>
      <XRef>需求分流模型 = 把周边居民的中餐消费按各店的吸引力和距离远近分摊。保本线与安全线见第 10 页；菜系份额怎么算见第 14 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · Finance                                                          */
/* ------------------------------------------------------------------ */
function Page10({ model }: PageProps) {
  const f = model.finance;
  const fc = f.fixed_cost;
  const base = f.scenarios.find((s) => s.id === 'base');
  const costRows: Array<[string, number | null]> = [
    ['租金', fc.rent],
    ['人工', fc.labor],
    ['水电', fc.utilities],
    ['保险', fc.insurance],
    ['收银系统 / 软件', fc.pos],
    ['营销', fc.marketing],
    ['其他', fc.misc],
  ];
  return (
    <PageShell model={model} pageId="page_10" chips={<SourceChips model={model} ids={['D12', 'D8']} model_labels={['保本模型', '敏感性']} />}>
      <div className="two-col">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>固定成本 / 月 · Fixed cost</th>
                <th className="num">USD</th>
              </tr>
            </thead>
            <tbody>
              {costRows.map(([label, v]) => (
                <tr key={label}>
                  <th>
                    {label}
                    {label === '租金' ? <span className="muted"> · {f.rent_source === 'user_input' ? '您的输入' : plainZh(f.rent_source)}</span> : null}
                  </th>
                  <Cell num>{fmtUsd(v)}</Cell>
                </tr>
              ))}
              <tr className="total">
                <th>合计</th>
                <Cell num>{fmtUsd(fc.total)}</Cell>
              </tr>
              <tr>
                <th>边际贡献率</th>
                <Cell num>{fmtPct(f.contribution_margin, 1)}</Cell>
              </tr>
              <tr>
                <th>占用成本比（租金 ÷ 预计营收）</th>
                <Cell num>{fmtPct(f.occupancy_cost_ratio, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="key-row">
            <KeyNumber label="保本线 / 月" value={fmtUsd(f.breakeven_monthly)} sub="固定成本 ÷ 边际贡献率（营收扣掉变动成本后剩下的比例）" />
            <KeyNumber label="安全线 / 月" value={fmtUsd(f.safety_monthly)} sub="保本线 × 1.28，留出缓冲" />
          </div>
          {f.payback_months != null ? <KeyNumber label="回收期" value={`${fmtInt(f.payback_months)} 个月`} sub={`开办投入 ${fmtUsd(model.input.capex_usd)}`} /> : null}
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>输入：租金 / 面积 / 座位</th>
                <Cell num>
                  {fmtUsd(model.input.rent_usd)} / {fmtInt(model.input.sqft)} 平方英尺 / {fmtInt(model.input.seats)}
                </Cell>
              </tr>
              <tr>
                <th>客单价 堂食 / 外卖</th>
                <Cell num>
                  {fmtUsd(model.input.ticket_in)} / {fmtUsd(model.input.ticket_delivery)}
                </Cell>
              </tr>
              <tr>
                <th>外卖占比（输入）</th>
                <Cell num>{fmtPct(model.input.delivery_ratio)}</Cell>
              </tr>
              <tr>
                <th>变动成本率</th>
                <Cell num>{fmtPct(f.variable_rate, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <table className="data-table scenarios">
        <thead>
          <tr>
            <th>情景 · Scenario</th>
            <th className="num">座位</th>
            <th className="num">翻台 / 天</th>
            <th className="num">堂食 / 天</th>
            <th className="num">外卖单 / 天</th>
            <th className="num">总单 / 天</th>
            <th className="num">客单 堂食 / 外卖</th>
            <th className="num">月营收</th>
            <th className="num">vs 保本</th>
          </tr>
        </thead>
        <tbody>
          {f.scenarios.map((s) => (
            <tr key={s.id} className={s.id === 'base' ? 'highlight' : undefined}>
              <th>
                {SCENARIO_LABEL[s.id].zh} <span className="muted">{SCENARIO_LABEL[s.id].en}</span>
              </th>
              <Cell num>{fmtInt(s.seats)}</Cell>
              <Cell num>{fmtNum(s.turns_per_day, 1)}</Cell>
              <Cell num>{fmtInt(s.dine_in_covers_day)}</Cell>
              <Cell num>{fmtNum(s.delivery_orders_day, 1)}</Cell>
              <Cell num>{fmtNum(s.orders_day, 1)}</Cell>
              <Cell num>
                ${fmtNum(s.ticket_in, 1)} / ${fmtNum(s.ticket_delivery, 1)}
              </Cell>
              <Cell num>{fmtUsd(s.monthly_revenue)}</Cell>
              <Cell num className={s.vs_breakeven == null ? undefined : s.vs_breakeven >= 1 ? 'ink-green' : 'ink-red'}>
                {fmtMulti(s.vs_breakeven)}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="h2">哪一项变动最要命 · Sensitivity</h2>
      <div className="waterfall-wrap">
        <SensitivityWaterfall base={base?.monthly_revenue ?? null} breakeven={f.breakeven_monthly} items={f.sensitivity.map((s) => ({ label: s.label_zh, delta: s.monthly_revenue_delta, breaks: s.breaks_breakeven }))} />
      </div>
      <p className="table-note">
        计算口径：{plainZh(f.method)}。{f.payback_months == null ? '未提供开办投入（装修与设备），回收期不显示。' : ''}
      </p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 11 · Six-dimension score                                              */
/* ------------------------------------------------------------------ */
function Page11({ model }: PageProps) {
  const s = model.score;
  const weightSum = s.dimensions.reduce((a, d) => a + d.weight, 0);
  return (
    <PageShell model={model} pageId="page_11" chips={<SourceChips model={model} ids={[]} model_labels={['六项加权评分', '判定门槛']} />}>
      <table className="data-table score-table">
        <thead>
          <tr>
            <th>维度 · Dimension</th>
            <th className="num">得分</th>
            <th>量表</th>
            <th className="num">权重</th>
            <th className="num">加权分</th>
            <th>依据 · Drivers</th>
          </tr>
        </thead>
        <tbody>
          {s.dimensions.map((d) => (
            <tr key={d.id}>
              <th>
                {d.label_zh}
                <span className="th-en">{d.label_en}</span>
              </th>
              <Cell num>{fmtNum(d.score, 1)}</Cell>
              <td>
                <ScoreMeter score={d.score} />
              </td>
              <Cell num>{fmtInt(d.weight)}%</Cell>
              <Cell num>{fmtNum(d.weighted, 2)}</Cell>
              <Cell>{d.drivers.length ? d.drivers.map(plainZh).join('；') : NA}</Cell>
            </tr>
          ))}
          <tr className="total">
            <th>合计 · Total</th>
            <Cell num>—</Cell>
            <td>
              <ScoreMeter score={s.total} />
            </td>
            <Cell num>{fmtInt(weightSum)}%</Cell>
            <Cell num className="key-inline">
              {fmtNum(s.total, 1)}
            </Cell>
            <Cell>
              <VerdictBadge verdict={s.verdict} size="sm" />
            </Cell>
          </tr>
        </tbody>
      </table>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">签约前条件 · Conditions</div>
          <ol className="tight-list">
            {s.conditions.length === 0 ? <li>无附加条件</li> : null}
            {s.conditions.map((c, i) => (
              <li key={i}>
                <span className="li-head">{s.dimensions.find((d) => d.id === c.dimension)?.label_zh ?? plainZh(c.dimension)}</span>
                <span className="li-body">{plainZh(c.text_zh)}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">判定规则 · Verdict rule</div>
          <ul className="tight-list">
            <li>
              <span className="dot" style={{ background: scoreColor(80) }} />
              <span className="li-body">GO 可做：综合 ≥ 70 分，且没有一票否决项</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(55) }} />
              <span className="li-body">CONDITIONAL GO 有条件可做：55–69 分，或签约前条件能落实</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(20) }} />
              <span className="li-body">NO GO 不建议：{'< 55'} 分，或财务 / 需求这两项触发否决</span>
            </li>
          </ul>
          {s.cannibalization.length ? (
            <p className="table-note">
              自家分流（已有门店被分走的客流）：{s.cannibalization.map((c) => `${c.store} ${fmtPct(c.diverted_share, 1)}`).join('；')}
            </p>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 12 · Risk register                                                    */
/* ------------------------------------------------------------------ */
function Page12({ model }: PageProps) {
  const risks = model.risks;
  return (
    <PageShell model={model} pageId="page_12" chips={<SourceChips model={model} ids={['D11', 'D12']} model_labels={['风险评估']} />}>
      <h2 className="h2">概率 × 影响 · Matrix</h2>
      <div className="risk-matrix-wrap">
        <RiskMatrix risks={risks} />
      </div>
      <div className="key-row three">
        <KeyNumber label="高概率风险" value={`${fmtInt(risks.filter((r) => r.prob === 'high').length)} 项`} sub={`共 ${risks.length} 项`} />
        <KeyNumber label="已算出的影响合计 / 月" value={fmtUsd(risks.reduce((a, r) => a + (r.impact_usd ?? 0), 0))} sub={`${risks.filter((r) => r.impact_usd != null).length} 项已算出金额`} />
        <KeyNumber label="未算出金额的风险" value={`${fmtInt(risks.filter((r) => r.impact_usd == null).length)} 项`} sub="表中显示为「未获取」" />
      </div>
      <table className="data-table risk-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>风险 · Risk</th>
            <th>概率</th>
            <th className="num">影响 / 月</th>
            <th>什么时候会发生 · Trigger</th>
            <th>怎么应对 · Hedge</th>
          </tr>
        </thead>
        <tbody>
          {risks.length === 0 ? (
            <tr>
              <Cell num>—</Cell>
              <Cell>{NA}</Cell>
              <Cell>{NA}</Cell>
              <Cell num>{NA}</Cell>
              <Cell>{NA}</Cell>
              <Cell>{NA}</Cell>
            </tr>
          ) : null}
          {risks.map((r) => (
            <tr key={r.id}>
              <Cell num>{r.id}</Cell>
              <Cell>{plainZh(r.risk_zh)}</Cell>
              <td>
                <span className="dot" style={{ background: probColor(r.prob) }} /> {PROB_LABEL[r.prob]}
              </td>
              <Cell num>{fmtUsd(r.impact_usd)}</Cell>
              <Cell>{r.trigger && r.trigger !== '—' ? plainZh(r.trigger) : NA}</Cell>
              <Cell>{plainZh(r.hedge) || NA}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <XRef>占用成本比与保本线见第 10 页；需求覆盖率见第 9 页；对应的签约条件见第 13 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 13 · Pre-lease checklist + 90-day plan                                */
/* ------------------------------------------------------------------ */
const GENERIC_LEASE_DOCS = [
  '租约草案：租期、免租期、阶梯租金、百分比租金',
  '公共区域费（CAM）与三净费用（NNN）上限',
  '装修条款：业主装修补贴（TI）、施工许可责任',
  '排烟 / 燃气 / 油脂分离器现状与改造责任',
  '用途限制与排他条款（同菜系竞品）',
  '转租 / 退出条款与个人担保范围',
  '停车与装卸位分配（含外卖取餐）',
  '施工期租金减免条款（周边在建项目）',
];

const NINETY_DAY_STEPS: Array<{ day: string; label: string }> = [
  { day: 'D0–7', label: '落实签约前条件、补齐缺失输入，重跑报告' },
  { day: 'D8–14', label: '租金谈判：以占用成本比 ≤ 10% 为目标' },
  { day: 'D15–21', label: '实地踩点 3 次：午市 / 晚市 / 周末客流' },
  { day: 'D22–30', label: '菜单与客单价定稿（用套餐锚定）' },
  { day: 'D31–45', label: '签约 · 报建 · 排烟与燃气改造' },
  { day: 'D46–60', label: '外卖平台上线，先验证需求' },
  { day: 'D61–75', label: '招聘与培训；试营业' },
  { day: 'D76–90', label: '复盘：实际营收 vs 保本线，启动风险应对' },
];

function Page13({ model }: PageProps) {
  const m = model;
  const missing = m.finance.inputs_missing;
  return (
    <PageShell model={m} pageId="page_13" chips={<SourceChips model={m} ids={['D12']} model_labels={['条件生成']} extra={[{ kind: 'model' as SourceKind, label: '通用签约清单' }]} />}>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">签约前核查 · Pre-lease checklist</div>
          <ul className="check-list boxes">
            {m.score.conditions.map((c, i) => (
              <li key={`c${i}`}>
                <span className="box" />
                <span>
                  <strong>条件</strong> {plainZh(c.text_zh)}
                </span>
              </li>
            ))}
            {missing.map((s, i) => (
              <li key={`m${i}`}>
                <span className="box" />
                <span>
                  <strong>补充输入</strong> {plainZh(s)}
                </span>
              </li>
            ))}
            {m.score.conditions.length === 0 && missing.length === 0 ? (
              <li>
                <span className="box" />
                <span>无附加条件与缺失输入</span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">租约文件 · Lease documents</div>
          <ul className="check-list boxes">
            {GENERIC_LEASE_DOCS.map((d) => (
              <li key={d}>
                <span className="box" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <h2 className="h2">90 天计划 · 90-day timeline</h2>
      <Timeline steps={NINETY_DAY_STEPS} />
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 14 · Sources & method (data lineage)                                  */
/* ------------------------------------------------------------------ */
function Page14({ model }: PageProps) {
  const m = model;
  const notes = dataNotesZh(m);
  const precheck = precheckReasonsZh(m);
  const comps = Object.entries(m.confidence.components);
  const rings = m.trade_area.rings;
  return (
    <PageShell model={m} pageId="page_14" chips={<SourceChips model={m} ids={m.sources.map((s) => s.id)} />}>
      <table className="data-table sources-table lineage-table">
        <thead>
          <tr>
            <th>数据源 · Source</th>
            <th>内容 · What it provides</th>
            <th>更新日期 · Updated</th>
            <th>来源机构 · Provider</th>
            <th>许可 · License</th>
          </tr>
        </thead>
        <tbody>
          {m.sources.map((s) => {
            const g = SOURCE_ZH[s.id];
            return (
              <tr key={s.id}>
                <Cell>
                  <span className="clamp2">{sourceShortZh(s)}</span>
                </Cell>
                <Cell className="wrap">
                  <span className="clamp2">{g?.content ?? (plainZh(s.coverage_note) || NA)}</span>
                </Cell>
                <Cell>{fmtDate(s.fetched_at)}</Cell>
                <Cell className="wrap">
                  <span className="clamp2">{g?.org ?? s.source}</span>
                </Cell>
                <Cell className="wrap">
                  <span className="clamp2">{g?.license ?? s.license ?? NA}</span>
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notes.length ? (
        <p className="data-notes">
          <span className="data-notes-title">数据说明</span>
          {notes.map((n, i) => `${i + 1}. ${n}`).join('　')}
        </p>
      ) : null}
      <div className="two-col sources-panels">
        <div className="panel">
          <div className="panel-title">怎么算的 · Method</div>
          <ul className="tight-list small">
            <li>
              <span className="li-head">财务</span>
              <span className="li-body">{plainZh(m.finance.method)}</span>
            </li>
            <li>
              <span className="li-head">菜系份额</span>
              <span className="li-body">{plainZh(m.demand.cuisine_share_method)}</span>
            </li>
            <li>
              <span className="li-head">需求分流</span>
              <span className="li-body">把周边居民的中餐消费按各店的吸引力（评分、评论数）和距离远近分摊到每家店：离得越远、吸引力越低，分到的越少。参与分流的竞品 {fmtInt(m.demand.huff.competitor_set)} 家。</span>
            </li>
            <li>
              <span className="li-head">评分</span>
              <span className="li-body">综合评分 = 六项得分 × 各自权重后相加；判定门槛见第 11 页</span>
            </li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">参数与数据完整度 · Parameters</div>
          <p className="params-line">
            数据完整度 <strong>{fmtInt(m.confidence.total)}/100</strong>（{LEVEL_LABEL[m.confidence.level]}）= 各数据源的权重 × 质量相加：{comps.map(([k, c]) => `${CONFIDENCE_COMPONENT_ZH[k] ?? k} ${fmtInt(c.weight)}%×${fmtNum(c.quality, 2)}`).join(' · ')}
          </p>
          <p className="params-line">
            范围：{rings.map((r) => `${RING_LABEL[r.id].zh.replace('范围', '')}`).join(' · ')} · 主商圈 {RING_LABEL[m.trade_area.primary_ring].zh} · 范围计算 {m.trade_area.isochrone_method === 'mapbox' ? '按实际路网' : '按直线半径近似'}
          </p>
          <p className="params-line">
            分流参数：吸引力 {fmtNum(m.demand.huff.alpha, 2)} · 距离衰减 {fmtNum(m.demand.huff.beta, 2)} · 引擎版本 {m.meta.engine_version}
          </p>
        </div>
      </div>
      <p className="disclaimer">
        免责声明：本报告基于公开统计、平台数据与您的输入，按固定模型计算；所有「未获取」的字段都没有做估计。评分与判定仅供选址决策参考，不构成投资、法律或租赁建议；签约前请以实地核查、租约文本与专业顾问意见为准。
        {m.meta.tier === 'precheck' ? ` 本报告为预检版：部分关键数据未获取或未通过校验${precheck.length ? `（${precheck.join('；')}）` : ''}，详见上方「数据说明」。` : ''}
      </p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 15 · Summary & recommendations                                        */
/* ------------------------------------------------------------------ */
function Page15({ model }: PageProps) {
  const m = model;
  const v = verdictLabel(m.score.verdict);
  const cuisine = m.input.cuisine_label_zh;
  const cov = m.demand.coverage_ratio;
  const occ = m.finance.occupancy_cost_ratio;
  const weakest = [...m.score.dimensions].sort((a, b) => a.score - b.score)[0];
  const probRank = { high: 0, medium: 1, low: 2 } as const;
  const topRisk = [...m.risks].sort((a, b) => probRank[a.prob] - probRank[b.prob] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0))[0];
  const alts = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const bestAlt = alts.find((a) => a.verdict === 'GO' || a.verdict === 'CONDITIONAL_GO') ?? alts[0];
  const missing = m.finance.inputs_missing;
  const conds = m.score.conditions;
  const rankOf = (cuisine: string) => m.score.alternatives.findIndex((a) => a.cuisine === cuisine) + 1;

  const conclusion =
    `${cuisine}在这个地址的判定是「${v.zh}」。` +
    `模型预计每月能拿到 ${fmtUsd(m.demand.captured_monthly_usd)} 的需求，保本线（每月至少要做到的营收）是 ${fmtUsd(m.finance.breakeven_monthly)}，需求覆盖率 ${fmtPct(cov)}；` +
    `租金占预计营收 ${fmtPct(occ, 1)}（警戒线 10%）；综合评分 ${fmtNum(m.score.total, 1)} 分（满分 100）` +
    (weakest ? `，六项里最弱的是${weakest.label_zh}（${fmtNum(weakest.score, 0)} 分）。` : '。') +
    (topRisk ? `最要紧的风险：${plainZh(topRisk.risk_zh)}。` : '') +
    (bestAlt && m.score.verdict !== 'GO' ? `如果坚持这个地址，更适合做${bestAlt.label_zh}（${fmtNum(bestAlt.total, 1)} 分，${verdictLabel(bestAlt.verdict).zh}）。` : '');

  const nextSteps = [
    conds.length ? `先落实「签约前必须做的事」（${conds.length} 条），再谈租约` : '没有附加条件，可直接进入租约谈判',
    occ != null && occ > 0.1 ? `租金谈判：目标租金 ≤ 预计营收的 10%（现在 ${fmtPct(occ, 1)}），争取免租期或阶梯租金` : '租金已在 10% 警戒线内：锁定租期、免租期与转租条款',
    missing.length ? '补齐缺失输入后重跑报告，再决定签约' : '实地踩点午市、晚市、周末各一次，对照第 9 页的预计单数',
  ];

  return (
    <PageShell model={m} pageId="page_15" chips={<SourceChips model={m} ids={['D2', 'D6', 'D12']} model_labels={['综合评分', '需求分流模型', '保本模型']} />}>
      <div className="summary-top">
        <VerdictBadge verdict={m.score.verdict} />
        <div className="summary-keys">
          <KeyNumber label="需求覆盖率" value={fmtPct(cov)} sub="预计月需求 ÷ 保本线，≥ 100% 才够保本" />
          <KeyNumber label="占用成本比" value={fmtPct(occ, 1)} sub="租金 ÷ 预计营收，警戒线 10%" />
          <KeyNumber label="综合评分" value={`${fmtNum(m.score.total, 1)}`} sub="/ 100 · ≥ 70 可做，55–69 有条件可做" />
        </div>
      </div>
      <p className="final-conclusion">{conclusion}</p>
      <div className="two-col">
        <div className="panel">
          <div className="panel-title">签约前必须做的事 · Must do before signing</div>
          <ul className="check-list boxes">
            {conds.map((c, i) => (
              <li key={`c${i}`}>
                <span className="box" />
                <span>{plainZh(c.text_zh)}</span>
              </li>
            ))}
            {missing.length ? (
              <li>
                <span className="box" />
                <span>
                  <strong>补齐缺失输入</strong> {missing.map(plainZh).join('、')}（见第 13 页）
                </span>
              </li>
            ) : null}
            {conds.length === 0 && missing.length === 0 ? (
              <li>
                <span className="box" />
                <span>无附加条件与缺失输入</span>
              </li>
            ) : null}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">更适合的替代菜系前三 · Better-fit alternatives</div>
          <table className="data-table compact alt-table">
            <thead>
              <tr>
                <th className="num">名次</th>
                <th>菜系</th>
                <th className="num">综合分</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {alts.length === 0 ? (
                <tr>
                  <Cell num>—</Cell>
                  <Cell>{NA}</Cell>
                  <Cell num>{NA}</Cell>
                  <Cell>{NA}</Cell>
                </tr>
              ) : null}
              {alts.map((a) => (
                <tr key={a.cuisine}>
                  <Cell num>{rankOf(a.cuisine)}</Cell>
                  <Cell>{a.label_zh}</Cell>
                  <Cell num>{fmtNum(a.total, 1)}</Cell>
                  <Cell className="nowrap">{verdictLabel(a.verdict).zh}</Cell>
                </tr>
              ))}
              <tr className="highlight">
                <Cell num>{fmtInt(m.score.user_cuisine_rank)}</Cell>
                <Cell>
                  {cuisine} <span className="muted">您选的</span>
                </Cell>
                <Cell num>{fmtNum(m.score.total, 1)}</Cell>
                <Cell className="nowrap">{v.zh}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <h2 className="h2">下一步 · Next steps</h2>
      <ol className="next-steps">
        {nextSteps.map((s, i) => (
          <li key={i}>
            <span className="step-no">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </PageShell>
  );
}

export const PAGE_COMPONENTS: Record<PageId, ComponentType<PageProps>> = {
  page_1: Page1,
  page_2: Page2,
  page_3: Page3,
  page_4: Page4,
  page_5: Page5,
  page_6: Page6,
  page_7: Page7,
  page_8: Page8,
  page_9: Page9,
  page_10: Page10,
  page_11: Page11,
  page_12: Page12,
  page_13: Page13,
  page_14: Page14,
  page_15: Page15,
};

/** An unnumbered cover page, then all fifteen pages in PAGES order. `staticMaps` (optional) is the raster basemap pair for the cover, page 1 and page 3. */
export function ReportDocument({ model, staticMaps }: PageProps) {
  return (
    <main className="report" data-report-id={model.meta.report_id} lang="zh-CN">
      <CoverPage model={model} staticMaps={staticMaps} />
      {PAGES.map((p) => {
        const C = PAGE_COMPONENTS[p.id];
        return <C key={p.id} model={model} staticMaps={staticMaps} />;
      })}
    </main>
  );
}
