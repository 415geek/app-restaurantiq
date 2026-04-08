/**
 * Paywall "locked" lines on /iq/result — aligned with paid report schema sections
 * (see components/iq/ReportContent.tsx + lib/funnel/iq-full-report-schema.ts).
 */
export type IqLocale = 'en' | 'zh';

export function getIqPaywallLockedItems(locale: IqLocale): string[] {
  if (locale === 'zh') {
    return [
      '📊 关键指标仪表板、执行摘要与最终判定',
      '🗺️ 贸易区分析、人口统计与消费力画像',
      '🎯 竞争对手矩阵与竞争格局深度叙述',
      '💰 三场景营收模型、回本与风险矩阵（含财务量级）',
      '🚀 差异化策略、获客渠道优先级与90天结构化作战表',
      '📋 可比成败案例、加权决策矩阵与备选商业走廊/在租线索',
    ];
  }
  return [
    '📊 Dashboard metrics, executive summary & final verdict',
    '🗺️ Trade-area analysis, demographics & spending-power profile',
    '🎯 Competitor matrix & full competitive landscape narrative',
    '💰 Three-scenario revenue model, payback & risk matrix (with $ impact)',
    '🚀 Differentiation, acquisition priorities & structured 90-day roadmap',
    '📋 Comparable success/failure cases, weighted decision matrix & alternative listings',
  ];
}
