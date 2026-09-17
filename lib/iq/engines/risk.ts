/**
 * RiskEngine — risk register (report page 12), probability × impact with a
 * trigger signal and a hedge. Every row is a template filled ONLY from model
 * numbers; rows whose facts are missing are not emitted.
 *
 * 评审 Spec §4.6 PDF 交付质量 (P1-c): a paid risk register whose 「影响 / 月」
 * column reads 「未获取」 for every row is worth less than the free web edition.
 * So every emitted risk must carry EITHER
 *   - `impact_usd` — a monthly dollar impact derived from model fields, with
 *     `impact_formula_zh/en` recording the arithmetic (the NumberGuard reads the
 *     numbers back out of it, and the reader can check it), OR
 *   - `unquantified_zh/en` — the reason no amount exists.
 * The renderer puts the quantified rows in the register table and folds the
 * unquantified ones into the pre-lease checklist prose, so the table total can
 * never read $0 (§4.6).
 */
import type { ReportModel } from '../model/schema';

type Risk = ReportModel['risks'][number];
type Model = Pick<ReportModel, 'finance' | 'competitors' | 'demand' | 'trade_area' | 'access' | 'input'> & {
  dev_projects?: number;
};

/** Occupancy-cost warning line: rent above 10 % of captured revenue is the excess we charge to the risk. */
const OCCUPANCY_LIMIT = 0.1;
/** Cold-start trigger: first-month revenue at 40 % of the base scenario — the shortfall is 60 % of it. */
const COLD_START_FLOOR = 0.4;

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

/** The impact half of a risk row: an amount plus its formula. */
function quantified(amount: number, zh: string, en: string): Pick<Risk, 'impact_usd' | 'impact_formula_zh' | 'impact_formula_en' | 'unquantified_zh' | 'unquantified_en'> {
  return { impact_usd: Math.round(amount), impact_formula_zh: zh, impact_formula_en: en, unquantified_zh: null, unquantified_en: null };
}

/** The impact half of a risk that genuinely has no amount: the documented reason instead. */
function unquantified(zh: string, en: string): Pick<Risk, 'impact_usd' | 'impact_formula_zh' | 'impact_formula_en' | 'unquantified_zh' | 'unquantified_en'> {
  return { impact_usd: null, impact_formula_zh: null, impact_formula_en: null, unquantified_zh: zh, unquantified_en: en };
}

