/**
 * Paywall "locked" lines on /iq/result — aligned with paid report schema sections
 * (see components/iq/ReportContent.tsx + lib/funnel/iq-full-report-schema.ts).
 */
export type IqLocale = 'en' | 'zh';

export function getIqPaywallLockedItems(locale: IqLocale): string[] {
  if (locale === 'zh') {
    return [
      '保本营业额与三场景月营收（含翻台/客单价假设，可核对公式）',
      '1 英里内真店名竞对 + 威胁等级 + 空白地图',
      '签租前 10+ 项合规清单（排 hood / 燃气 / ADA 等致命项）',
      '风险概率 × 美元影响 × 触发条件 × 对冲动作（5 条）',
      '替代走廊具体铺位（地址、面积、月租、亮点）',
      'PDF 导出 + 完整六层风险审计与 90 天作战图',
    ];
  }
  return [
    'Break-even monthly sales + 3 revenue scenarios (turns/ticket math shown)',
    'Named competitors within ~1 mi + threat tiers + whitespace map',
    '10+ pre-lease checklist items (hood, gas, ADA, grease trap, etc.)',
    'Risk matrix: probability × $ impact × trigger × mitigation (5 rows)',
    'Alternative corridors with specific listings (address, sqft, rent)',
    'PDF export + full six-layer risk audit & 90-day action plan',
  ];
}
