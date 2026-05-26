import { NextResponse } from 'next/server';
import { iqGetReport } from '@/lib/funnel/iq-repository';
import { buildCompetitorMapPins, buildGoogleStaticMapUrl } from '@/lib/funnel/iq-competitor-map';
import {
  decisionTierDisplay,
  layerLabel,
  normalizeRiskAuditFromFull,
  numScore,
  parseDecisionTier,
} from '@/lib/funnel/iq-risk-audit-model';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PDF_VIEWPORT = { width: 1200, height: 1600 };

/**
 * D-2: cold-start font cache.
 *
 * @sparticuz/chromium v143 only bundles Open Sans (Latin). Without a CJK font,
 * zh PDFs render as tofu boxes. We fetch a tiny Noto Sans SC subset from the
 * @fontsource CDN once per Lambda cold-start, base64-encode it, and inline it
 * into the HTML as a data URI. Subsequent invocations on the same hot Lambda
 * reuse the in-memory cache, so Puppeteer never makes a network call mid-render
 * (which is what caused the previous flakes with @import url(...)).
 *
 * If the fetch fails we still try to render — the route is best-effort.
 */
let cjkFontDataUri: string | null = null;
let cjkFontFetchPromise: Promise<string | null> | null = null;
const CJK_FONT_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-400-normal.woff2';

async function loadCjkFontDataUri(): Promise<string | null> {
  if (cjkFontDataUri) return cjkFontDataUri;
  if (cjkFontFetchPromise) return cjkFontFetchPromise;
  cjkFontFetchPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8_000);
      const res = await fetch(CJK_FONT_URL, { signal: ctrl.signal, cache: 'force-cache' });
      clearTimeout(timer);
      if (!res.ok) {
        console.warn(`[api/iq/report/pdf] CJK font HTTP ${res.status}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const dataUri = `data:font/woff2;base64,${buf.toString('base64')}`;
      cjkFontDataUri = dataUri;
      console.log(`[api/iq/report/pdf] CJK font cached, bytes=${buf.length}`);
      return dataUri;
    } catch (err) {
      console.warn('[api/iq/report/pdf] CJK font fetch failed (non-fatal):', err);
      return null;
    } finally {
      cjkFontFetchPromise = null;
    }
  })();
  return cjkFontFetchPromise;
}

function isVercelServerless(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.VERCEL === 'true' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

/**
 * Vercel: always @sparticuz/chromium. Local: PUPPETEER_EXECUTABLE_PATH / CHROME_PATH, then bundled chromium, then common Chrome paths.
 */
async function launchPdfBrowser(): Promise<Browser> {
  if (isVercelServerless()) {
    // D-2: drop the graphics stack (no GPU on Lambda). This also avoids
    // extracting swiftshader.tar.br at runtime, shaving ~15MB off cold-start.
    try {
      (chromium as unknown as { setGraphicsMode: boolean }).setGraphicsMode = false;
    } catch {
      /* older versions ignore */
    }
    const args = [
      ...chromium.args,
      '--font-render-hinting=none',
      '--disable-font-subpixel-positioning',
    ];
    return puppeteer.launch({
      args,
      defaultViewport: PDF_VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const envPath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || process.env.CHROME_PATH?.trim();
  if (envPath) {
    return puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: PDF_VIEWPORT,
      executablePath: envPath,
      headless: true,
    });
  }

  try {
    return await puppeteer.launch({
      args: chromium.args,
      defaultViewport: PDF_VIEWPORT,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  } catch (e) {
    console.warn('[api/iq/report/pdf] @sparticuz/chromium launch failed, trying system Chrome:', e);
    const sys =
      process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : process.platform === 'win32'
          ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
          : '/usr/bin/google-chrome-stable';
    return puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: PDF_VIEWPORT,
      executablePath: sys,
      headless: true,
    });
  }
}

type FullShape = Record<string, unknown>;
type Lang = 'en' | 'zh';

function pickStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function pickStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Preserve paragraphs for long prose fields (executive summary, etc.). */
function proseToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n\n+/)
    .map((para) => {
      const esc = escapeHtml(para).replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 12px;line-height:1.55;color:#374151;">${esc}</p>`;
    })
    .join('');
}

