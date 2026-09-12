/**
 * The fourteen /print pages (研发提示词 Phase 5.2). Every page has the same
 * fixed structure:
 *   <h1 class="action-title">  — judgment title from model.narrative (LLM) or
 *                                templateNarrative() fallback; never invented here
 *   one-line English subtitle
 *   ONE core chart or table
 *   interpretation (narrative body, citations stripped)
 *   source chips
 * Only report_model fields are shown; null → 「未获取」.
 */
import type { ComponentType, ReactNode } from 'react';
import {
  Calculator,
  Check,
  ClipboardCheck,
  Database,
  FileText,
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
import type { ReportModel } from '../model/schema';
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
  LEVEL_LABEL,
  NA,
  PROB_LABEL,
  RING_LABEL,
  SCENARIO_LABEL,
  SEGMENT_LABEL,
  fmtDate,
  fmtInt,
  fmtMiles,
  fmtMinutes,
  fmtMulti,
  fmtNum,
  fmtPct,
  fmtUsd,
  priceLevelLabel,
  probColor,
  ring,
  scoreColor,
  stripCitations,
  verdictLabel,
} from './format';
import { MapLegend, TradeAreaMap } from './map';

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>;

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
};

const SUBTITLE_EN: Record<PageId, string> = {
  page_1: '360° site-selection report for a Chinese restaurant concept',
  page_2: 'Executive Summary · verdict, evidence, risks and pre-lease conditions',
  page_3: 'Trade Area Map · isochrone rings, competitors, anchors and rail access',
  page_4: 'Demand Coverage · four-ring profile against the county benchmark',
  page_5: 'Audience · segment share, index and the lunch / dinner split',
  page_6: 'Competitive Landscape · layer counts, price ladder and cluster position',
  page_7: 'Direct Competitors · L1 benchmarks against the break-even line',
  page_8: 'Category Gap & Alternatives · void test and the cuisine ranking',
  page_9: 'Demand Capture · Huff model output by ring, daypart and coverage',
  page_10: 'Financial Model · cost base, break-even, scenarios and sensitivity',
  page_11: 'Cuisine Fit Score · six weighted dimensions and the verdict',
  page_12: 'Risk Register · probability × impact with triggers and hedges',
  page_13: 'Pre-lease Checklist & 90-day Plan · what to settle before signing',
  page_14: 'Method & Sources · data lineage, formulas, parameters and disclaimer',
};

