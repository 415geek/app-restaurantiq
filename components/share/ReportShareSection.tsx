'use client';

import { ShareButton } from './ShareButton';
import type { Locale } from '@/lib/i18n/locale';
import { withLang } from '@/lib/i18n/resolve';

type ReportShareSectionProps = {
  reportId: string;
  headline: string;
  location: string;
  confidence?: string;
  locale?: Locale;
};

const copy: Record<
  Locale,
  { prompt: string; title: (headline: string) => string; description: (location: string, confidence: string) => string; na: string }
> = {
  en: {
    prompt: 'Share this report with your team or partners',
    title: (h) => `RestaurantIQ report: ${h}`,
    description: (l, c) => `Location analysis for ${l}. Confidence: ${c}`,
    na: 'N/A',
  },
  zh: {
    prompt: '把这份报告分享给团队或合伙人',
    title: (h) => `RestaurantIQ 报告：${h}`,
    description: (l, c) => `${l} 的选址分析。置信度：${c}`,
    na: '未知',
  },
  es: {
    prompt: 'Comparte este informe con tu equipo o tus socios',
    title: (h) => `Informe de RestaurantIQ: ${h}`,
    description: (l, c) => `Análisis de ubicación para ${l}. Confianza: ${c}`,
    na: 'N/D',
  },
};

export function ReportShareSection({ reportId, headline, location, confidence, locale = 'en' }: ReportShareSectionProps) {
  const t = copy[locale];
  const shareUrl = typeof window !== 'undefined'
    ? withLang(`${window.location.origin}/iq/report/${reportId}`, locale)
    : '';

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-sm text-zinc-400">{t.prompt}</div>
      <ShareButton
        shareUrl={shareUrl}
        title={t.title(headline)}
        description={t.description(location, confidence || t.na)}
        reportId={reportId}
        locale={locale}
        variant="primary"
        size="sm"
      />
    </div>
  );
}