function labels(lang: Lang) {
  if (lang === 'zh') {
    return {
      subtitle: '选址智能分析报告',
      keyMetrics: '关键指标',
      executiveSummary: '执行摘要',
      finalVerdict: '最终判定',
      tradeArea: '贸易区与客流',
      demographic: '人口与消费力',
      competition: '竞争格局',
      revenueEstimate: '营收预估',
      revenueModel: '营收模型与情景',
      competitorMatrix: '竞争对手矩阵',
      riskMatrix: '风险矩阵',
      topRisks: '主要风险',
      opportunities: '发展机会',
      failureScenarios: '失败场景',
      differentiation: '差异化策略',
      actionPlan: '90 天行动计划',
      actionStructured: '结构化路线图',
      decisionMatrix: '加权决策矩阵',
      comparables: '可比案例',
      acquisition: '获客渠道',
      dataSources: '数据来源与免责声明',
      siteAccess: '物业与路况评估',
      evidencePoints: '关键证据点',
      alternativeCorridors: '备选商业走廊与在租线索',
      listingAddr: '地址/房源',
      listingSqft: '面积',
      listingRent: '月租(USD)',
      listingNotes: '亮点',
      listingSource: '来源',
      confidential: '保密文件 — 本报告仅供购买方使用，未经许可不得传播。',
      generatedBy: '由 RestaurantIQ.ai 生成',
      confidence: '置信度',
      scenario: '情景',
      monthlyRev: '月营收 (USD)',
      assumptions: '关键假设',
      name: '名称',
      mi: '距离(mi)',
      cat: '类别',
      star: '评分',
      threat: '威胁',
      risk: '风险',
      prob: '概率',
      impact: '财务影响',
      mit: '缓解措施',
      dim: '维度',
      score: '得分',
      wt: '权重%',
      wtd: '加权分',
      task: '任务',
      owner: '负责人',
      budget: '预算档',
      deliverable: '交付物',
      metric: '成功指标',
      time: '时间',
      success: '成功案例',
      failure: '失败案例',
      channel: '渠道',
      pri: '优先级',
      rationale: '理由',
      riskAudit: '选址风险审计',
      oneLineConclusion: '一句话结论',
      breakEven: '打平月营收',
      safeRevenue: '安全月营收',
      leaseChecklist: '签租前清单',
      playbook: '打法建议',
      competitorMap: '竞品分布',
      competitorInsights: '竞品深度洞察',
      dataConfidence: '数据置信度',
      layer: '维度',
    };
  }
  return {
    subtitle: 'Location Intelligence Report',
    keyMetrics: 'Key metrics',
    executiveSummary: 'Executive Summary',
    finalVerdict: 'Final Verdict',
    tradeArea: 'Trade Area Analysis',
    demographic: 'Demographic Profile',
    competition: 'Competition Landscape',
    revenueEstimate: 'Revenue outlook',
    revenueModel: 'Revenue model & scenarios',
    competitorMatrix: 'Competitor matrix',
    riskMatrix: 'Risk matrix',
    topRisks: 'Top risks',
    opportunities: 'Opportunities',
    failureScenarios: 'Failure scenarios',
    differentiation: 'Differentiation strategy',
    actionPlan: '90-day action plan',
    actionStructured: 'Structured roadmap',
    decisionMatrix: 'Weighted decision matrix',
    comparables: 'Comparable cases',
    acquisition: 'Acquisition channels',
    dataSources: 'Data sources & disclaimer',
    siteAccess: 'Site & road context',
    evidencePoints: 'Key evidence',
    alternativeCorridors: 'Alternative corridors & listings',
    listingAddr: 'Address',
    listingSqft: 'sqft',
    listingRent: 'Rent/mo',
    listingNotes: 'Notes',
    listingSource: 'Source',
    confidential:
      'CONFIDENTIAL — This report is prepared exclusively for the purchaser and must not be distributed without permission.',
    generatedBy: 'Generated by RestaurantIQ.ai',
    confidence: 'Confidence',
    scenario: 'Scenario',
    monthlyRev: 'Monthly revenue (USD)',
    assumptions: 'Key assumptions',
    name: 'Name',
    mi: 'mi',
    cat: 'Category',
    star: 'Rating',
    threat: 'Threat',
    risk: 'Risk',
    prob: 'P',
    impact: 'Impact',
    mit: 'Mitigation',
    dim: 'Dimension',
    score: '/100',
    wt: 'Wt %',
    wtd: 'Weighted',
    task: 'Task',
    owner: 'Owner',
    budget: 'Budget',
    deliverable: 'Deliverable',
    metric: 'Metric',
    time: 'Timeframe',
    success: 'Success cases',
    failure: 'Failure cases',
    channel: 'Channel',
    pri: 'Pri.',
    rationale: 'Rationale',
    riskAudit: 'Location risk audit',
    oneLineConclusion: 'One-line conclusion',
    breakEven: 'Break-even revenue / mo',
    safeRevenue: 'Safe revenue / mo',
    leaseChecklist: 'Pre-lease checklist',
    playbook: 'Playbook',
    competitorMap: 'Competitor map',
    competitorInsights: 'Competitor deep insights',
    dataConfidence: 'Data confidence',
    layer: 'Layer',
  };
}