export function computeRisks(m: Model): ReportModel['risks'] {
  const risks: ReportModel['risks'] = [];
  const f = m.finance;
  const c = m.competitors;
  const d = m.demand;
  let id = 1;
  const push = (r: Omit<Risk, 'id'>) => risks.push({ id: id++, ...r });

  const base = f.scenarios.find((s) => s.id === 'base');
  const tick = f.sensitivity.find((s) => s.id === 'ticket_minus_125');
  const turns = f.sensitivity.find((s) => s.id === 'turns_minus_05');
  const fixedTotal = f.fixed_cost.total;
  const captured = d.captured_monthly_usd;
  /** The revenue the occupancy line is measured against: captured demand, or the break-even line when demand is unknown. */
  const occupancyBase = captured ?? f.breakeven_monthly;

  // No rent provided: the largest fixed cost is unknown, so the rent risk row below cannot
  // be assessed and every break-even figure in the report is ex-rent. Say so, never guess.
  if (f.rent_excluded) {
    const ceiling = f.max_rent_for_10pct_usd;
    push({
      risk_zh: '未提供月租：占用成本比无法评估，保本线不含租金',
      risk_en: 'Monthly rent not provided: occupancy cost cannot be assessed; break-even excludes rent',
      prob: 'high',
      ...(ceiling != null && captured != null
        ? quantified(
            ceiling,
            `捕获月需求 ${usd(captured)} × ${pct(OCCUPANCY_LIMIT)} = 可承受月租上限 ${usd(ceiling)}；这笔月度占用成本目前完全未知`,
            `Captured monthly demand ${usd(captured)} × ${pct(OCCUPANCY_LIMIT)} = ${usd(ceiling)} affordable monthly rent — a monthly occupancy cost that is currently unknown`,
          )
        : unquantified(
            '既没有月租，也没有捕获月需求，算不出可承受的租金上限',
            'Neither a monthly rent nor a captured monthly demand is available, so no affordable-rent ceiling can be derived',
          )),
      trigger: '—',
      hedge: '在「补充信息」里填写月租后重新生成；租金以本报告给出的上限为目标',
    });
  }
  if (f.occupancy_cost_ratio != null && f.occupancy_cost_ratio > OCCUPANCY_LIMIT) {
    const rent = f.fixed_cost.rent;
    const excess = rent != null && occupancyBase != null ? rent - occupancyBase * OCCUPANCY_LIMIT : null;
    push({
      risk_zh: `租金占捕获营收 ${(f.occupancy_cost_ratio * 100).toFixed(1)}%，高于 10% 警戒线`,
      risk_en: `Rent is ${(f.occupancy_cost_ratio * 100).toFixed(1)}% of captured revenue, above the 10% line`,
      prob: f.occupancy_cost_ratio > 0.12 ? 'high' : 'medium',
      ...(excess != null && rent != null && occupancyBase != null
        ? quantified(
            excess,
            `月租 ${usd(rent)} − 参照营收 ${usd(occupancyBase)} × ${pct(OCCUPANCY_LIMIT)} = 每月多付 ${usd(excess)}`,
            `Monthly rent ${usd(rent)} − reference revenue ${usd(occupancyBase)} × ${pct(OCCUPANCY_LIMIT)} = ${usd(excess)} paid over the line each month`,
          )
        : unquantified('缺少月租或参照营收，算不出超出警戒线的金额', 'Without the monthly rent or the reference revenue the excess over the line cannot be derived')),
      trigger: '签约租金高于本报告条件页给出的上限',
      hedge: '争取免租期 / 阶梯租金 / 百分比租金条款',
    });
  }
  if (tick?.breaks_breakeven && base) {
    const loss = Math.abs(tick.monthly_revenue_delta);
    push({
      risk_zh: f.rent_excluded ? `客单价下滑 12.5% 即击穿保本线（不含租金；基准客单 $${base.ticket_in}）` : `客单价下滑 12.5% 即击穿保本线（基准客单 $${base.ticket_in}）`,
      risk_en: f.rent_excluded ? `A 12.5% ticket drop breaks even (excluding rent; base ticket $${base.ticket_in})` : `A 12.5% ticket drop breaks even (base ticket $${base.ticket_in})`,
      prob: 'medium',
      ...quantified(
        loss,
        `客单价 −12.5%：基准月营收 ${usd(base.monthly_revenue)} → 每月少收 ${usd(loss)}`,
        `Ticket −12.5%: base monthly revenue ${usd(base.monthly_revenue)} → ${usd(loss)} less each month`,
      ),
      trigger: '开业 3 个月后实际客单价 < 基准 × 0.9',
      hedge: '设计套餐锚定客单价；控制折扣渠道占比',
    });
  }
  if (c.closure_rate != null && c.closure_rate > 0.2) {
    push({
      risk_zh: `drive10 内中餐关店率 ${(c.closure_rate * 100).toFixed(0)}%`,
      risk_en: `${(c.closure_rate * 100).toFixed(0)}% of Chinese restaurants within drive10 have closed`,
      prob: 'high',
      ...(fixedTotal != null
        ? quantified(
            c.closure_rate * fixedTotal,
            `关店率 ${pct(c.closure_rate)} × 月固定成本 ${usd(fixedTotal)} = ${usd(c.closure_rate * fixedTotal)}：空置一个月就要照付的固定成本敞口`,
            `Closure rate ${pct(c.closure_rate)} × monthly fixed cost ${usd(fixedTotal)} = ${usd(c.closure_rate * fixedTotal)} — the fixed cost still owed for a month of vacancy`,
          )
        : unquantified('缺少月固定成本，算不出空置一个月的金额', 'Without the monthly fixed cost the cost of a vacant month cannot be derived')),
      trigger: '同商圈 12 个月内再有 2 家以上关店',
      hedge: '核查关店原因（租金 / 人力 / 客流）后再签',
    });
  }
  if (c.walk10_l1_l2_count === 0) {
    const gap = base ? base.monthly_revenue * (1 - COLD_START_FLOOR) : null;
    push({
      risk_zh: '步行 10 分钟内没有其他中餐：无华人餐饮流量，冷启动',
      risk_en: 'No other Chinese restaurant within a 10-minute walk: cold start',
      prob: 'high',
      ...(gap != null && base
        ? quantified(
            gap,
            `冷启动按首月只做到基准情景 ${pct(COLD_START_FLOOR)} 计：基准月营收 ${usd(base.monthly_revenue)} × ${pct(1 - COLD_START_FLOOR)} = 每月缺口 ${usd(gap)}`,
            `Cold start at ${pct(COLD_START_FLOOR)} of the base scenario in month one: base monthly revenue ${usd(base.monthly_revenue)} × ${pct(1 - COLD_START_FLOOR)} = ${usd(gap)} short each month`,
          )
        : unquantified('缺少基准情景月营收，算不出冷启动缺口', 'Without the base-scenario monthly revenue the cold-start shortfall cannot be derived')),
      trigger: '开业首月客流 < 基准情景 40%',
      hedge: '预留 ≥ 3 个月营销预算；与 L4 锚点（亚超 / 奶茶）联合推广',
    });
  } else if (c.walk10_l1_l2_count > 15) {
    const loss = tick ? Math.abs(tick.monthly_revenue_delta) : null;
    push({
      risk_zh: `步行 10 分钟内中餐 ${c.walk10_l1_l2_count} 家：饱和区间`,
      risk_en: `${c.walk10_l1_l2_count} Chinese restaurants within a 10-minute walk: saturated`,
      prob: 'medium',
      ...(loss != null && base
        ? quantified(
            loss,
            `饱和区价格战按客单价 −12.5% 计：基准月营收 ${usd(base.monthly_revenue)} → 每月少收 ${usd(loss)}`,
            `A price war in a saturated cluster priced as a 12.5% ticket cut: base monthly revenue ${usd(base.monthly_revenue)} → ${usd(loss)} less each month`,
          )
        : unquantified('缺少客单价敏感度测算，算不出价格战的金额', 'Without the ticket-sensitivity run the cost of a price war cannot be derived')),
      trigger: '同品类新店开业 / 价格战',
      hedge: '差异化定位于 L1 平均价位之外',
    });
  }
  if (c.avg_rating_l1 != null && c.avg_rating_l1 > 4.4) {
    const loss = turns ? Math.abs(turns.monthly_revenue_delta) : null;
    push({
      risk_zh: `直接竞品均分 ${c.avg_rating_l1}，品质门槛高`,
      risk_en: `Direct competitors average ${c.avg_rating_l1}★ — high quality bar`,
      prob: 'medium',
      ...(loss != null && base
        ? quantified(
            loss,
            `出品追不上均分按翻台 −0.5 计：基准月营收 ${usd(base.monthly_revenue)} → 每月少收 ${usd(loss)}`,
            `Falling short of the rating bar priced as 0.5 fewer turns a day: base monthly revenue ${usd(base.monthly_revenue)} → ${usd(loss)} less each month`,
          )
        : unquantified('缺少翻台敏感度测算，算不出评分不达标的金额', 'Without the turns-sensitivity run the cost of missing the rating bar cannot be derived')),
      trigger: '开业 90 天 Google 评分 < 4.2',
      hedge: '试营业期打磨出品与服务，控制首批评论',
    });
  }
  if (d.coverage_ratio != null && d.coverage_ratio < 1) {
    const p = (d.coverage_ratio * 100).toFixed(0);
    const gap = f.breakeven_monthly != null && captured != null ? f.breakeven_monthly - captured : null;
    push({
      risk_zh: f.rent_excluded ? `捕获需求仅覆盖保本线（不含租金）${p}%` : `捕获需求仅覆盖保本线 ${p}%`,
      risk_en: f.rent_excluded ? `Captured demand covers only ${p}% of break-even (excluding rent)` : `Captured demand covers only ${p}% of break-even`,
      prob: d.coverage_ratio < 0.8 ? 'high' : 'medium',
      ...(gap != null && f.breakeven_monthly != null && captured != null
        ? quantified(
            gap,
            `保本线 ${usd(f.breakeven_monthly)} − 捕获月需求 ${usd(captured)} = 每月差 ${usd(gap)}`,
            `Break-even ${usd(f.breakeven_monthly)} − captured monthly demand ${usd(captured)} = ${usd(gap)} short each month`,
          )
        : unquantified('缺少保本线或捕获月需求，算不出缺口金额', 'Without the break-even line or the captured monthly demand the shortfall cannot be derived')),
      trigger: '开业 6 个月月营收 < 保本线',
      hedge: '压缩座位 / 面积以降低固定成本；先做外卖验证需求',
    });
  }
  if (m.trade_area.isochrone_method === 'radius') {
    push({
      risk_zh: '商圈为直线半径近似（等时圈未获取），人口与需求可能高估',
      risk_en: 'Trade area uses straight-line radii (isochrones unavailable); demand may be overstated',
      prob: 'medium',
      ...unquantified(
        '等时圈未获取，没有第二套边界可以对比，高估了多少无法算出',
        'No isochrone boundary was retrieved, so there is no second boundary to compare against and the overstatement cannot be sized',
      ),
      trigger: '—',
      hedge: '正式签约前用等时圈复核',
    });
  }
  if ((m.dev_projects ?? 0) > 0) {
    push({
      risk_zh: `周边有 ${m.dev_projects} 个在建 / 已批项目：施工期客流受影响，交付后需求上行（未计入当前需求）`,
      risk_en: `${m.dev_projects} nearby projects under construction / approved: construction-period disruption, upside on delivery (excluded from current demand)`,
      prob: 'medium',
      ...unquantified(
        '施工的工期与围挡范围未获取，客流影响的幅度算不出来',
        'Neither the construction schedule nor the hoarding footprint is available, so the size of the traffic disruption cannot be derived',
      ),
      trigger: '施工围挡影响门面 / 停车',
      hedge: '租约加入施工期租金减免条款',
    });
  }
  if (m.input.capex_usd == null) {
    push({
      risk_zh: '未提供 CapEx：回收期无法评估',
      risk_en: 'CapEx not provided: payback cannot be assessed',
      prob: 'medium',
      ...unquantified('未提供装修与设备投入，回收期和投入金额都算不出来', 'No build-out or equipment budget was provided, so neither the payback nor the amount at stake can be derived'),
      trigger: '—',
      hedge: '取得装修 / 设备报价后重跑报告',
    });
  }
  return risks;
}
