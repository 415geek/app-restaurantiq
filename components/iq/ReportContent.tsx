'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { rememberPaidReport } from '@/components/iq/SupportBubble';
import Link from 'next/link';
import { Report360Panel } from './Report360Panel';
import { ReportAccountBlock } from './ReportAccountBlock';
import { ReportMarkdown } from './ReportMarkdown';
import { RiskAuditReportSections } from './RiskAuditReportSections';
import { DataProvenance, ReportDataViz } from './ReportDataViz';
import { verifiedListings } from '@/lib/funnel/iq-corridor-listings';
import { normalizeConfidenceLevel } from '@/lib/funnel/iq-full-report-schema';
import { normalizeRiskAuditFromFull, productPositioningLine } from '@/lib/funnel/iq-risk-audit-model';
import { conclusionPendingNote, parseConclusion } from '@/lib/iq/conclusion/display';
import { LOCALES, LOCALE_LABEL, type Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';
import { persistLocale } from '@/lib/i18n/use-locale';

type FullReportView = Record<string, unknown>;

type Props = {
  report: {
    id: string;
    location: string;
    business_type: string | null;
    headline: string;
    user_id: string | null;
  };
  full: FullReportView;
  initialLang?: Locale;
  marketData?: Record<string, unknown> | null;
  staticMapUrl?: string | null;
  /** `report_model_json.sources` when the 360° model exists (data provenance rows). */
  modelSources?: unknown[] | null;
  /** `report_model_json.meta.data_as_of` when available. */
  dataAsOf?: string | null;
};

type Copy = {
  fullReport: string;
  printSubtitle: string;
  confidence: string;
  confidenceLevel: Record<'High' | 'Medium' | 'Low' | 'Unknown', string>;
  businessType: string;
  reportTitle: string;
  dashboard: string;
  executiveSummary: string;
  finalVerdict: string;
  tradeAreaAnalysis: string;
  demographicProfile: string;
  demographicBrief: string;
  competitionLandscape: string;
  competitorsTable: string;
  revenueEstimate: string;
  revenueModel: string;
  topRisks: string;
  opportunities: string;
  failureScenarios: string;
  differentiationStrategy: string;
  acquisition: string;
  actionPlan: string;
  actionPlanStructured: string;
  comparables: string;
  decisionMatrix: string;
  dataSources: string;
  siteAccess: string;
  evidencePoints: string;
  alternativeCorridors: string;
  generatedBy: string;
  reportId: string;
  analyzeAnother: string;
  contentNote: string;
  /** §4.1: the snapshot both surfaces print, and the date the data was frozen. */
  snapshotId: string;
  dataAsOfLabel: string;
  /** Name of a target language as this UI language calls it (for switch messages). */
  langName: Record<Locale, string>;
  generatingVersion: (name: string) => string;
  langSwitchError: (name: string) => string;
  langSwitchTimeout: (name: string) => string;
  upgrading: string;
  scenarioBasis: string;
  corridorTextOnly: string;
  overallScore: string;
  footTraffic: string;
  competition: string;
  payback: string;
  recommendation: string;
  riskAudit: string;
  auditTopRisks: string;
  playbook: string;
  leaseChecklist: string;
  costModel: string;
  breakEven: string;
  safeRevenue: string;
  competitorTiers: string;
  competitorMap: string;
  competitorInsights: string;
  // table / inline labels
  colAddress: string;
  colRent: string;
  colNotes: string;
  colSource: string;
  colName: string;
  colCategory: string;
  colReviews: string;
  colPrice: string;
  colThreat: string;
  colNote: string;
  scenario: (n: number) => string;
  perMonth: string;
  breakevenLine: string;
  costsLine: string;
  colRisk: string;
  colProb: string;
  colFinancial: string;
  colTrigger: string;
  colMitigation: string;
  colChannel: string;
  colWhy: string;
  owner: string;
  budget: string;
  time: string;
  deliverable: string;
  successCases: string;
  failureCases: string;
  colDimension: string;
  colWeighted: string;
};

const translations: Record<Locale, Copy> = {
  en: {
    fullReport: 'RestaurantIQ Premium Analysis',
    printSubtitle: 'Location Intelligence Report',
    confidence: 'confidence',
    confidenceLevel: { High: 'High', Medium: 'Medium', Low: 'Low', Unknown: 'Unknown' },
    businessType: 'Business type',
    reportTitle: 'Analysis title',
    dashboard: 'Key metrics',
    executiveSummary: 'Executive summary',
    finalVerdict: 'Final verdict',
    tradeAreaAnalysis: 'Trade area analysis',
    demographicProfile: 'Demographic profile',
    demographicBrief: 'McKinsey-style demographics brief',
    competitionLandscape: 'Competitive landscape',
    competitorsTable: 'Competitor matrix',
    revenueEstimate: 'Revenue outlook',
    revenueModel: 'Revenue model & scenarios',
    topRisks: 'Risk matrix',
    opportunities: 'Opportunities',
    failureScenarios: 'Failure scenarios',
    differentiationStrategy: 'Differentiation strategy',
    acquisition: 'Acquisition priorities',
    actionPlan: '90-day action plan',
    actionPlanStructured: 'Structured roadmap',
    comparables: 'Comparable cases',
    decisionMatrix: 'Weighted decision matrix',
    dataSources: 'Data sources & disclaimer',
    siteAccess: 'Site & road context',
    evidencePoints: 'Key evidence',
    alternativeCorridors: 'Alternative corridors & listings',
    generatedBy: 'Generated by RestaurantIQ.ai',
    reportId: 'Report ID',
    analyzeAnother: 'Analyze another location',
    contentNote: '',
    snapshotId: 'Conclusion snapshot',
    dataAsOfLabel: 'Data as of',
    langName: { en: 'English', zh: 'Chinese', es: 'Spanish' },
    generatingVersion: (n) => `Generating the ${n} version…`,
    langSwitchError: (n) => `Could not generate the ${n} version. Please try again in a moment.`,
    langSwitchTimeout: (n) => `The ${n} version timed out. Please try again.`,
    upgrading: 'You are viewing the standard edition. The in-depth edition will replace this automatically once it is ready — no action needed.',
    scenarioBasis: 'The three scenarios are seats × turns per day × average ticket; the 360° report models demand capture instead, so the two figures use different bases.',
    corridorTextOnly: 'No verified listing (LoopNet / Crexi) for this corridor — size and rent are not shown. Verify on site or with a broker.',
    overallScore: 'Overall',
    footTraffic: 'Foot traffic',
    competition: 'Competition',
    payback: 'Payback (mo)',
    recommendation: 'Recommendation',
    riskAudit: 'Location risk audit',
    auditTopRisks: 'Top 3 risks',
    playbook: 'Recommended playbook',
    leaseChecklist: 'Pre-lease checklist',
    costModel: 'Cost & break-even model',
    breakEven: 'Break-even revenue',
    safeRevenue: 'Safer target revenue',
    competitorTiers: 'Competitor tiers',
    competitorMap: 'Competitor map',
    competitorInsights: 'Competitor deep insights',
    colAddress: 'Address',
    colRent: 'Rent/mo',
    colNotes: 'Notes',
    colSource: 'Source',
    colName: 'Name',
    colCategory: 'Category',
    colReviews: 'Reviews',
    colPrice: '$',
    colThreat: 'Threat',
    colNote: 'Note',
    scenario: (n) => `Scenario ${n}`,
    perMonth: '/mo',
    breakevenLine: 'Break-even: ',
    costsLine: 'Costs: ',
    colRisk: 'Risk',
    colProb: 'Prob.',
    colFinancial: 'Financial',
    colTrigger: 'Trigger',
    colMitigation: 'Mitigation',
    colChannel: 'Channel',
    colWhy: 'Why',
    owner: 'Owner',
    budget: 'Budget',
    time: 'Time',
    deliverable: 'Deliverable',
    successCases: 'Success cases',
    failureCases: 'Failure / closure cases',
    colDimension: 'Dimension',
    colWeighted: 'Wtd.',
  },
  zh: {
    fullReport: 'RestaurantIQ 付费深度分析',
    printSubtitle: '选址情报报告',
    confidence: '置信度',
    confidenceLevel: { High: '高', Medium: '中', Low: '低', Unknown: '未知' },
    businessType: '业态',
    reportTitle: '报告标题',
    dashboard: '关键指标',
    executiveSummary: '执行摘要',
    finalVerdict: '最终判定',
    tradeAreaAnalysis: '贸易区与客流',
    demographicProfile: '人口与消费力',
    demographicBrief: 'McKinsey 风格人口与消费力简报',
    competitionLandscape: '竞争格局（叙述）',
    competitorsTable: '竞争对手矩阵',
    revenueEstimate: '营收预估（叙述）',
    revenueModel: '三场景营收模型',
    topRisks: '风险矩阵',
    opportunities: '发展机会',
    failureScenarios: '失败场景',
    differentiationStrategy: '差异化策略',
    acquisition: '获客渠道优先级',
    actionPlan: '90天行动计划',
    actionPlanStructured: '结构化作战表',
    comparables: '可比案例',
    decisionMatrix: '加权决策矩阵',
    dataSources: '数据来源与免责声明',
    siteAccess: '物业与路况评估',
    evidencePoints: '关键证据点',
    alternativeCorridors: '备选商业走廊与在租线索',
    generatedBy: '由 RestaurantIQ.ai 生成',
    reportId: '报告编号',
    analyzeAnother: '分析其他地址',
    contentNote: '（部分段落含 Markdown 表格）',
    snapshotId: '结论快照',
    dataAsOfLabel: '数据截至',
    langName: { en: '英文', zh: '中文', es: '西班牙文' },
    generatingVersion: (n) => `正在生成${n}版…`,
    langSwitchError: (n) => `无法生成${n}版，请稍后重试。`,
    langSwitchTimeout: (n) => `生成${n}版超时，请稍后重试。`,
    upgrading: '当前为标准版报告；深度版稍后自动替换，无需任何操作。',
    scenarioBasis: '三场景按座位 × 翻台 × 客单价测算；360° 报告按需求捕获测算，口径不同。',
    corridorTextOnly: '该走廊暂无经核实的在租房源（LoopNet / Crexi），不展示面积与租金；请踩盘或向经纪核实。',
    overallScore: '综合分',
    footTraffic: '客流指数',
    competition: '竞争强度',
    payback: '回收期(月)',
    recommendation: '建议等级',
    riskAudit: '选址风险审计',
    auditTopRisks: '三大核心风险',
    playbook: '最佳打法建议',
    leaseChecklist: '签 lease 前清单',
    costModel: '成本与打平模型',
    breakEven: '盈亏平衡营业额',
    safeRevenue: '安全营收线',
    competitorTiers: '竞品分层说明',
    competitorMap: '竞品分布地图',
    competitorInsights: '竞品深度洞察',
    colAddress: '地址/房源',
    colRent: '月租(USD)',
    colNotes: '亮点',
    colSource: '来源',
    colName: '名称',
    colCategory: '业态',
    colReviews: '评论',
    colPrice: '价格',
    colThreat: '威胁',
    colNote: '分析',
    scenario: (n) => `情景 ${n}`,
    perMonth: '/月',
    breakevenLine: '盈亏平衡：',
    costsLine: '成本结构：',
    colRisk: '风险',
    colProb: '概率',
    colFinancial: '财务影响',
    colTrigger: '触发信号',
    colMitigation: '对冲',
    colChannel: '渠道',
    colWhy: '理由',
    owner: '负责人',
    budget: '预算',
    time: '时间',
    deliverable: '产出',
    successCases: '成功案例',
    failureCases: '失败/关店参考',
    colDimension: '维度',
    colWeighted: '加权',
  },
  es: {
    fullReport: 'Análisis premium de RestaurantIQ',
    printSubtitle: 'Informe de inteligencia de ubicación',
    confidence: 'de confianza',
    confidenceLevel: { High: 'Alta', Medium: 'Media', Low: 'Baja', Unknown: 'Desconocida' },
    businessType: 'Tipo de negocio',
    reportTitle: 'Título del análisis',
    dashboard: 'Métricas clave',
    executiveSummary: 'Resumen ejecutivo',
    finalVerdict: 'Veredicto final',
    tradeAreaAnalysis: 'Análisis del área comercial',
    demographicProfile: 'Perfil demográfico',
    demographicBrief: 'Resumen demográfico estilo McKinsey',
    competitionLandscape: 'Panorama competitivo',
    competitorsTable: 'Matriz de competidores',
    revenueEstimate: 'Perspectiva de ingresos',
    revenueModel: 'Modelo de ingresos y escenarios',
    topRisks: 'Matriz de riesgos',
    opportunities: 'Oportunidades',
    failureScenarios: 'Escenarios de fracaso',
    differentiationStrategy: 'Estrategia de diferenciación',
    acquisition: 'Prioridades de captación',
    actionPlan: 'Plan de acción de 90 días',
    actionPlanStructured: 'Hoja de ruta estructurada',
    comparables: 'Casos comparables',
    decisionMatrix: 'Matriz de decisión ponderada',
    dataSources: 'Fuentes de datos y aviso legal',
    siteAccess: 'Contexto del local y vialidad',
    evidencePoints: 'Evidencia clave',
    alternativeCorridors: 'Corredores alternativos y anuncios',
    generatedBy: 'Generado por RestaurantIQ.ai',
    reportId: 'ID del informe',
    analyzeAnother: 'Analizar otra ubicación',
    contentNote: '',
    snapshotId: 'Snapshot de la conclusión',
    dataAsOfLabel: 'Datos al',
    langName: { en: 'inglés', zh: 'chino', es: 'español' },
    generatingVersion: (n) => `Generando la versión en ${n}…`,
    langSwitchError: (n) => `No se pudo generar la versión en ${n}. Inténtalo de nuevo en un momento.`,
    langSwitchTimeout: (n) => `La versión en ${n} tardó demasiado. Inténtalo de nuevo.`,
    upgrading: 'Estás viendo la edición estándar. La edición a fondo la reemplazará automáticamente cuando esté lista; no tienes que hacer nada.',
    scenarioBasis: 'Los tres escenarios se calculan como asientos × rotaciones por día × ticket promedio; el informe 360° modela la captura de demanda, así que las dos cifras usan bases distintas.',
    corridorTextOnly: 'No hay un anuncio verificado (LoopNet / Crexi) para este corredor; no se muestran superficie ni renta. Verifícalo en sitio o con un corredor.',
    overallScore: 'General',
    footTraffic: 'Tráfico peatonal',
    competition: 'Competencia',
    payback: 'Retorno (meses)',
    recommendation: 'Recomendación',
    riskAudit: 'Auditoría de riesgo de la ubicación',
    auditTopRisks: 'Los 3 riesgos principales',
    playbook: 'Estrategia recomendada',
    leaseChecklist: 'Lista previa al contrato',
    costModel: 'Modelo de costos y punto de equilibrio',
    breakEven: 'Ingresos de punto de equilibrio',
    safeRevenue: 'Ingresos objetivo con margen',
    competitorTiers: 'Niveles de competidores',
    competitorMap: 'Mapa de competidores',
    competitorInsights: 'Análisis a fondo de competidores',
    colAddress: 'Dirección',
    colRent: 'Renta/mes',
    colNotes: 'Notas',
    colSource: 'Fuente',
    colName: 'Nombre',
    colCategory: 'Categoría',
    colReviews: 'Reseñas',
    colPrice: '$',
    colThreat: 'Amenaza',
    colNote: 'Nota',
    scenario: (n) => `Escenario ${n}`,
    perMonth: '/mes',
    breakevenLine: 'Punto de equilibrio: ',
    costsLine: 'Costos: ',
    colRisk: 'Riesgo',
    colProb: 'Prob.',
    colFinancial: 'Impacto financiero',
    colTrigger: 'Detonante',
    colMitigation: 'Mitigación',
    colChannel: 'Canal',
    colWhy: 'Por qué',
    owner: 'Responsable',
    budget: 'Presupuesto',
    time: 'Plazo',
    deliverable: 'Entregable',
    successCases: 'Casos de éxito',
    failureCases: 'Casos de fracaso / cierre',
    colDimension: 'Dimensión',
    colWeighted: 'Pond.',
  },
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function safeArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function ConfidenceBadge({
  confidence,
  rationale,
  lang,
}: {
  confidence?: string;
  rationale?: string;
  lang: Locale;
}) {
  const t = translations[lang];
  const level = normalizeConfidenceLevel(confidence);
  const colors: Record<string, string> = {
    High: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
    Medium: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    Low: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  };
  const color = level ? colors[level] : 'border-zinc-600 bg-zinc-800/80 text-zinc-400';
  const label = level ? t.confidenceLevel[level as 'High' | 'Medium' | 'Low'] ?? t.confidenceLevel.Unknown : t.confidenceLevel.Unknown;
  return (
    <div className="text-right">
      <span className={`inline-block rounded-full border px-3 py-1 text-sm font-medium ${color}`}>
        {label} {t.confidence}
      </span>
      {rationale?.trim() && (
        <p className="mt-2 max-w-md text-xs leading-snug text-zinc-500">{rationale}</p>
      )}
    </div>
  );
}

function SectionShell({
  title,
  icon,
  children,
  className = '',
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`print-section rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm ${className}`}
    >
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-100">
        <span aria-hidden>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ReportContent({
  report,
  full,
  initialLang = 'en',
  marketData = null,
  staticMapUrl = null,
  modelSources = null,
  dataAsOf = null,
}: Props) {
  const [lang, setLang] = useState<Locale>(initialLang);
  useEffect(() => {
    rememberPaidReport(report.id, report.location);
  }, [report.id, report.location]);
  const [fullByLang, setFullByLang] = useState<Record<Locale, FullReportView | null>>(() => ({
    en: initialLang === 'en' ? full : null,
    zh: initialLang === 'zh' ? full : null,
    es: initialLang === 'es' ? full : null,
  }));
  const [isSwitchingLang, setIsSwitchingLang] = useState(false);
  const [langSwitchError, setLangSwitchError] = useState<string | null>(null);
  const [pendingLang, setPendingLang] = useState<Locale | null>(null);

  // §4.5 d: the professional pass is scheduled by the server once the standard
  // report is persisted (iq-report-job → maybeKickAutoUpgrade). This page only
  // watches the status endpoint and reloads when the tier flips.
  const generationTier = typeof full.generation_tier === 'string' ? full.generation_tier : null;
  const [upgrading, setUpgrading] = useState(generationTier === 'standard');
  const upgradeWatchStarted = useRef(false);
  useEffect(() => {
    if (generationTier !== 'standard' || upgradeWatchStarted.current) return;
    upgradeWatchStarted.current = true;
    let cancelled = false;
    (async () => {
      const startedAt = Date.now();
      let idleChecks = 0;
      while (!cancelled && Date.now() - startedAt < 20 * 60_000) {
        const s = await fetch(`/api/funnel/full-report/status?reportId=${encodeURIComponent(report.id)}`, {
          cache: 'no-store',
        })
          .then((r) => r.json())
          .catch(() => null);
        if (cancelled) return;
        if (s) {
          if (s.generationTier === 'professional') {
            window.location.reload();
            return;
          }
          if (s.legacy || s.status === 'failed') break;
          // Nothing running and nothing scheduled (auto-upgrade disabled or already attempted): stop watching.
          if (s.status !== 'running') {
            idleChecks += 1;
            if (idleChecks >= 3) break;
          }
        }
        await new Promise((r) => setTimeout(r, 6_000));
      }
      if (!cancelled) setUpgrading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [generationTier, report.id]);

  const t = translations[lang];

  // The report body itself is language-specific. When the user toggles language,
  // we preview-generate the paid report in the target language (without persisting)
  // and cache it in memory for the session.
  const fullView = useMemo(() => fullByLang[lang] ?? full, [fullByLang, lang, full]);

  const handleSetLang = useCallback(
    async (next: Locale) => {
      if (next === lang) return;
      const targetName = translations[lang].langName[next];
      if (fullByLang[next]) {
        setLang(next);
        persistLocale(next);
        setLangSwitchError(null);
        return;
      }
      setPendingLang(next);
      setIsSwitchingLang(true);
      setLangSwitchError(null);
      try {
        const res = await fetch('/api/funnel/full-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportId: report.id,
            language: next,
            persist: false,
            quality: false,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          setFullByLang((prev) => ({ ...prev, [next]: json }));
          setLang(next);
          persistLocale(next);
          return;
        }
        const raw = await res.text();
        let msg = translations[lang].langSwitchError(targetName);
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          if (res.status === 504) msg = translations[lang].langSwitchTimeout(targetName);
        }
        setLangSwitchError(msg);
      } catch {
        setLangSwitchError(translations[lang].langSwitchError(targetName));
      } finally {
        setIsSwitchingLang(false);
        setPendingLang(null);
      }
    },
    [fullByLang, lang, report.id],
  );

  const dashboard = fullView.dashboard as Record<string, unknown> | undefined;
  const competitors = safeArr(fullView.competitors);
  const riskMatrix = safeArr(fullView.risk_matrix);
  const revenueModel = fullView.revenue_model as Record<string, unknown> | undefined;
  const scenarios = safeArr(revenueModel?.scenarios);
  const sensitivity = safeArr(revenueModel?.sensitivity);
  const acquisition = safeArr(fullView.acquisition_channels);
  const structuredSteps = safeArr(fullView.action_plan_structured);
  const decisionMatrix = safeArr(fullView.decision_matrix);
  const evidencePoints = safeArr(fullView.key_evidence_points).filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  );
  const alternativeCorridors = safeArr(fullView.alternative_corridors);
  const comparables = fullView.comparables as Record<string, unknown> | undefined;
  const successCases = safeArr(comparables?.success_cases);
  const failureCases = safeArr(comparables?.failure_cases);

  const displayTitle = str(fullView.report_title) || report.headline;
  const heroLine =
    str(fullView.one_line_conclusion) ||
    normalizeRiskAuditFromFull(fullView)?.one_line_conclusion;
  const confRaw = str(fullView.confidence);
  const confRationale = str(fullView.confidence_rationale);
  const dualVerify = fullView.dual_model_verification as Record<string, unknown> | undefined;
  const dualVerifyStatus = str(dualVerify?.status);
  const dualDisagreements = safeArr(dualVerify?.disagreements).filter(
    (x): x is string => typeof x === 'string',
  );
  const hasRiskAudit = Boolean(normalizeRiskAuditFromFull(fullView) ?? fullView.risk_audit);
  // §4.1 单一结论源 (P0-A): the frozen conclusion the PDF prints as well. While it is
  // missing the page shows ONE pending line, never a second set of numbers.
  const conclusion = parseConclusion(fullView.conclusion);
  const conclusionPending = fullView.conclusion_pending === true && !conclusion;
  const asOf = conclusion?.data_as_of ?? dataAsOf;

  const showRevenueModelBlock =
    !!revenueModel &&
    (scenarios.length > 0 || Boolean(str(revenueModel.methodology as string)));
  const showRevenueEstimateBlock = Boolean(str(fullView.revenue_estimate));
  const showRevenueSection = showRevenueModelBlock || showRevenueEstimateBlock;

  return (
    <>
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
            color: #111 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print {
            display: none !important;
          }
          .print-only {
            display: block !important;
          }
          main {
            padding: 0 !important;
          }
          .print-section {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .rounded-2xl,
          .rounded-3xl,
          .rounded-xl {
            border-radius: 8px !important;
          }
          .border-zinc-800 {
            border-color: #e5e7eb !important;
          }
          .bg-zinc-900\\/50,
          .bg-zinc-950\\/30 {
            background: #fafafa !important;
          }
          .text-zinc-100,
          .text-zinc-200,
          .text-white {
            color: #111 !important;
          }
          .text-zinc-300,
          .text-zinc-400,
          .text-zinc-500 {
            color: #374151 !important;
          }
        }
        .print-only {
          display: none;
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between">
        <div className="text-xs text-zinc-500">{t.contentNote}</div>
        <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900/80 p-1" role="group" aria-label="Language">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => void handleSetLang(l)}
              aria-pressed={lang === l}
              disabled={isSwitchingLang}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-60 ${
                lang === l ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {LOCALE_LABEL[l]}
            </button>
          ))}
        </div>
      </div>
      {isSwitchingLang && pendingLang ? (
        <div className="no-print mb-4 text-xs text-zinc-500">{t.generatingVersion(t.langName[pendingLang])}</div>
      ) : null}
      {langSwitchError ? (
        <div className="no-print mb-4 text-xs text-amber-400/90" role="alert">
          {langSwitchError}
        </div>
      ) : null}
      {upgrading ? (
        <div className="no-print mb-4 flex items-center gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {t.upgrading}
        </div>
      ) : null}

      <div className="print-only mb-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">RestaurantIQ</h1>
        <p className="text-sm text-zinc-500">{t.printSubtitle}</p>
      </div>

      {/* Header */}
      {conclusionPending ? (
        <div className="print-section rounded-2xl border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200/90">
          {conclusionPendingNote(lang)}
        </div>
      ) : null}

      <header className="print-section rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-8">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{t.fullReport}</div>
          <ConfidenceBadge confidence={confRaw} rationale={confRationale} lang={lang} />
        </div>
        <h1 className="mb-3 text-3xl font-bold tracking-tight text-zinc-50 md:text-4xl">{displayTitle}</h1>
        <p className="text-lg text-zinc-400">{report.location}</p>
        {report.business_type && (
          <p className="mt-1 text-sm text-zinc-500">
            {t.businessType}: {report.business_type}
          </p>
        )}
        <p className="mt-4 text-xs text-emerald-400/80">{productPositioningLine(lang)}</p>
        {heroLine && (
          <p className="mt-4 text-lg font-medium leading-relaxed text-zinc-200">{heroLine}</p>
        )}
        {dualVerifyStatus && (
          <div
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              dualVerifyStatus.includes('✓') ||
                /reviewed/i.test(dualVerifyStatus) ||
                /已复核/i.test(dualVerifyStatus)
                ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                : 'border-amber-800/60 bg-amber-950/40 text-amber-200'
            }`}
          >
            <p className="font-medium">{dualVerifyStatus}</p>
            {dualDisagreements.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-zinc-400">
                {dualDisagreements.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>

      {hasRiskAudit && (
        <RiskAuditReportSections
          full={fullView}
          lang={lang}
          businessType={report.business_type}
          marketData={marketData}
          staticMapUrl={staticMapUrl}
          t={{
            riskAudit: t.riskAudit,
            topRisks: t.auditTopRisks,
            playbook: t.playbook,
            leaseChecklist: t.leaseChecklist,
            costModel: t.costModel,
            breakEven: t.breakEven,
            safeRevenue: t.safeRevenue,
            competitorTiers: t.competitorTiers,
            competitorMap: t.competitorMap,
            competitorInsights: t.competitorInsights,
          }}
        />
      )}

      {/* Dashboard */}
      {dashboard && Object.keys(dashboard).length > 0 && (
        <SectionShell title={t.dashboard} icon="📊">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['overall_score', t.overallScore],
              ['foot_traffic_index', t.footTraffic],
              ['competition_intensity', t.competition],
              ['payback_months', t.payback],
              ['recommendation', t.recommendation],
            ].map(([key, label]) => {
              const val = dashboard[key];
              if (val === undefined || val === null || val === '') return null;
              return (
                <div
                  key={key}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-center"
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
                  <div className="mt-1 text-lg font-semibold text-zinc-100">{String(val)}</div>
                </div>
              );
            })}
          </div>
        </SectionShell>
      )}

      <ReportDataViz marketData={marketData} full={fullView} lang={lang} />

      {str(fullView.executive_summary) && (
        <SectionShell title={t.executiveSummary} icon="📋">
          <ReportMarkdown>{fullView.executive_summary as string}</ReportMarkdown>
        </SectionShell>
      )}

      {str(fullView.final_verdict) && (
        <SectionShell title={t.finalVerdict} icon="✅" className="border-emerald-900/40 bg-emerald-950/20">
          <p className="text-lg font-medium text-zinc-100">{fullView.final_verdict as string}</p>
        </SectionShell>
      )}

      {str(fullView.site_and_access_assessment) && (
        <SectionShell title={t.siteAccess} icon="🛣️">
          <ReportMarkdown>{fullView.site_and_access_assessment as string}</ReportMarkdown>
        </SectionShell>
      )}

      {evidencePoints.length > 0 && (
        <SectionShell title={t.evidencePoints} icon="📌">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
            {evidencePoints.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </SectionShell>
      )}

      {alternativeCorridors.length > 0 && (
        <SectionShell title={t.alternativeCorridors} icon="🗺️">
          <div className="space-y-8">
            {alternativeCorridors.map((cor, ci) => {
              const c = cor as Record<string, unknown>;
              // §4.7 c: only LoopNet/Crexi-sourced rows may show sqft / rent; otherwise text only.
              const listings = verifiedListings(c.listings);
              return (
                <div key={ci} className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4" data-corridor={listings.length > 0 ? 'table' : 'text'}>
                  <h3 className="text-lg font-semibold text-zinc-100">
                    {String(c.corridor_name ?? `—`)}
                  </h3>
                  {str(c.rationale) && (
                    <p className="mt-2 text-sm text-zinc-400">{c.rationale as string}</p>
                  )}
                  {listings.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500">{t.corridorTextOnly}</p>
                  ) : null}
                  {listings.length > 0 ? (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
                      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                        <thead className="bg-zinc-800/60 text-xs uppercase text-zinc-400">
                          <tr>
                            <th className="px-3 py-2">{t.colAddress}</th>
                            <th className="px-3 py-2">sqft</th>
                            <th className="px-3 py-2">{t.colRent}</th>
                            <th className="px-3 py-2">{t.colNotes}</th>
                            <th className="px-3 py-2">{t.colSource}</th>
                          </tr>
                        </thead>
                        <tbody className="text-zinc-300">
                          {listings.map((row, ri) => {
                            const r = row as Record<string, unknown>;
                            return (
                              <tr key={ri} className="border-t border-zinc-800">
                                <td className="px-3 py-2 font-medium text-zinc-100">
                                  {String(r.address_or_listing ?? '—')}
                                </td>
                                <td className="px-3 py-2">{r.sqft != null ? String(r.sqft) : '—'}</td>
                                <td className="px-3 py-2">
                                  {r.monthly_rent_usd != null ? String(r.monthly_rent_usd) : '—'}
                                </td>
                                <td className="max-w-[200px] px-3 py-2 text-xs text-zinc-400">
                                  {String(r.highlights ?? '—')}
                                </td>
                                <td className="px-3 py-2 text-xs text-zinc-500">
                                  {String(r.source_tag ?? '—')}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SectionShell>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {str(fullView.trade_area_analysis) && (
          <SectionShell title={t.tradeAreaAnalysis} icon="📍">
            <ReportMarkdown>{fullView.trade_area_analysis as string}</ReportMarkdown>
          </SectionShell>
        )}
        {(() => {
          const demoNarrative = (marketData?.demographic_narrative ?? null) as
            | { paragraph_zh?: string; paragraph_en?: string; model?: string; generated_at?: string }
            | null;
          // The narrative is stored in zh + en; Spanish readers get the English paragraph.
          const aiPara =
            demoNarrative && typeof demoNarrative === 'object'
              ? lang === 'zh'
                ? demoNarrative.paragraph_zh
                : demoNarrative.paragraph_en
              : null;
          const hasLlm = str(fullView.demographic_profile);
          if (!hasLlm && !aiPara) return null;
          return (
            <SectionShell title={t.demographicProfile} icon="👥">
              {aiPara && (
                <div className="mb-4 rounded-lg border border-blue-700/40 bg-blue-950/30 p-4 text-sm leading-relaxed text-blue-100">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-blue-300">
                    <span>{t.demographicBrief}</span>
                    <span className="rounded bg-blue-800/40 px-1.5 py-0.5 text-[10px] text-blue-200">
                      {lang === 'zh' ? 'AI 提炼' : lang === 'es' ? 'Extraído por IA' : 'AI-extracted'} · ACS B03002/B19001/B15003
                    </span>
                  </div>
                  <p className="whitespace-pre-line">{aiPara}</p>
                </div>
              )}
              {hasLlm && <ReportMarkdown>{fullView.demographic_profile as string}</ReportMarkdown>}
            </SectionShell>
          );
        })()}
      </div>

      {competitors.length > 0 && (
        <SectionShell title={t.competitorsTable} icon="🏪">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead className="bg-zinc-800/60 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t.colName}</th>
                  <th className="px-3 py-2">mi</th>
                  <th className="px-3 py-2">{t.colCategory}</th>
                  <th className="px-3 py-2">★</th>
                  <th className="px-3 py-2">{t.colReviews}</th>
                  <th className="px-3 py-2">{t.colPrice}</th>
                  <th className="px-3 py-2">{t.colThreat}</th>
                  <th className="px-3 py-2">{t.colNote}</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {competitors.map((row, i) => {
                  const r = row as Record<string, unknown>;
                  return (
                    <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-800/30">
                      <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-zinc-100">{String(r.name ?? '—')}</td>
                      <td className="px-3 py-2">{r.distance_mi != null ? String(r.distance_mi) : '—'}</td>
                      <td className="px-3 py-2">{String(r.category ?? '—')}</td>
                      <td className="px-3 py-2">{r.rating != null ? String(r.rating) : '—'}</td>
                      <td className="px-3 py-2">{r.review_count != null ? String(r.review_count) : '—'}</td>
                      <td className="px-3 py-2">{String(r.price_tier ?? '—')}</td>
                      <td className="px-3 py-2">{String(r.threat_level ?? '—')}</td>
                      <td className="max-w-[220px] px-3 py-2 text-xs text-zinc-400">
                        {String(r.analysis ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionShell>
      )}

      {str(fullView.competition_landscape) && (
        <SectionShell title={t.competitionLandscape} icon="🗺️">
          <ReportMarkdown>{fullView.competition_landscape as string}</ReportMarkdown>
        </SectionShell>
      )}

      {showRevenueSection ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {showRevenueModelBlock && revenueModel ? (
            <SectionShell title={t.revenueModel} icon="📈">
              {str(revenueModel.methodology as string) && (
                <ReportMarkdown className="mb-4">{String(revenueModel.methodology)}</ReportMarkdown>
              )}
              {scenarios.length > 0 && (
                <p className="mb-3 text-xs leading-relaxed text-zinc-500">{t.scenarioBasis}</p>
              )}
              {scenarios.length > 0 && (
                <div className="space-y-3">
                  {scenarios.map((s, i) => {
                    const sc = s as Record<string, unknown>;
                    return (
                      <div
                        key={i}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-300"
                      >
                        <div className="font-semibold text-zinc-100">
                          {String(sc.name ?? t.scenario(i + 1))}
                          {sc.monthly_revenue_usd != null && sc.monthly_revenue_usd !== '' && (
                            <span className="ml-2 text-emerald-400/90">
                              $
                              {typeof sc.monthly_revenue_usd === 'number'
                                ? sc.monthly_revenue_usd.toLocaleString()
                                : String(sc.monthly_revenue_usd)}
                              {t.perMonth}
                            </span>
                          )}
                        </div>
                        {str(sc.key_assumptions as string) && (
                          <p className="mt-2 text-xs leading-relaxed text-zinc-400">{String(sc.key_assumptions)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {sensitivity.length > 0 && (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-zinc-400">
                  {sensitivity.map((line, i) => (
                    <li key={i}>{String(line)}</li>
                  ))}
                </ul>
              )}
              {str(revenueModel.breakeven as string) && (
                <p className="mt-4 text-sm text-zinc-400">
                  <span className="font-medium text-zinc-300">{t.breakevenLine}</span>
                  {String(revenueModel.breakeven)}
                </p>
              )}
              {str(revenueModel.monthly_costs_note as string) && (
                <p className="mt-2 text-sm text-zinc-400">
                  <span className="font-medium text-zinc-300">{t.costsLine}</span>
                  {String(revenueModel.monthly_costs_note)}
                </p>
              )}
            </SectionShell>
          ) : null}
          {showRevenueEstimateBlock ? (
            <SectionShell title={t.revenueEstimate} icon="💰">
              <ReportMarkdown>{fullView.revenue_estimate as string}</ReportMarkdown>
            </SectionShell>
          ) : null}
        </div>
      ) : null}

      {riskMatrix.length > 0 ? (
        <SectionShell title={t.topRisks} icon="⚠️" className="border-zinc-800">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-zinc-800/60 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">{t.colRisk}</th>
                  <th className="px-3 py-2">{t.colProb}</th>
                  <th className="px-3 py-2">{t.colFinancial}</th>
                  <th className="px-3 py-2">{t.colTrigger}</th>
                  <th className="px-3 py-2">{t.colMitigation}</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {riskMatrix.map((row, i) => {
                  const r = row as Record<string, unknown>;
                  return (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                      <td className="max-w-[180px] px-3 py-2 font-medium text-zinc-100">{String(r.risk ?? '—')}</td>
                      <td className="px-3 py-2">{String(r.probability ?? '—')}</td>
                      <td className="max-w-[160px] px-3 py-2 text-xs">{String(r.financial_impact ?? '—')}</td>
                      <td className="max-w-[160px] px-3 py-2 text-xs text-zinc-400">{String(r.trigger ?? '—')}</td>
                      <td className="max-w-[200px] px-3 py-2 text-xs text-zinc-400">{String(r.mitigation ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionShell>
      ) : (
        safeArr(fullView.risks).length > 0 && (
          <SectionShell title={t.topRisks} icon="⚠️">
            <ol className="space-y-3">
              {safeArr(fullView.risks).map((risk, i) => (
                <li key={i} className="flex gap-3 text-sm text-zinc-300">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-300">
                    {i + 1}
                  </span>
                  <span>{String(risk)}</span>
                </li>
              ))}
            </ol>
          </SectionShell>
        )
      )}

      {safeArr(fullView.opportunities).length > 0 && (
        <SectionShell title={t.opportunities} icon="💡">
          <ol className="space-y-3">
            {safeArr(fullView.opportunities).map((opp, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-300">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-300">
                  {i + 1}
                </span>
                <span>{String(opp)}</span>
              </li>
            ))}
          </ol>
        </SectionShell>
      )}

      {safeArr(fullView.failure_scenarios).length > 0 && (
        <SectionShell title={t.failureScenarios} icon="🚨">
          <ul className="space-y-3">
            {safeArr(fullView.failure_scenarios).map((scenario, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-300">
                <span className="text-zinc-500">•</span>
                <span>{String(scenario)}</span>
              </li>
            ))}
          </ul>
        </SectionShell>
      )}

      {str(fullView.differentiation_strategy) && (
        <SectionShell title={t.differentiationStrategy} icon="🎯">
          <ReportMarkdown>{fullView.differentiation_strategy as string}</ReportMarkdown>
        </SectionShell>
      )}

      {acquisition.length > 0 && (
        <SectionShell title={t.acquisition} icon="📣">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="bg-zinc-800/60 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">{t.colChannel}</th>
                  <th className="px-3 py-2">P</th>
                  <th className="px-3 py-2">{t.colWhy}</th>
                  <th className="px-3 py-2">CAC</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {acquisition.map((row, i) => {
                  const r = row as Record<string, unknown>;
                  return (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2 font-medium text-zinc-100">{String(r.channel ?? '—')}</td>
                      <td className="px-3 py-2">{String(r.priority ?? '—')}</td>
                      <td className="max-w-[280px] px-3 py-2 text-xs text-zinc-400">{String(r.rationale ?? '—')}</td>
                      <td className="px-3 py-2 text-xs">{String(r.expected_cac_band ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionShell>
      )}

      {structuredSteps.length > 0 && (
        <SectionShell title={t.actionPlanStructured} icon="📅">
          <div className="space-y-4">
            {structuredSteps.map((row, i) => {
              const r = row as Record<string, unknown>;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-300"
                >
                  <div className="font-semibold text-zinc-100">
                    {i + 1}. {String(r.task ?? '—')}
                  </div>
                  <dl className="mt-2 grid gap-1 text-xs text-zinc-400 sm:grid-cols-2">
                    {r.owner != null && r.owner !== '' && (
                      <>
                        <dt className="text-zinc-500">{t.owner}</dt>
                        <dd>{String(r.owner)}</dd>
                      </>
                    )}
                    {r.budget_band != null && r.budget_band !== '' && (
                      <>
                        <dt className="text-zinc-500">{t.budget}</dt>
                        <dd>{String(r.budget_band)}</dd>
                      </>
                    )}
                    {r.timeframe != null && r.timeframe !== '' && (
                      <>
                        <dt className="text-zinc-500">{t.time}</dt>
                        <dd>{String(r.timeframe)}</dd>
                      </>
                    )}
                    {r.deliverable != null && r.deliverable !== '' && (
                      <>
                        <dt className="text-zinc-500">{t.deliverable}</dt>
                        <dd className="sm:col-span-2">{String(r.deliverable)}</dd>
                      </>
                    )}
                    {r.success_metric != null && r.success_metric !== '' && (
                      <>
                        <dt className="text-zinc-500">KPI</dt>
                        <dd className="sm:col-span-2">{String(r.success_metric)}</dd>
                      </>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </SectionShell>
      )}

      {safeArr(fullView.action_plan).length > 0 && (
        <SectionShell title={t.actionPlan} icon="📝">
          <ol className="space-y-3">
            {safeArr(fullView.action_plan).map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-300">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-zinc-300">
                  {i + 1}
                </span>
                <span>{String(step)}</span>
              </li>
            ))}
          </ol>
        </SectionShell>
      )}

      {(successCases.length > 0 || failureCases.length > 0) && (
        <SectionShell title={t.comparables} icon="📚">
          {successCases.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-emerald-400/90">{t.successCases}</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
                {successCases.map((c, i) => (
                  <li key={i}>{String(c)}</li>
                ))}
              </ul>
            </div>
          )}
          {failureCases.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-rose-400/90">{t.failureCases}</h3>
              <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
                {failureCases.map((c, i) => (
                  <li key={i}>{String(c)}</li>
                ))}
              </ul>
            </div>
          )}
        </SectionShell>
      )}

      {decisionMatrix.length > 0 && (
        <SectionShell title={t.decisionMatrix} icon="⚖️">
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead className="bg-zinc-800/60 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3 py-2">{t.colDimension}</th>
                  <th className="px-3 py-2">/100</th>
                  <th className="px-3 py-2">%</th>
                  <th className="px-3 py-2">{t.colWeighted}</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {decisionMatrix.map((row, i) => {
                  const r = row as Record<string, unknown>;
                  return (
                    <tr key={i} className="border-t border-zinc-800">
                      <td className="px-3 py-2 font-medium text-zinc-100">{String(r.dimension ?? '—')}</td>
                      <td className="px-3 py-2">{r.score_100 != null ? String(r.score_100) : '—'}</td>
                      <td className="px-3 py-2">{r.weight_pct != null ? String(r.weight_pct) : '—'}</td>
                      <td className="px-3 py-2">{r.weighted_score != null ? String(r.weighted_score) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionShell>
      )}

      <DataProvenance marketData={marketData} lang={lang} modelSources={modelSources} dataAsOf={dataAsOf} />

      {str(fullView.data_sources_and_disclaimer) && (
        <SectionShell title={t.dataSources} icon="📎">
          <ReportMarkdown>{fullView.data_sources_and_disclaimer as string}</ReportMarkdown>
        </SectionShell>
      )}

      {/* The 360° model is still generating (the page shows this legacy view only then); reloads into the document when ready. */}
      <div className="no-print space-y-6">
        <Report360Panel reportId={report.id} lang={lang} />
        <ReportAccountBlock reportId={report.id} serverUserId={report.user_id} lang={lang} />
      </div>

      <footer className="text-center">
        <p className="text-sm text-zinc-600">
          {t.generatedBy} • {t.reportId}: {report.id.slice(0, 8)}
        </p>
        {/* §4.1 单一结论源: the snapshot id and the data-as-of date are printed here and
            in the PDF footer, so a customer can tell at a glance that both surfaces
            describe the same frozen set of numbers. */}
        {conclusion ? (
          <p className="mt-1 text-xs text-zinc-600">
            {t.snapshotId}: {conclusion.snapshot_id} • {t.dataAsOfLabel}: {conclusion.data_as_of}
          </p>
        ) : asOf ? (
          <p className="mt-1 text-xs text-zinc-600">
            {t.dataAsOfLabel}: {asOf}
          </p>
        ) : null}
        <Link href={withLang('/iq', lang)} className="no-print mt-4 inline-block text-sm text-emerald-500/90 hover:text-emerald-400 hover:underline">
          ← {t.analyzeAnother}
        </Link>
      </footer>
    </>
  );
}