function pdfRiskAuditBlock(
  full: FullShape,
  lang: Lang,
  marketData: Record<string, unknown> | null,
): string {
  const L = labels(lang);
  const audit = normalizeRiskAuditFromFull(full);
  if (!audit) return '';

  const tier = parseDecisionTier(audit.decision_tier ?? full.decision_tier);
  const tierCopy = decisionTierDisplay(tier, lang);
  const overall = numScore(audit.overall_score);
  const breakEven = numScore(audit.break_even_revenue_monthly_usd);
  const safeRev = numScore(audit.safe_revenue_monthly_usd);
  const conf = numScore(audit.data_confidence_pct);

  const layers = (audit.layers ?? []).slice(0, 6);
  const layerRows = layers
    .map((row) => {
      const sc = numScore(row.score);
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(layerLabel(String(row.id), lang))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;text-align:center;">${sc ?? '—'}</td>
      </tr>`;
    })
    .join('');

  const topRisks = (audit.top_risks ?? pickStrArr(full.risks)).slice(0, 5);
  const playbook = (audit.playbook ?? []).slice(0, 5);
  const checklist = (audit.lease_checklist ?? []).slice(0, 12);

  const mapPins = buildCompetitorMapPins({
    marketData,
    reportCompetitors: Array.isArray(full.competitors) ? full.competitors : [],
  });
  const mapUrl =
    mapPins.center && mapPins.pins.length > 0
      ? buildGoogleStaticMapUrl({ center: mapPins.center, pins: mapPins.pins, width: 600, height: 280 })
      : null;

  const costs = audit.cost_breakdown ?? [];
  const costRows = costs
    .map((c) => {
      const amt = numScore(c.amount_usd);
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(c.item)}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${amt != null ? `$${amt.toLocaleString()}` : '—'}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(c.note ?? '')}</td>
      </tr>`;
    })
    .join('');

  // D-4: deterministic finance-model evidence block in the PDF.
  const financeApplied = (full as Record<string, unknown>)._finance_model_applied === true;
  const financeSnapshot =
    (full as Record<string, unknown>)._finance_model_snapshot &&
    typeof (full as Record<string, unknown>)._finance_model_snapshot === 'object'
      ? ((full as Record<string, unknown>)._finance_model_snapshot as {
          confidence: 'high' | 'medium' | 'low';
          confidence_reasons: string[];
          avg_ticket_usd: number;
          break_even_daily_revenue_usd: number;
          safe_daily_revenue_usd: number;
          daily_covers_needed_breakeven: number;
          daily_covers_needed_safe: number;
          cuisine_archetype_label_en: string;
          cuisine_archetype_label_zh: string;
          assumptions: string[];
          citations: string[];
        })
      : null;
  const calcBadge = lang === 'zh' ? '公式计算' : 'Calculated';
  const calcBadgeHtml = financeApplied
    ? `<span style="display:inline-block;margin-left:6px;padding:1px 6px;font-size:8pt;background:#dcfce7;color:#166534;border-radius:8px;border:1px solid #86efac;">${escapeHtml(calcBadge)}</span>`
    : '';
  const dailyBreakHint = financeSnapshot && breakEven != null
    ? (lang === 'zh'
        ? `（约 $${financeSnapshot.break_even_daily_revenue_usd.toLocaleString()}/天 · ${financeSnapshot.daily_covers_needed_breakeven} 单@$${financeSnapshot.avg_ticket_usd}）`
        : `(~$${financeSnapshot.break_even_daily_revenue_usd.toLocaleString()}/day · ${financeSnapshot.daily_covers_needed_breakeven} covers @ $${financeSnapshot.avg_ticket_usd})`)
    : '';
  const dailySafeHint = financeSnapshot && safeRev != null
    ? (lang === 'zh'
        ? `（约 $${financeSnapshot.safe_daily_revenue_usd.toLocaleString()}/天 · ${financeSnapshot.daily_covers_needed_safe} 单@$${financeSnapshot.avg_ticket_usd}）`
        : `(~$${financeSnapshot.safe_daily_revenue_usd.toLocaleString()}/day · ${financeSnapshot.daily_covers_needed_safe} covers @ $${financeSnapshot.avg_ticket_usd})`)
    : '';

  const financeNoteHtml = financeApplied && financeSnapshot
    ? `<div style="margin:8px 0 14px;padding:10px 12px;border-left:3px solid #16a34a;background:#f0fdf4;font-size:9pt;color:#14532d;">
        <div style="font-weight:600;margin-bottom:4px;">
          ${escapeHtml(lang === 'zh' ? '盈亏平衡计算方法（D-4 确定性模型）' : 'How break-even was calculated (D-4 deterministic model)')}
          · ${escapeHtml(financeSnapshot.confidence === 'high' ? (lang === 'zh' ? '高置信度' : 'High confidence') : financeSnapshot.confidence === 'medium' ? (lang === 'zh' ? '中等置信度' : 'Medium confidence') : (lang === 'zh' ? '低置信度' : 'Low confidence'))}
        </div>
        <div style="margin-bottom:6px;font-size:8.5pt;">
          ${escapeHtml(lang === 'zh' ? '业态原型：' : 'Archetype: ')}${escapeHtml(lang === 'zh' ? financeSnapshot.cuisine_archetype_label_zh : financeSnapshot.cuisine_archetype_label_en)}
        </div>
        <ul style="margin:0 0 0 16px;padding:0;font-size:8.5pt;line-height:1.45;">
          ${financeSnapshot.assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>
        <div style="margin-top:6px;font-size:8pt;color:#15803d;">
          ${escapeHtml(lang === 'zh' ? '引用：' : 'Citations: ')}${escapeHtml(financeSnapshot.citations.join(' · '))}
        </div>
      </div>`
    : '';

  return `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.riskAudit)}</h2>
    ${tierCopy ? `<p style="font-weight:700;color:#1a365d;margin-bottom:8px;">${escapeHtml(tierCopy.label)} — ${escapeHtml(tierCopy.desc)}</p>` : ''}
    ${overall != null ? `<p style="margin-bottom:8px;"><strong>${lang === 'zh' ? '综合分' : 'Overall'}:</strong> ${overall}/100${conf != null ? ` · ${escapeHtml(L.dataConfidence)}: ${conf}%` : ''}</p>` : ''}
    ${audit.one_line_conclusion || pickStr(full.one_line_conclusion) ? `<p style="margin-bottom:12px;font-style:italic;">${escapeHtml(audit.one_line_conclusion || pickStr(full.one_line_conclusion) || '')}</p>` : ''}
    ${layerRows ? `<table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:14px;"><tr style="background:#1a365d;color:#fff;"><th style="padding:8px;text-align:left;">${escapeHtml(L.layer)}</th><th style="padding:8px;">${escapeHtml(L.score)}</th></tr>${layerRows}</table>` : ''}
    ${breakEven != null || safeRev != null ? `<p style="margin-bottom:10px;">${breakEven != null ? `<strong>${escapeHtml(L.breakEven)}:</strong> $${breakEven.toLocaleString()}${calcBadgeHtml} <span style="color:#92400e;font-size:8.5pt;">${dailyBreakHint}</span>` : ''}${safeRev != null ? `<br /><strong>${escapeHtml(L.safeRevenue)}:</strong> $${safeRev.toLocaleString()}${calcBadgeHtml} <span style="color:#15803d;font-size:8.5pt;">${dailySafeHint}</span>` : ''}</p>` : ''}
    ${financeNoteHtml}
    ${costRows ? `<table style="width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:14px;">${costRows}</table>` : ''}
    ${mapUrl ? `<div style="margin:14px 0;"><h3 style="font-size:10pt;margin-bottom:8px;">${escapeHtml(L.competitorMap)}</h3><img src="${escapeHtml(mapUrl)}" alt="map" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;" /></div>` : ''}
    ${audit.competitor_tiers_note ? `<p style="margin-bottom:12px;font-size:10pt;">${escapeHtml(audit.competitor_tiers_note)}</p>` : ''}
    ${topRisks.length ? `<h3 style="font-size:10pt;margin:12px 0 6px;">${escapeHtml(L.topRisks)}</h3><ul style="margin-left:18px;">${topRisks.map((r) => `<li style="margin-bottom:6px;">${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
    ${playbook.length ? `<h3 style="font-size:10pt;margin:12px 0 6px;">${escapeHtml(L.playbook)}</h3><ul style="margin-left:18px;">${playbook.map((r) => `<li style="margin-bottom:6px;">${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
    ${checklist.length ? `<h3 style="font-size:10pt;margin:12px 0 6px;">${escapeHtml(L.leaseChecklist)}</h3><ol style="margin-left:18px;">${checklist.map((r) => `<li style="margin-bottom:4px;">${escapeHtml(r)}</li>`).join('')}</ol>` : ''}
  </div>`;
}

function dashKeyLabel(key: string, lang: Lang): string {
  const zh: Record<string, string> = {
    overall_score: '综合分',
    foot_traffic_index: '客流指数',
    competition_intensity: '竞争强度',
    payback_months: '回收期(月)',
    recommendation: '建议等级',
  };
  const en: Record<string, string> = {
    overall_score: 'Overall score',
    foot_traffic_index: 'Foot traffic index',
    competition_intensity: 'Competition intensity',
    payback_months: 'Payback (mo)',
    recommendation: 'Recommendation',
  };
  const m = lang === 'zh' ? zh : en;
  return m[key] ?? key;
}

function pdfDashboardTable(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const d = full.dashboard;
  if (!d || typeof d !== 'object') return '';
  const obj = d as Record<string, unknown>;
  const keys = ['overall_score', 'foot_traffic_index', 'competition_intensity', 'payback_months', 'recommendation'];
  const cells = keys
    .map((k) => {
      const val = obj[k];
      if (val === undefined || val === null || val === '') return '';
      return `<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;color:#1a365d;background:#f8fafc;">${escapeHtml(dashKeyLabel(k, lang))}</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(String(val))}</td></tr>`;
    })
    .join('');
  if (!cells) return '';
  return `<div class="section"><h2>${escapeHtml(L.keyMetrics)}</h2><table style="width:100%;border-collapse:collapse;font-size:10pt;">${cells}</table></div>`;
}

type CompetitorInsightsForPdf = {
  provider: string;
  model: string;
  reviews_fetched: {
    google_competitors: number;
    yelp_competitors: number;
    total_review_excerpts: number;
  };
  per_competitor: Array<{
    name: string;
    rating: number | null;
    review_count: number | null;
    price_tier: string | null;
    positioning: string;
    signature_items: string[];
    top_complaints: string[];
    top_praise: string[];
    pricing_perception: string;
    threat_level: 'high' | 'medium' | 'low';
    ai_takeaway_zh: string;
    ai_takeaway_en: string;
  }>;
  cluster_summary_zh: string;
  cluster_summary_en: string;
  gaps_and_openings_zh: string;
  gaps_and_openings_en: string;
};

function pdfCompetitorInsightsBlock(
  marketData: Record<string, unknown> | null | undefined,
  lang: Lang,
): string {
  const ci = (marketData?.competitor_insights as CompetitorInsightsForPdf | undefined) ?? undefined;
  if (!ci || !Array.isArray(ci.per_competitor) || ci.per_competitor.length === 0) return '';
  const L = labels(lang);
  const isZh = lang === 'zh';

  const intro = isZh
    ? `<p style="margin:4px 0 12px;font-size:9pt;color:#475569;">${escapeHtml(`AI 评论分析 · 基于 ${ci.reviews_fetched.total_review_excerpts} 条 Google + Yelp 评论摘要`)}</p>`
    : `<p style="margin:4px 0 12px;font-size:9pt;color:#475569;">${escapeHtml(`AI review analysis · grounded in ${ci.reviews_fetched.total_review_excerpts} Google + Yelp review excerpts`)}</p>`;

  const rowHtml = ci.per_competitor
    .map((row) => {
      const threatColor =
        row.threat_level === 'high'
          ? { border: '#fda4af', bg: '#fff1f2', text: '#9f1239' }
          : row.threat_level === 'low'
            ? { border: '#86efac', bg: '#f0fdf4', text: '#166534' }
            : { border: '#fcd34d', bg: '#fffbeb', text: '#92400e' };
      const threatLabel = isZh
        ? row.threat_level === 'high'
          ? '高威胁'
          : row.threat_level === 'low'
            ? '低威胁'
            : '中等威胁'
        : row.threat_level.toUpperCase();
      const meta = [
        row.rating != null ? `${row.rating}/5` : null,
        row.review_count != null
          ? `${row.review_count.toLocaleString(isZh ? 'zh-CN' : 'en-US')} ${isZh ? '条评论' : 'reviews'}`
          : null,
        row.price_tier ?? null,
      ]
        .filter(Boolean)
        .join(' · ');
      const items = row.signature_items
        .slice(0, 5)
        .map(
          (it) =>
            `<span style="display:inline-block;margin:2px 4px 0 0;padding:1px 6px;background:#e2e8f0;color:#1e293b;border-radius:6px;font-size:8pt;">${escapeHtml(it)}</span>`,
        )
        .join('');
      const praise = row.top_praise.length
        ? `<div style="margin-top:4px;font-size:8.5pt;color:#15803d;"><strong>${escapeHtml(isZh ? '高频好评：' : 'Top praise: ')}</strong>${escapeHtml(row.top_praise.join(' · '))}</div>`
        : '';
      const complaints = row.top_complaints.length
        ? `<div style="margin-top:2px;font-size:8.5pt;color:#9f1239;"><strong>${escapeHtml(isZh ? '高频差评：' : 'Top complaints: ')}</strong>${escapeHtml(row.top_complaints.join(' · '))}</div>`
        : '';
      const pricing = row.pricing_perception
        ? `<div style="margin-top:2px;font-size:8.5pt;color:#475569;"><strong>${escapeHtml(isZh ? '价格感知：' : 'Pricing: ')}</strong>${escapeHtml(row.pricing_perception)}</div>`
        : '';
      const takeaway = isZh ? row.ai_takeaway_zh : row.ai_takeaway_en;
      const takeawayHtml = takeaway
        ? `<div style="margin-top:6px;padding:6px 8px;background:#fffbeb;border-left:3px solid #f59e0b;font-size:8.5pt;color:#78350f;">${escapeHtml(takeaway)}</div>`
        : '';
      const positioning = row.positioning
        ? `<div style="margin-top:6px;font-size:9pt;color:#334155;line-height:1.45;">${escapeHtml(row.positioning)}</div>`
        : '';
      return `<div style="margin-bottom:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fafafa;page-break-inside:avoid;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;color:#0f172a;font-size:10pt;">${escapeHtml(row.name)}</div>
            <div style="font-size:8.5pt;color:#64748b;margin-top:2px;">${escapeHtml(meta)}</div>
          </div>
          <span style="flex-shrink:0;padding:1px 6px;font-size:8pt;border:1px solid ${threatColor.border};background:${threatColor.bg};color:${threatColor.text};border-radius:8px;font-weight:600;">${escapeHtml(threatLabel)}</span>
        </div>
        ${positioning}
        ${items ? `<div style="margin-top:6px;"><div style="font-size:7.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(isZh ? '代表产品' : 'Signature items')}</div><div style="margin-top:3px;">${items}</div></div>` : ''}
        ${praise}
        ${complaints}
        ${pricing}
        ${takeawayHtml}
      </div>`;
    })
    .join('');

  const cluster = isZh ? ci.cluster_summary_zh : ci.cluster_summary_en;
  const clusterHtml = cluster
    ? `<div style="margin-top:8px;padding:10px 12px;background:#f1f5f9;border-left:3px solid #475569;font-size:9pt;color:#1e293b;line-height:1.5;"><div style="font-size:7.5pt;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${escapeHtml(isZh ? '竞品集群总结' : 'Cluster summary')}</div>${escapeHtml(cluster)}</div>`
    : '';

  const gaps = isZh ? ci.gaps_and_openings_zh : ci.gaps_and_openings_en;
  const gapsHtml = gaps
    ? `<div style="margin-top:8px;padding:10px 12px;background:#f0fdf4;border-left:3px solid #16a34a;font-size:9pt;color:#14532d;line-height:1.5;"><div style="font-size:7.5pt;color:#15803d;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">${escapeHtml(isZh ? '可切入的市场缺口' : 'Gaps & openings')}</div>${escapeHtml(gaps)}</div>`
    : '';

  const footer = `<div style="margin-top:10px;font-size:7.5pt;color:#94a3b8;">${escapeHtml(
    isZh
      ? `由 ${ci.provider} (${ci.model}) 基于 Google Place Details + Yelp Fusion 评论摘要生成`
      : `Generated by ${ci.provider} (${ci.model}) from Google Place Details + Yelp Fusion review excerpts`,
  )}</div>`;

  return `<div class="section"><h2><span class="head-mark">■</span> ${escapeHtml(L.competitorInsights)}</h2>${intro}${rowHtml}${clusterHtml}${gapsHtml}${footer}</div>`;
}

function pdfCompetitorsTable(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rows = Array.isArray(full.competitors) ? full.competitors : [];
  if (rows.length === 0) return '';
  const head = `<tr style="background:#1a365d;color:#fff;"><th style="text-align:left;padding:8px;">#</th><th style="text-align:left;padding:8px;">${escapeHtml(L.name)}</th><th style="padding:8px;">${escapeHtml(L.mi)}</th><th style="padding:8px;">${escapeHtml(L.cat)}</th><th style="padding:8px;">${escapeHtml(L.star)}</th><th style="padding:8px;">${escapeHtml(L.threat)}</th></tr>`;
  const body = rows
    .map((row, i) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${i + 1}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.name ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.distance_mi ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.category ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.rating ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.threat_level ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>${escapeHtml(L.competitorMatrix)}</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function pdfRiskMatrixTable(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rows = Array.isArray(full.risk_matrix) ? full.risk_matrix : [];
  if (rows.length === 0) return '';
  const head = `<tr style="background:#1a365d;color:#fff;"><th style="text-align:left;padding:8px;">${escapeHtml(L.risk)}</th><th style="padding:8px;">${escapeHtml(L.prob)}</th><th style="padding:8px;">${escapeHtml(L.impact)}</th><th style="padding:8px;">${escapeHtml(L.mit)}</th></tr>`;
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.risk ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.probability ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.financial_impact ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.mitigation ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>${escapeHtml(L.riskMatrix)}</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function pdfRevenueModel(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rm = full.revenue_model;
  if (!rm || typeof rm !== 'object') return '';
  const o = rm as Record<string, unknown>;
  const methodology = pickStr(o.methodology);
  const scenarios = Array.isArray(o.scenarios) ? o.scenarios : [];
  const sensitivity = Array.isArray(o.sensitivity) ? o.sensitivity.map(String) : [];
  const breakeven = pickStr(o.breakeven);
  const costs = pickStr(o.monthly_costs_note);
  if (!methodology && scenarios.length === 0 && !breakeven) return '';

  let scenRows = '';
  if (scenarios.length > 0) {
    const h = `<tr style="background:#1a365d;color:#fff;"><th style="text-align:left;padding:8px;">${escapeHtml(L.scenario)}</th><th style="padding:8px;">${escapeHtml(L.monthlyRev)}</th><th style="text-align:left;padding:8px;">${escapeHtml(L.assumptions)}</th></tr>`;
    scenRows = scenarios
      .map((s) => {
        const r = s as Record<string, unknown>;
        return `<tr>
          <td style="padding:6px;border:1px solid #e2e8f0;font-weight:600;">${escapeHtml(String(r.name ?? ''))}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.monthly_revenue_usd ?? ''))}</td>
          <td style="padding:6px;border:1px solid #e2e8f0;font-size:9pt;">${escapeHtml(String(r.key_assumptions ?? ''))}</td>
        </tr>`;
      })
      .join('');
    scenRows = `<table style="width:100%;border-collapse:collapse;font-size:9pt;margin-top:12px;">${h}${scenRows}</table>`;
  }

  const sensHtml =
    sensitivity.length > 0
      ? `<ul style="margin:12px 0;padding-left:20px;color:#374151;">${sensitivity.map((x) => `<li style="margin-bottom:6px;">${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

  return `<div class="section"><h2>${escapeHtml(L.revenueModel)}</h2>
    ${methodology ? `<div class="prose">${proseToHtml(methodology)}</div>` : ''}
    ${scenRows}
    ${sensHtml}
    ${breakeven ? `<p style="margin-top:12px;"><strong>${lang === 'zh' ? '盈亏平衡' : 'Breakeven'}:</strong> ${escapeHtml(breakeven)}</p>` : ''}
    ${costs ? `<p style="margin-top:8px;font-size:10pt;color:#64748b;">${escapeHtml(costs)}</p>` : ''}
  </div>`;
}

function pdfDecisionMatrix(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rows = Array.isArray(full.decision_matrix) ? full.decision_matrix : [];
  if (rows.length === 0) return '';
  const head = `<tr style="background:#1a365d;color:#fff;"><th style="text-align:left;padding:8px;">${escapeHtml(L.dim)}</th><th style="padding:8px;">${escapeHtml(L.score)}</th><th style="padding:8px;">${escapeHtml(L.wt)}</th><th style="padding:8px;">${escapeHtml(L.wtd)}</th></tr>`;
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.dimension ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.score_100 ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.weight_pct ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.weighted_score ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>${escapeHtml(L.decisionMatrix)}</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function pdfActionStructured(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rows = Array.isArray(full.action_plan_structured) ? full.action_plan_structured : [];
  if (rows.length === 0) return '';
  const head = `<tr style="background:#1a365d;color:#fff;">
    <th style="text-align:left;padding:6px;">${escapeHtml(L.task)}</th>
    <th style="padding:6px;">${escapeHtml(L.owner)}</th>
    <th style="padding:6px;">${escapeHtml(L.budget)}</th>
    <th style="padding:6px;">${escapeHtml(L.deliverable)}</th>
    <th style="padding:6px;">${escapeHtml(L.metric)}</th>
    <th style="padding:6px;">${escapeHtml(L.time)}</th>
  </tr>`;
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.task ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.owner ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.budget_band ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.deliverable ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.success_metric ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.timeframe ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>${escapeHtml(L.actionStructured)}</h2><table style="width:100%;border-collapse:collapse;font-size:8pt;">${head}${body}</table></div>`;
}

function pdfAcquisitionTable(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const rows = Array.isArray(full.acquisition_channels) ? full.acquisition_channels : [];
  if (rows.length === 0) return '';
  const head = `<tr style="background:#1a365d;color:#fff;"><th style="text-align:left;padding:8px;">${escapeHtml(L.channel)}</th><th style="padding:8px;">${escapeHtml(L.pri)}</th><th style="text-align:left;padding:8px;">${escapeHtml(L.rationale)}</th></tr>`;
  const body = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      return `<tr>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.channel ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;">${escapeHtml(String(r.priority ?? ''))}</td>
        <td style="padding:6px;border:1px solid #e2e8f0;font-size:9pt;">${escapeHtml(String(r.rationale ?? ''))}</td>
      </tr>`;
    })
    .join('');
  return `<div class="section"><h2>${escapeHtml(L.acquisition)}</h2><table style="width:100%;border-collapse:collapse;font-size:9pt;">${head}${body}</table></div>`;
}

function pdfComparablesBlock(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const c = full.comparables;
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown>;
  const succ = pickStrArr(o.success_cases);
  const fail = pickStrArr(o.failure_cases);
  if (succ.length === 0 && fail.length === 0) return '';
  const succHtml =
    succ.length > 0
      ? `<div class="column-box" style="margin-bottom:16px;"><h3 style="color:#1a365d;">${escapeHtml(L.success)}</h3><ul>${succ.map((s) => `<li style="margin-bottom:8px;">${escapeHtml(s)}</li>`).join('')}</ul></div>`
      : '';
  const failHtml =
    fail.length > 0
      ? `<div class="column-box"><h3 style="color:#1a365d;">${escapeHtml(L.failure)}</h3><ul>${fail.map((s) => `<li style="margin-bottom:8px;">${escapeHtml(s)}</li>`).join('')}</ul></div>`
      : '';
  return `<div class="section"><h2>${escapeHtml(L.comparables)}</h2>${succHtml}${failHtml}</div>`;
}

function pdfSiteAccess(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const t = pickStr(full.site_and_access_assessment);
  if (!t) return '';
  return `<div class="section"><h2><span class="head-mark">■</span> ${escapeHtml(L.siteAccess)}</h2><div class="prose">${proseToHtml(t)}</div></div>`;
}

function pdfKeyEvidencePoints(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const pts = pickStrArr(full.key_evidence_points).filter((s) => s.trim().length > 0);
  if (!pts.length) return '';
  const items = pts
    .map(
      (r, i) => `
      <div class="list-item">
        <div class="list-number">${i + 1}</div>
        <div class="list-content">${escapeHtml(r)}</div>
      </div>`,
    )
    .join('');
  return `<div class="section"><h2><span class="head-mark">■</span> ${escapeHtml(L.evidencePoints)}</h2><div class="list">${items}</div></div>`;
}

function pdfAlternativeCorridors(full: FullShape, lang: Lang): string {
  const L = labels(lang);
  const corridors = Array.isArray(full.alternative_corridors) ? full.alternative_corridors : [];
  if (!corridors.length) return '';
  const blocks = corridors
    .map((cor) => {
      const c = cor as Record<string, unknown>;
      const name = escapeHtml(pickStr(c.corridor_name) ?? '—');
      const rationale = pickStr(c.rationale);
      const listings = Array.isArray(c.listings) ? c.listings : [];
      let tableHtml = '';
      if (listings.length) {
        const head = `<tr style="background:#1a365d;color:#fff;">
        <th style="text-align:left;padding:6px;">${escapeHtml(L.listingAddr)}</th>
        <th style="padding:6px;">${escapeHtml(L.listingSqft)}</th>
        <th style="padding:6px;">${escapeHtml(L.listingRent)}</th>
        <th style="text-align:left;padding:6px;">${escapeHtml(L.listingNotes)}</th>
        <th style="padding:6px;">${escapeHtml(L.listingSource)}</th>
      </tr>`;
        const body = listings
          .map((row) => {
            const r = row as Record<string, unknown>;
            return `<tr>
            <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.address_or_listing ?? '—'))}</td>
            <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${r.sqft != null ? escapeHtml(String(r.sqft)) : '—'}</td>
            <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${r.monthly_rent_usd != null ? escapeHtml(String(r.monthly_rent_usd)) : '—'}</td>
            <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.highlights ?? '—'))}</td>
            <td style="padding:6px;border:1px solid #e2e8f0;font-size:8pt;">${escapeHtml(String(r.source_tag ?? '—'))}</td>
          </tr>`;
          })
          .join('');
        tableHtml = `<table style="width:100%;border-collapse:collapse;font-size:8pt;margin-top:8px;">${head}${body}</table>`;
      }
      return `<div style="margin-bottom:16px;padding:12px;border:1px solid #e2e8f0;border-radius:4px;">
      <h4 style="margin:0 0 8px;color:#1a365d;">${name}</h4>
      ${rationale ? `<div class="prose">${proseToHtml(rationale)}</div>` : ''}
      ${tableHtml}
    </div>`;
    })
    .join('');
  return `<div class="section"><h2><span class="head-mark">■</span> ${escapeHtml(L.alternativeCorridors)}</h2>${blocks}</div>`;
}

function generatePdfHtml(input: {
  location: string;
  business_type: string | null;
  headline: string;
  full: FullShape;
  lang: Lang;
  marketData?: Record<string, unknown> | null;
  cjkFontDataUri?: string | null;
}): string {
  const { location, business_type, headline, full, lang, marketData = null, cjkFontDataUri: cjkUri = null } = input;
  const L = labels(lang);
  const dateStr =
    lang === 'zh'
      ? new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const title = pickStr(full.report_title) || headline;

  const cjkFontFace = cjkUri
    ? `@font-face {
        font-family: 'Noto Sans SC';
        font-weight: 400 700;
        font-style: normal;
        font-display: block;
        src: url('${cjkUri}') format('woff2');
      }`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    /* D-2: no remote @import here. CJK is injected as base64 data URI above
       (see generatePdfHtml -> cjkFontDataUri) so Puppeteer never makes a
       network call during setContent. */
    ${cjkFontFace}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans SC', 'Open Sans', 'PingFang SC', 'Microsoft YaHei', 'Inter', -apple-system, BlinkMacSystemFont, 'Liberation Sans', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.55;
      color: #1e293b;
      padding: 48px 56px;
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #d69e2e;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .logo {
      font-size: 22pt;
      font-weight: 700;
      color: #1a365d;
      letter-spacing: -0.5px;
    }
    .gold-rule {
      height: 4px;
      width: 120px;
      background: #d69e2e;
      margin: 12px auto 0;
      border-radius: 2px;
    }
    .subtitle {
      font-size: 10pt;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 2px;
      margin-top: 12px;
    }
    .report-title {
      font-size: 18pt;
      font-weight: 700;
      margin: 24px 0 12px;
      color: #1a365d;
      line-height: 1.3;
    }
    .meta { font-size: 10pt; color: #64748b; }
    .meta span { margin: 0 12px; }
    .executive-box {
      background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
      border-left: 4px solid #1a365d;
      padding: 20px 22px;
      margin: 24px 0;
      border-radius: 0 8px 8px 0;
    }
    .executive-box h2 {
      font-size: 11pt;
      font-weight: 700;
      color: #1a365d;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .verdict-box {
      background: #fffbeb;
      border: 2px solid #d69e2e;
      padding: 18px;
      margin: 20px 0;
      border-radius: 8px;
      text-align: center;
    }
    .verdict-box h3 {
      font-size: 13pt;
      font-weight: 700;
      color: #1a365d;
    }
    .section {
      margin: 26px 0;
      page-break-inside: avoid;
    }
    .section h2 {
      font-size: 12pt;
      font-weight: 700;
      color: #1a365d;
      border-bottom: 2px solid #d69e2e;
      padding-bottom: 6px;
      margin-bottom: 14px;
    }
    /* D-2: replace emoji glyphs (which Lambda has no font for) with a
       brand-gold square mark that any font can render. */
    .head-mark {
      display: inline-block;
      color: #d69e2e;
      font-size: 0.9em;
      margin-right: 6px;
      vertical-align: middle;
    }
    .column-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 16px;
      border-radius: 8px;
    }
    .column-box h3 {
      font-size: 10pt;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .two-column {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .revenue-box {
      background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
      border: 2px solid #d69e2e;
      padding: 18px;
      margin: 20px 0;
      border-radius: 8px;
    }
    .revenue-box h3 { font-size: 11pt; color: #92400e; margin-bottom: 8px; }
    .list { margin: 12px 0; }
    .list-item { display: flex; align-items: flex-start; margin-bottom: 10px; }
    .list-number {
      width: 22px; height: 22px;
      background: #1a365d;
      color: #fff;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 9pt; font-weight: 600;
      flex-shrink: 0; margin-right: 10px;
    }
    .list-number.risk { background: #b91c1c; }
    .list-number.warning { background: #c2410c; }
    .list-number.action { background: #1a365d; }
    .list-content { flex: 1; color: #374151; font-size: 10pt; }
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 9pt;
      color: #94a3b8;
    }
    .confidential {
      background: #fef2f2;
      border: 1px solid #fecaca;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 9pt;
      color: #991b1b;
      text-align: center;
      margin-top: 16px;
    }
    @page { margin: 0; size: A4; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">RestaurantIQ</div>
    <div class="gold-rule"></div>
    <div class="subtitle">${escapeHtml(L.subtitle)}</div>
    <h1 class="report-title">${escapeHtml(title)}</h1>
    <div class="meta">
      <span>${escapeHtml(location)}</span>
      ${business_type ? `<span>· ${escapeHtml(business_type)}</span>` : ''}
      <span>· ${escapeHtml(dateStr)}</span>
    </div>
  </div>

  ${pdfDashboardTable(full, lang)}
  ${pdfRiskAuditBlock(full, lang, marketData)}
  ${pdfCompetitorInsightsBlock(marketData, lang)}
  ${pdfCompetitorsTable(full, lang)}

  ${pickStr(full.one_line_conclusion) && !normalizeRiskAuditFromFull(full) ? `
  <div class="executive-box">
    <h2>${escapeHtml(L.oneLineConclusion)}</h2>
    <p style="line-height:1.55;">${escapeHtml(pickStr(full.one_line_conclusion)!)}</p>
  </div>` : ''}

  ${pickStr(full.executive_summary) ? `
  <div class="executive-box">
    <h2>${escapeHtml(L.executiveSummary)}</h2>
    <div class="prose">${proseToHtml(pickStr(full.executive_summary)!)}</div>
  </div>` : ''}

  ${pickStr(full.final_verdict) ? `
  <div class="verdict-box">
    <h3>${escapeHtml(L.finalVerdict)}</h3>
    <div style="margin-top:10px;text-align:left;" class="prose">${proseToHtml(pickStr(full.final_verdict)!)}</div>
  </div>` : ''}

  ${pdfSiteAccess(full, lang)}
  ${pdfKeyEvidencePoints(full, lang)}
  ${pdfAlternativeCorridors(full, lang)}

  <div class="two-column">
    ${pickStr(full.trade_area_analysis) ? `
    <div class="column-box">
      <h3><span class="head-mark">■</span> ${escapeHtml(L.tradeArea)}</h3>
      <div class="prose">${proseToHtml(pickStr(full.trade_area_analysis)!)}</div>
    </div>` : ''}
    ${(() => {
      const narr = (marketData && typeof marketData === 'object'
        ? (marketData as Record<string, unknown>).demographic_narrative
        : null) as { paragraph_zh?: string; paragraph_en?: string } | null;
      const claudePara =
        narr && typeof narr === 'object'
          ? lang === 'zh'
            ? (narr.paragraph_zh || '').trim()
            : (narr.paragraph_en || '').trim()
          : '';
      const hasLlm = !!pickStr(full.demographic_profile);
      if (!claudePara && !hasLlm) return '';
      const claudeBlock = claudePara
        ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;margin-bottom:12px;">
             <div style="font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#1d4ed8;margin-bottom:6px;">
               ${lang === 'zh' ? 'MCKINSEY 风格人口与消费力简报 · CLAUDE · ACS B03002/B19001/B15003' : 'McKinsey-style Demographics Brief · Claude · ACS B03002/B19001/B15003'}
             </div>
             ${proseToHtml(claudePara)}
           </div>`
        : '';
      const llmBlock = hasLlm ? `<div class="prose">${proseToHtml(pickStr(full.demographic_profile)!)}</div>` : '';
      return `<div class="column-box">
        <h3><span class="head-mark">■</span> ${escapeHtml(L.demographic)}</h3>
        ${claudeBlock}
        ${llmBlock}
      </div>`;
    })()}
  </div>

  ${pickStr(full.competition_landscape) ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.competition)}</h2>
    <div class="prose">${proseToHtml(pickStr(full.competition_landscape)!)}</div>
  </div>` : ''}

  ${pickStr(full.revenue_estimate) ? `
  <div class="revenue-box">
    <h3>${escapeHtml(L.revenueEstimate)}</h3>
    <div class="prose">${proseToHtml(pickStr(full.revenue_estimate)!)}</div>
  </div>` : ''}

  ${pdfRevenueModel(full, lang)}
  ${pdfRiskMatrixTable(full, lang)}

  ${pickStrArr(full.risks).length > 0 ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.topRisks)}</h2>
    <div class="list">
      ${pickStrArr(full.risks).map((r, i) => `
      <div class="list-item">
        <div class="list-number risk">${i + 1}</div>
        <div class="list-content">${escapeHtml(r)}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${pickStrArr(full.opportunities).length > 0 ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.opportunities)}</h2>
    <div class="list">
      ${pickStrArr(full.opportunities).map((o, i) => `
      <div class="list-item">
        <div class="list-number">${i + 1}</div>
        <div class="list-content">${escapeHtml(o)}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${pickStrArr(full.failure_scenarios).length > 0 ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.failureScenarios)}</h2>
    <div class="list">
      ${pickStrArr(full.failure_scenarios).map((f, i) => `
      <div class="list-item">
        <div class="list-number warning">${i + 1}</div>
        <div class="list-content">${escapeHtml(f)}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${pickStr(full.differentiation_strategy) ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.differentiation)}</h2>
    <div class="prose">${proseToHtml(pickStr(full.differentiation_strategy)!)}</div>
  </div>` : ''}

  ${pickStrArr(full.action_plan).length > 0 ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.actionPlan)}</h2>
    <div class="list">
      ${pickStrArr(full.action_plan).map((a, i) => `
      <div class="list-item">
        <div class="list-number action">${i + 1}</div>
        <div class="list-content">${escapeHtml(a)}</div>
      </div>`).join('')}
    </div>
  </div>` : ''}

  ${pdfActionStructured(full, lang)}
  ${pdfAcquisitionTable(full, lang)}
  ${pdfDecisionMatrix(full, lang)}
  ${pdfComparablesBlock(full, lang)}

  ${pickStr(full.data_sources_and_disclaimer) ? `
  <div class="section">
    <h2><span class="head-mark">■</span> ${escapeHtml(L.dataSources)}</h2>
    <div class="prose">${proseToHtml(pickStr(full.data_sources_and_disclaimer)!)}</div>
  </div>` : ''}

  <div class="footer">
    <p>${escapeHtml(L.generatedBy)} · ${escapeHtml(dateStr)}</p>
    <p>${escapeHtml(L.confidence)}: ${escapeHtml(pickStr(full.confidence) || '—')}</p>
  </div>

  <div class="confidential">${escapeHtml(L.confidential)}</div>
