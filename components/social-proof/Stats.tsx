'use client';

/**
 * Social proof (评审 Spec §4.7): the number of analyses generated, read from
 * GET /api/iq/stats (a fixed pre-Supabase baseline plus the live row count, so
 * it grows with every analysis). No accuracy claims; the number is hidden
 * rather than faked when the endpoint is unreachable.
 */
import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';

type StatsProps = {
  locale?: Locale;
  variant?: 'default' | 'compact';
};

const COPY: Record<Locale, { generated: (n: string) => string; badge: (n: string) => string }> = {
  en: { generated: (n) => `${n} analyses generated`, badge: (n) => `${n} location analyses generated so far` },
  zh: { generated: (n) => `已生成 ${n} 份分析`, badge: (n) => `已生成 ${n} 份选址分析` },
  es: { generated: (n) => `${n} análisis generados`, badge: (n) => `${n} análisis de ubicación generados hasta ahora` },
};

const testimonials: Record<Locale, { quote: string; author: string }[]> = {
  en: [
    {
      quote: 'Saved me from signing a bad lease. The report showed competition density I completely missed.',
      author: 'Restaurant owner, San Francisco',
    },
    {
      quote: 'Worth every penny. The risk analysis was spot-on.',
      author: 'Café owner, New York',
    },
  ],
  zh: [
    {
      quote: '帮我避免了签一份糟糕的租约。报告显示了我完全忽略的竞争密度。',
      author: '餐厅老板，旧金山',
    },
    {
      quote: '物超所值。风险分析非常准确。',
      author: '咖啡店老板，纽约',
    },
  ],
  es: [
    {
      quote: 'Me salvó de firmar un mal contrato. El informe mostró una densidad de competencia que se me había pasado por completo.',
      author: 'Dueño de restaurante, San Francisco',
    },
    {
      quote: 'Vale cada centavo. El análisis de riesgo fue exacto.',
      author: 'Dueña de cafetería, Nueva York',
    },
  ],
};

let cachedCount: number | null | undefined;
let inflight: Promise<number | null> | null = null;

async function fetchReportCount(): Promise<number | null> {
  if (cachedCount !== undefined) return cachedCount;
  if (!inflight) {
    inflight = fetch('/api/iq/stats', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return null;
        const json = (await res.json()) as { reports?: unknown };
        return typeof json.reports === 'number' && Number.isFinite(json.reports) && json.reports > 0 ? json.reports : null;
      })
      .catch(() => null)
      .then((n) => {
        cachedCount = n;
        inflight = null;
        return n;
      });
  }
  return inflight;
}

/** Real report count, or null while loading / when unavailable. */
export function useReportCount(): number | null {
  const [count, setCount] = useState<number | null>(cachedCount ?? null);
  useEffect(() => {
    let alive = true;
    void fetchReportCount().then((n) => {
      if (alive) setCount(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return count;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function SocialProofStats({ locale = 'en', variant = 'default' }: StatsProps) {
  const count = useReportCount();
  if (count == null) return null;
  const line = COPY[locale].generated(fmt(count));

  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-center gap-6 text-sm text-zinc-500">
        <span>✓ {line}</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
      <div className="text-2xl font-bold text-white">{fmt(count)}</div>
      <div className="mt-1 text-xs text-gray-500">{COPY[locale].generated('').trim()}</div>
    </div>
  );
}

export function SocialProofTestimonial({ locale = 'en' }: { locale?: Locale }) {
  const t = testimonials[locale];
  const randomIndex = Math.floor(Math.random() * t.length);
  const testimonial = t[randomIndex];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-sm italic text-gray-400">&ldquo;{testimonial.quote}&rdquo;</p>
      <p className="mt-2 text-xs text-gray-600">— {testimonial.author}</p>
    </div>
  );
}

export function SocialProofBadge({ locale = 'en' }: { locale?: Locale }) {
  const count = useReportCount();
  if (count == null) return null;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-600">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-brand-pine opacity-75"></span>
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-pine"></span>
      </span>
      {COPY[locale].badge(fmt(count))}
    </div>
  );
}