export function narrativeFor(model: ReportModel, pageId: PageId) {
  const n = model.narrative?.[pageId];
  if (n && typeof n.title === 'string' && n.title.trim() && typeof n.body === 'string') return n;
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
        <h1 className="action-title">{n.title}</h1>
        <p className="subtitle-en">{SUBTITLE_EN[pageId]}</p>
      </header>
      <div className="page-body">{children}</div>
      <div className="page-tail">
        {tail}
        <p className="interp">{stripCitations(n.body) || NA}</p>
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

/* ------------------------------------------------------------------ */
/* 1 · Cover                                                             */
/* ------------------------------------------------------------------ */
function Page1({ model }: { model: ReportModel }) {
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
              {m.input.matched_address && m.input.matched_address !== m.input.address ? <div className="cover-note">输入：{m.input.address}</div> : null}
            </div>
            <div className="cover-field">
              <div className="cover-label">菜系 · Cuisine</div>
              <div className="cover-value">
                {m.input.cuisine_label_zh} · {m.input.cuisine_label_en}
                <span className="muted"> · {m.input.range_class === 'destination' ? '目的地型' : m.input.range_class === 'regular' ? '常规型' : '日常型'}</span>
              </div>
            </div>
            <div className="cover-verdict">
              <VerdictBadge verdict={m.score.verdict} />
              <div className="cover-keys">
                <KeyNumber label="综合评分 · Score" value={`${fmtNum(m.score.total, 1)} / 100`} />
                <KeyNumber label="置信度 · Confidence" value={`${fmtInt(m.confidence.total)} · ${LEVEL_LABEL[m.confidence.level]}`} />
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
                  <th>报告层级</th>
                  <Cell>{m.meta.tier === 'paid' ? '完整版 · Paid' : '预检版 · Precheck'}</Cell>
                </tr>
                <tr>
                  <th>引擎版本</th>
                  <Cell>{m.meta.engine_version}</Cell>
                </tr>
                <tr>
                  <th>行政区</th>
                  <Cell>
                    {m.geo.county_name ?? m.geo.county}
                    {m.geo.metro ? ` · ${m.geo.metro}` : ''} · tract {m.geo.tract}
                  </Cell>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="cover-map">
          <TradeAreaMap model={m} compact />
        </div>
        <div className="cover-map-caption">
          主商圈 {RING_LABEL[m.trade_area.primary_ring].zh} · 步行 10 / 车程 5·10·15 分钟等时圈 · L1 直接竞品 {m.competitors.l1.length} 家 · L4 华人锚点 {m.competitors.l4.length} 处 · 详见第 3 页
        </div>
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Executive summary                                                 */
/* ------------------------------------------------------------------ */
function Page2({ model }: { model: ReportModel }) {
  const m = model;
  const reasons = [...m.score.dimensions].sort((a, b) => b.score - a.score).slice(0, 3);
  const probRank = { high: 0, medium: 1, low: 2 } as const;
  const risks = [...m.risks].sort((a, b) => probRank[a.prob] - probRank[b.prob] || (b.impact_usd ?? 0) - (a.impact_usd ?? 0)).slice(0, 3);
  const conds = m.score.conditions.slice(0, 3);
  return (
    <PageShell model={m} pageId="page_2" chips={<SourceChips model={m} ids={['D2', 'D5', 'D6', 'D12']} model_labels={['Huff 需求捕获', '保本模型']} />}>
      <div className="summary-top">
        <VerdictBadge verdict={m.score.verdict} />
        <div className="summary-keys">
          <KeyNumber label="综合评分" value={`${fmtNum(m.score.total, 1)}`} sub="/ 100 · 六维加权，见第 11 页" />
          <KeyNumber label="需求覆盖比" value={fmtPct(m.demand.coverage_ratio)} sub="捕获需求 ÷ 保本线" />
          <KeyNumber label="置信度" value={`${fmtInt(m.confidence.total)}`} sub={`${LEVEL_LABEL[m.confidence.level]} · 见第 14 页`} />
        </div>
      </div>
      <div className="twin-wrap">
        <h2 className="h2">保本 vs 捕获需求 · Break-even vs Captured Demand</h2>
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
                <span className="li-body">{d.drivers[0] ?? NA}</span>
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
                  {r.risk_zh}
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
                <span className="li-body">{c.text_zh}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <XRef>
        主商圈 {RING_LABEL[m.trade_area.primary_ring].zh}（第 3–4 页）· 直接竞品 {m.competitors.l1.length} 家、其他中餐 {m.competitors.l2_count} 家（第 6–7 页）· 保本线 {fmtUsd(m.finance.breakeven_monthly)}（第 10 页）
      </XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Trade-area map                                                    */
/* ------------------------------------------------------------------ */
function Page3({ model }: { model: ReportModel }) {
  const m = model;
  const p = ring(m, m.trade_area.primary_ring);
  return (
    <PageShell model={m} pageId="page_3" chips={<SourceChips model={m} ids={['D4', 'D5', 'D6', 'D9']} />}>
      <div className="map-wrap">
        <TradeAreaMap model={m} />
      </div>
      <MapLegend model={m} />
      <div className="map-facts">
        <KeyNumber label="主商圈" value={RING_LABEL[m.trade_area.primary_ring].zh} sub={`面积 ${fmtNum(p?.area_sq_mi, 2)} sq mi · ${p?.block_groups ?? 0} 个 block group`} />
        <KeyNumber label="等时圈方法" value={m.trade_area.isochrone_method === 'mapbox' ? '路网等时圈' : '直线半径近似'} sub="Mapbox Isochrone · 步行 10 / 车程 5·10·15" />
        <KeyNumber label="候选 POI" value={fmtInt(m.competitors.candidates_total)} sub={`L1 ${m.competitors.l1.length} · L2 ${m.competitors.l2_count} · L3 ${m.competitors.l3_count} · L4 ${m.competitors.l4.length}`} />
      </div>
      <XRef>圈层人口与消费见第 4 页；竞品明细见第 6–7 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Ring table                                                        */
/* ------------------------------------------------------------------ */
function Page4({ model }: { model: ReportModel }) {
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
    { label: '日间岗位', en: 'Daytime jobs', get: (r) => fmtInt(r.jobs), county: NOT_APPLICABLE },
    { label: '年餐饮支出', en: 'Restaurant spend / yr', get: (r) => fmtUsd(r.restaurant_spend_usd), county: NOT_APPLICABLE },
    { label: '年中餐支出', en: 'Chinese-food spend / yr', get: (r) => fmtUsd(r.chinese_spend_usd), county: NOT_APPLICABLE },
    { label: `${m.input.cuisine_label_zh}年需求`, en: 'Cuisine demand / yr', get: (r) => fmtUsd(r.cuisine_demand_usd), county: NOT_APPLICABLE },
    { label: '25–44 岁占比', en: 'Age 25–44', get: (r) => fmtPct(r.age_25_44_share, 1), county: NOT_APPLICABLE },
    { label: '有孩家庭占比', en: 'Families w/ children', get: (r) => fmtPct(r.family_share, 1), county: NOT_APPLICABLE },
    { label: '面积 (sq mi)', en: 'Area', get: (r) => fmtNum(r.area_sq_mi, 2), county: NOT_APPLICABLE },
  ];
  const jobsMethod = rings.find((r) => r.jobs_method !== 'none')?.jobs_method;
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
        圈层加权：block group 面积份额 × ACS 2023 五年数；日间岗位方法 {jobsMethod === 'lodes_wac' ? 'LODES WAC' : jobsMethod === 'acs_b08301_estimate' ? 'ACS B08301 通勤反推（降级）' : NA}；「不适用」= 全县基准仅提供收入与中文家庭占比。
      </p>
      <XRef>需求捕获（Huff）见第 9 页；客群分段见第 5 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Audience                                                          */
/* ------------------------------------------------------------------ */
function Page5({ model }: { model: ReportModel }) {
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
          <SplitBar a={lunch} b={dinner} labelA="午市" labelB="晚市" valueA="工作日岗位驱动" valueB="居住人口驱动" />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>walk10 岗位</th>
                <Cell num>{fmtInt(ring(m, 'walk10')?.jobs)}</Cell>
              </tr>
              <tr>
                <th>主商圈户均人数</th>
                <Cell num>{fmtNum(ring(m, m.trade_area.primary_ring)?.avg_hh_size, 2)}</Cell>
              </tr>
              <tr>
                <th>主商圈租户占比</th>
                <Cell num>{fmtPct(ring(m, m.trade_area.primary_ring)?.renter_share, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">计算依据 · Basis</h2>
          <table className="data-table compact">
            <tbody>
              {segs.map((s) => (
                <tr key={s.id}>
                  <th>
                    {s.label}
                    <span className="th-en">{SEGMENT_LABEL[s.id]?.en}</span>
                  </th>
                  <Cell>{s.basis}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <XRef>午市 / 晚市对应的捕获金额见第 9 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Competitive landscape                                             */
/* ------------------------------------------------------------------ */
function Page6({ model }: { model: ReportModel }) {
  const c = model.competitors;
  return (
    <PageShell model={model} pageId="page_6" chips={<SourceChips model={model} ids={['D5', 'D6', 'D7']} model_labels={['集聚分 U 型曲线']} />}>
      <div className="two-col">
        <div>
          <table className="data-table">
            <thead>
              <tr>
                <th>层级 · Layer</th>
                <th className="num">数量</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>L1 直接竞品</th>
                <Cell num>{fmtInt(c.l1.length)}</Cell>
                <Cell>同子菜系 · {model.input.cuisine_label_zh}</Cell>
              </tr>
              <tr>
                <th>L2 其他中餐</th>
                <Cell num>{fmtInt(c.l2_count)}</Cell>
                <Cell>其他中餐子菜系</Cell>
              </tr>
              <tr>
                <th>L3 亚洲餐饮</th>
                <Cell num>{fmtInt(c.l3_count)}</Cell>
                <Cell>日 / 韩 / 越 / 泰等</Cell>
              </tr>
              <tr>
                <th>L4 华人锚点</th>
                <Cell num>{fmtInt(c.l4.length)}</Cell>
                <Cell>超市 / 银行 / 学校 / 茶饮</Cell>
              </tr>
              <tr>
                <th>walk10 内 L1+L2</th>
                <Cell num>{fmtInt(c.walk10_l1_l2_count)}</Cell>
                <Cell>集聚曲线横轴</Cell>
              </tr>
              <tr>
                <th>密度 / 万居民</th>
                <Cell num>{fmtNum(c.density_per_10k_residents, 1)}</Cell>
                <Cell>中餐店 ÷ 主商圈人口</Cell>
              </tr>
              <tr>
                <th>密度 / 万华裔</th>
                <Cell num>{fmtNum(c.density_per_10k_chinese, 1)}</Cell>
                <Cell>缺口检验用，见第 8 页</Cell>
              </tr>
              <tr>
                <th>HHI 集中度</th>
                <Cell num>{fmtNum(c.hhi, 3)}</Cell>
                <Cell>按评论数份额</Cell>
              </tr>
              <tr>
                <th>L1 评分（均值 / 加权）</th>
                <Cell num>
                  {fmtNum(c.avg_rating_l1, 1)} / {fmtNum(c.weighted_rating_l1, 2)}
                </Cell>
                <Cell>Google 评分</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">价格阶梯 · Price ladder</h2>
          <PriceLadder ladder={c.price_ladder} />
          <div className="key-row">
            <KeyNumber label="关店率 · Closure" value={fmtPct(c.closure_rate, 1)} sub="Google 永久关闭 ÷ 去重地点" />
            <KeyNumber label="集聚分 · Cluster" value={fmtNum(c.cluster_score, 0)} sub="U 型曲线，0–100" />
          </div>
        </div>
      </div>
      <h2 className="h2">集聚曲线 · Cluster curve</h2>
      <ClusterCurve walk10Count={c.walk10_l1_l2_count} clusterScore={c.cluster_score} />
      {!c.guard_passed ? <p className="table-note">数据完整性守卫未通过：{c.guard_notes.join('；') || NA}</p> : null}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 7 · Competitor cards                                                  */
/* ------------------------------------------------------------------ */
function Page7({ model }: { model: ReportModel }) {
  const m = model;
  const cards = [...m.competitors.l1].sort((a, b) => (b.huff_share ?? 0) - (a.huff_share ?? 0) || a.distance_mi - b.distance_mi).slice(0, 8);
  const b = m.competitors.benchmark_revenue_band;
  const be = m.finance.breakeven_monthly;
  const bandRows = [
    { label: 'P25', value: b.p25 },
    { label: '中位 Median', value: b.median },
    { label: 'P75', value: b.p75 },
    { label: '本址保本线', value: be, color: '#FF6B35' },
  ];
  const tierLabel = (t: number | null) => (t == null ? NA : `T${t} / 5`);
  return (
    <PageShell model={m} pageId="page_7" chips={<SourceChips model={m} ids={['D5', 'D6', 'D7']} model_labels={['Huff 份额']} />}>
      <div className="cards-grid">
        {cards.length === 0 ? <div className="panel">直接竞品：{NA}</div> : null}
        {cards.map((c, i) => (
          <div className="comp-card" key={c.id}>
            <div className="comp-head">
              <span className="comp-rank">{i + 1}</span>
              <span className="comp-name">
                {c.name_zh ?? c.name}
                {c.name_zh ? <span className="muted"> {c.name}</span> : null}
              </span>
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
              <dd className="num">{c.hours_per_week == null ? NA : `${fmtInt(c.hours_per_week)} h`}</dd>
              <dt>Huff 份额</dt>
              <dd className="num">{fmtPct(c.huff_share, 1)}</dd>
              <dt>月新增评论</dt>
              <dd className="num">{fmtInt(c.monthly_review_growth)}</dd>
              <dt>外卖</dt>
              <dd>{c.offers_delivery == null ? NA : c.offers_delivery ? '提供' : '不提供'}</dd>
            </dl>
          </div>
        ))}
      </div>
      <h2 className="h2">同品类营收带 vs 保本线 · Benchmark band</h2>
      <HBars rows={bandRows} valueLabel={(v) => fmtUsd(v)} labelWidth={110} valueWidth={90} height={16} gap={6} />
      <p className="table-note">营收带方法：{b.method}{b.median == null ? '（无历史快照，仅给相对客流等级）' : ''}。</p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 8 · Void analysis + alternatives                                      */
/* ------------------------------------------------------------------ */
function Page8({ model }: { model: ReportModel }) {
  const m = model;
  const v = m.competitors.void;
  const alts = m.score.alternatives.filter((a) => a.cuisine !== m.input.cuisine).slice(0, 3);
  const mine = m.score.alternatives.find((a) => a.cuisine === m.input.cuisine);
  const conds = [
    { ok: v.conditions.chinese_pop_ok, label: '华裔人口达到门槛', en: 'Chinese population' },
    { ok: v.conditions.density_ok, label: '密度低于枢纽中位', en: 'Density vs hub median' },
    { ok: v.conditions.l2_ok, label: 'L2 其他中餐足够', en: 'L2 supply present' },
  ];
  const rankOf = (cuisine: string) => m.score.alternatives.findIndex((a) => a.cuisine === cuisine) + 1;
  return (
    <PageShell model={m} pageId="page_8" chips={<SourceChips model={m} ids={['D2', 'D5']} model_labels={['缺口三条件', '替代菜系评分']} />}>
      <div className="two-col">
        <div>
          <h2 className="h2">密度 vs 华人枢纽中位 · Density</h2>
          <DensityBar density={m.competitors.density_per_10k_chinese} ratioVsHub={v.density_vs_hub_median} />
          <p className="table-note">本址 ÷ 枢纽中位 = {fmtMulti(v.density_vs_hub_median)}；全都会区同子菜系门店 {fmtInt(m.competitors.metro_sub_cuisine_total)} 家。</p>
        </div>
        <div>
          <h2 className="h2">缺口三条件 · Void test</h2>
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
            结论：<strong>{v.is_void ? '品类空白' : '供给较少，非空白'}</strong>
            <span className="muted"> · {v.reason}</span>
          </div>
        </div>
      </div>
      <h2 className="h2">替代菜系 Top 3 · Alternatives</h2>
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
              {m.input.cuisine_label_zh} <span className="muted">{m.input.cuisine_label_en} · 用户菜系</span>
            </Cell>
            <Cell num>{fmtNum(mine?.total ?? m.score.total, 1)}</Cell>
            <Cell>{verdictLabel(mine?.verdict ?? m.score.verdict).zh}</Cell>
          </tr>
        </tbody>
      </table>
      <XRef>共评估 {m.score.alternatives.length} 个菜系；用户菜系的六维得分见第 11 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 9 · Huff results                                                      */
/* ------------------------------------------------------------------ */
function Page9({ model }: { model: ReportModel }) {
  const d = model.demand;
  const parts = d.by_ring.map((r) => ({ label: RING_LABEL[r.ring].en, value: r.monthly_usd, share: r.share }));
  return (
    <PageShell model={model} pageId="page_9" chips={<SourceChips model={model} ids={['D2', 'D10', 'D5', 'D6']} model_labels={['Huff 引力模型']} />}>
      <h2 className="h2">按圈层捕获 · Captured demand by ring</h2>
      {parts.length ? <StackedRingBar parts={parts} total={d.captured_monthly_usd} /> : <p className="table-note">{NA}</p>}
      <div className="two-col">
        <div>
          <h2 className="h2">午市 / 晚市 · Daypart</h2>
          <SplitBar a={d.lunch_usd ?? 0} b={d.dinner_usd ?? 0} labelA="午市" labelB="晚市" valueA={fmtUsd(d.lunch_usd)} valueB={fmtUsd(d.dinner_usd)} />
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>捕获月需求</th>
                <Cell num>{fmtUsd(d.captured_monthly_usd)}</Cell>
              </tr>
              <tr>
                <th>日均单量</th>
                <Cell num>{fmtInt(d.captured_covers_day)}</Cell>
              </tr>
              <tr>
                <th>菜系份额</th>
                <Cell num>{fmtPct(d.cuisine_share, 1)}</Cell>
              </tr>
              <tr>
                <th>Huff α / β</th>
                <Cell num>
                  {fmtNum(d.huff.alpha, 2)} / {fmtNum(d.huff.beta, 2)}
                </Cell>
              </tr>
              <tr>
                <th>本址吸引力</th>
                <Cell num>{fmtNum(d.huff.site_attractiveness, 2)}</Cell>
              </tr>
              <tr>
                <th>竞品集合</th>
                <Cell num>{fmtInt(d.huff.competitor_set)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="h2">需求覆盖比 · Coverage</h2>
          <CoverageGauge ratio={d.coverage_ratio} />
        </div>
      </div>
      <XRef>保本线与安全线见第 10 页；菜系份额方法见第 14 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · Finance                                                          */
/* ------------------------------------------------------------------ */
function Page10({ model }: { model: ReportModel }) {
  const f = model.finance;
  const fc = f.fixed_cost;
  const base = f.scenarios.find((s) => s.id === 'base');
  const costRows: Array<[string, number | null]> = [
    ['租金', fc.rent],
    ['人工', fc.labor],
    ['水电', fc.utilities],
    ['保险', fc.insurance],
    ['POS / 软件', fc.pos],
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
                    {label === '租金' ? <span className="muted"> · {f.rent_source === 'user_input' ? '用户输入' : f.rent_source}</span> : null}
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
                <th>占用成本比（租金 ÷ 捕获营收）</th>
                <Cell num>{fmtPct(f.occupancy_cost_ratio, 1)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="key-row">
            <KeyNumber label="保本线 / 月" value={fmtUsd(f.breakeven_monthly)} sub="固定成本 ÷ 边际贡献率" />
            <KeyNumber label="安全线 / 月" value={fmtUsd(f.safety_monthly)} sub="保本 × 1.28" />
          </div>
          {f.payback_months != null ? <KeyNumber label="回收期" value={`${fmtInt(f.payback_months)} 个月`} sub={`CapEx ${fmtUsd(model.input.capex_usd)}`} /> : null}
          <table className="data-table compact">
            <tbody>
              <tr>
                <th>用户输入：租金 / 面积 / 座位</th>
                <Cell num>
                  {fmtUsd(model.input.rent_usd)} / {fmtInt(model.input.sqft)} sqft / {fmtInt(model.input.seats)}
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
      <h2 className="h2">敏感性 · Sensitivity</h2>
      <div className="waterfall-wrap">
        <SensitivityWaterfall base={base?.monthly_revenue ?? null} breakeven={f.breakeven_monthly} items={f.sensitivity.map((s) => ({ label: s.label_zh, delta: s.monthly_revenue_delta, breaks: s.breaks_breakeven }))} />
      </div>
      <p className="table-note">口径：{f.method}。{f.payback_months == null ? `回收期不显示：${f.inputs_missing.join('、') || '未提供 CapEx'}。` : ''}</p>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 11 · Six-dimension score                                              */
/* ------------------------------------------------------------------ */
function Page11({ model }: { model: ReportModel }) {
  const s = model.score;
  const weightSum = s.dimensions.reduce((a, d) => a + d.weight, 0);
  return (
    <PageShell model={model} pageId="page_11" chips={<SourceChips model={model} ids={[]} model_labels={['六维加权评分', '判定阈值']} />}>
      <table className="data-table score-table">
        <thead>
          <tr>
            <th>维度 · Dimension</th>
            <th className="num">得分</th>
            <th>量表</th>
            <th className="num">权重</th>
            <th className="num">加权分</th>
            <th>驱动因子 · Drivers</th>
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
              <Cell>{d.drivers.length ? d.drivers.join('；') : NA}</Cell>
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
                <span className="li-head">{s.dimensions.find((d) => d.id === c.dimension)?.label_zh ?? c.dimension}</span>
                <span className="li-body">{c.text_zh}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title">判定规则 · Verdict rule</div>
          <ul className="tight-list">
            <li>
              <span className="dot" style={{ background: scoreColor(80) }} />
              <span className="li-body">GO 可做：综合 ≥ 70 且无一票否决</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(55) }} />
              <span className="li-body">CONDITIONAL GO 有条件可做：55–69，或条件页可闭合</span>
            </li>
            <li>
              <span className="dot" style={{ background: scoreColor(20) }} />
              <span className="li-body">NO GO 不建议：{'< 55'}，或财务 / 需求维度触发否决</span>
            </li>
          </ul>
          {s.cannibalization.length ? (
            <p className="table-note">
              自蚕食：{s.cannibalization.map((c) => `${c.store} ${fmtPct(c.diverted_share, 1)}`).join('；')}
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
function Page12({ model }: { model: ReportModel }) {
  const risks = model.risks;
  return (
    <PageShell model={model} pageId="page_12" chips={<SourceChips model={model} ids={['D11', 'D12']} model_labels={['风险评估']} />}>
      <h2 className="h2">概率 × 影响 · Matrix</h2>
      <div className="risk-matrix-wrap">
        <RiskMatrix risks={risks} />
      </div>
      <div className="key-row three">
        <KeyNumber label="高概率风险" value={`${fmtInt(risks.filter((r) => r.prob === 'high').length)} 项`} sub={`共 ${risks.length} 项`} />
        <KeyNumber label="已量化影响合计 / 月" value={fmtUsd(risks.reduce((a, r) => a + (r.impact_usd ?? 0), 0))} sub={`${risks.filter((r) => r.impact_usd != null).length} 项已量化`} />
        <KeyNumber label="未量化影响" value={`${fmtInt(risks.filter((r) => r.impact_usd == null).length)} 项`} sub="表中显示为「未获取」" />
      </div>
      <table className="data-table risk-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>风险 · Risk</th>
            <th>概率</th>
            <th className="num">影响 / 月</th>
            <th>触发条件 · Trigger</th>
            <th>对冲 · Hedge</th>
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
              <Cell>{r.risk_zh}</Cell>
              <td>
                <span className="dot" style={{ background: probColor(r.prob) }} /> {PROB_LABEL[r.prob]}
              </td>
              <Cell num>{fmtUsd(r.impact_usd)}</Cell>
              <Cell>{r.trigger && r.trigger !== '—' ? r.trigger : NA}</Cell>
              <Cell>{r.hedge || NA}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <XRef>占用成本比与保本线见第 10 页；需求覆盖比见第 9 页；对应签约条件见第 13 页。</XRef>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* 13 · Pre-lease checklist + 90-day plan                                */
/* ------------------------------------------------------------------ */
const GENERIC_LEASE_DOCS = [
  '租约草案：租期、免租期、阶梯租金、百分比租金条款',
  'CAM / NNN 费用明细与上限',
  '装修条款：业主补贴（TI）、施工许可责任',
  '排烟 / 燃气 / 油脂分离器现状与改造责任',
  '用途限制与排他条款（同菜系竞品）',
  '转租 / 退出条款与个人担保范围',
  '停车与装卸位分配（含外卖取餐）',
  '施工期租金减免条款（周边在建项目）',
];

const NINETY_DAY_STEPS: Array<{ day: string; label: string }> = [
  { day: 'D0–7', label: '落实条件页与缺失输入，重跑报告' },
  { day: 'D8–14', label: '租金谈判：以占用成本比 ≤ 10% 为目标' },
  { day: 'D15–21', label: '实地踩点 3 次：午市 / 晚市 / 周末客流' },
  { day: 'D22–30', label: '菜单与客单价定稿（套餐锚定）' },
  { day: 'D31–45', label: '签约 · 报建 · 排烟与燃气改造' },
  { day: 'D46–60', label: '外卖平台上线，预验证需求' },
  { day: 'D61–75', label: '招聘与培训；软开业' },
  { day: 'D76–90', label: '复盘：实际营收 vs 保本线，触发风险对冲' },
];

function Page13({ model }: { model: ReportModel }) {
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
                  <strong>条件</strong> {c.text_zh}
                </span>
              </li>
            ))}
            {missing.map((s, i) => (
              <li key={`m${i}`}>
                <span className="box" />
                <span>
                  <strong>补充输入</strong> {s}
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
/* 14 · Sources & method                                                 */
/* ------------------------------------------------------------------ */
function Page14({ model }: { model: ReportModel }) {
  const m = model;
  const statusZh: Record<string, string> = { ok: '完整', partial: '部分', failed: '未获取' };
  const comps = Object.entries(m.confidence.components);
  return (
    <PageShell model={m} pageId="page_14" chips={<SourceChips model={m} ids={m.sources.map((s) => s.id)} />}>
      <table className="data-table sources-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>数据源 · Source</th>
            <th>状态</th>
            <th>获取</th>
            <th>覆盖说明 · Coverage</th>
            <th>许可 · License</th>
            <th className="num">成本</th>
          </tr>
        </thead>
        <tbody>
          {m.sources.map((s) => (
            <tr key={s.id}>
              <Cell>{s.id}</Cell>
              <Cell>
                <span className="clamp2">{s.name}</span>
              </Cell>
              <td>
                <span className="dot" style={{ background: s.status === 'ok' ? '#1F8A5B' : s.status === 'partial' ? '#C98A00' : '#C63D2F' }} /> {statusZh[s.status] ?? s.status}
                {s.degraded_from ? <span className="muted clamp2"> 降级自 {s.degraded_from}</span> : null}
              </td>
              <Cell num>{fmtDate(s.fetched_at)}</Cell>
              <Cell className="wrap">
                <span className="clamp2">{s.coverage_note || NA}</span>
              </Cell>
              <Cell className="wrap">
                <span className="clamp2">{s.license || NA}</span>
              </Cell>
              <Cell num>{s.cost_usd === 0 ? '$0' : `$${s.cost_usd.toFixed(3)}`}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="two-col sources-panels">
        <div className="panel">
          <div className="panel-title">公式 · Formulas</div>
          <ul className="tight-list small">
            <li>
              <span className="li-head">财务</span>
              <span className="li-body">{m.finance.method}</span>
            </li>
            <li>
              <span className="li-head">菜系份额</span>
              <span className="li-body">{m.demand.cuisine_share_method}</span>
            </li>
            <li>
              <span className="li-head">Huff</span>
              <span className="li-body">
                P(i→j) = A_j^α · d_ij^−β ÷ Σ_k A_k^α · d_ik^−β；α = {fmtNum(m.demand.huff.alpha, 2)}，β = {fmtNum(m.demand.huff.beta, 2)}，竞品集合 {fmtInt(m.demand.huff.competitor_set)} 家
              </span>
            </li>
            <li>
              <span className="li-head">评分</span>
              <span className="li-body">综合 = Σ 维度得分 × 权重；判定阈值见第 11 页</span>
            </li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-title">参数与置信度 · Parameters</div>
          <p className="params-line">
            {comps.map(([k, c]) => `${k} ${fmtInt(c.weight)}%×${fmtNum(c.quality, 2)}`).join(' · ')}
          </p>
          <p className="params-line">
            置信度 = Σ 权重 × 质量 = <strong>{fmtInt(m.confidence.total)}</strong>（{LEVEL_LABEL[m.confidence.level]}）· 报告成本 ${m.meta.cost_usd.toFixed(3)} · 耗时 {fmtInt(m.meta.elapsed_ms / 1000)} s · 引擎 {m.meta.engine_version}
          </p>
          <p className="params-line">
            圈层：{m.trade_area.rings.map((r) => `${r.id} ${r.minutes} min`).join(' · ')} · 主商圈 {m.trade_area.primary_ring} · 等时圈 {m.trade_area.isochrone_method}
          </p>
        </div>
      </div>
      <p className="disclaimer">
        免责声明：本报告基于公开统计、平台数据与用户输入，按固定模型计算；所有「未获取」字段未作估计。评分与判定仅供选址决策参考，不构成投资、法律或租赁建议；签约前请以实地核查、租约文本与专业顾问意见为准。
        {m.meta.precheck_reasons.length ? ` 预检说明：${m.meta.precheck_reasons.join('；')}。` : ''}
        {m.meta.degradations.length ? ` 已声明的降级：${m.meta.degradations.map((d) => (d.startsWith('overture_not_loaded_google_only') ? `Overture POI 底图未加载，本报告以 Google Places 返回的 ${d.split(':')[1] ?? '—'} 家餐饮 POI 作为竞品池（bootstrap 模式）` : d)).join('；')}。` : ''}
      </p>
    </PageShell>
  );
}

export const PAGE_COMPONENTS: Record<PageId, ComponentType<{ model: ReportModel }>> = {
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
};

/** All fourteen pages in PAGES order. */
export function ReportDocument({ model }: { model: ReportModel }) {
  return (
    <main className="report" data-report-id={model.meta.report_id} lang="zh-CN">
      {PAGES.map((p) => {
        const C = PAGE_COMPONENTS[p.id];
        return <C key={p.id} model={model} />;
      })}
    </main>
  );
}