</body>
</html>`;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang: Lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  // Allow ?debug=1 to bypass auth gate locally and emit detailed error JSON.
  const debug = url.searchParams.get('debug') === '1' && process.env.NODE_ENV !== 'production';
  const t0 = Date.now();

  let browser: Browser | null = null;
  try {
    const report = await iqGetReport(id);
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (!report.paid && !debug) {
      return NextResponse.json({ error: 'Report not paid' }, { status: 403 });
    }

    const full = (report.full_report_json || {}) as FullShape;
    // Only fetch CJK font when language requires it; English PDFs use the
    // chromium-bundled Open Sans and stay fast.
    const cjkUri = lang === 'zh' ? await loadCjkFontDataUri() : null;
    const html = generatePdfHtml({
      location: report.location,
      business_type: report.business_type,
      headline: report.headline,
      full,
      lang,
      marketData: (report.market_data_json as Record<string, unknown> | null) ?? null,
      cjkFontDataUri: cjkUri,
    });

    console.log(
      `[api/iq/report/pdf] start id=${id} lang=${lang} html_bytes=${html.length} on=${
        isVercelServerless() ? 'vercel' : 'local'
      }`,
    );

    browser = await launchPdfBrowser();
    const page = await browser.newPage();
    // Static HTML: avoid networkidle0 (can hang); domcontentloaded is enough,
    // we don't have any remote fonts/scripts after the D-2 refactor.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait one paint cycle so layout settles before pdf() captures it.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
      preferCSSPageSize: false,
      timeout: 45_000,
    });

    const suffix = lang === 'zh' ? '-zh' : '';
    const filename = `RestaurantIQ-Report-${id.slice(0, 8)}${suffix}.pdf`;

    console.log(
      `[api/iq/report/pdf] done id=${id} bytes=${pdfBuffer.length} elapsed_ms=${Date.now() - t0}`,
    );

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[api/iq/report/pdf] FAIL', {
      id,
      lang,
      elapsed_ms: Date.now() - t0,
      message: msg,
      stack,
    });
    if (debug) {
      return NextResponse.json(
        { error: 'pdf_generation_failed', message: msg, stack, elapsed_ms: Date.now() - t0 },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to generate PDF', detail: msg.slice(0, 280) },
      { status: 500 },
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
