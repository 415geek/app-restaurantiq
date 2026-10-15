'use client';

/**
 * v4 §1.5 — the professional-pass notice on the 360° page.
 *
 * The page used to promise "the in-depth edition will replace this
 * automatically" and then nothing visible ever changed. This watches the
 * generation status and says only what is true: nothing while no upgrade was
 * scheduled; "in progress" while the pass runs; a reload when the prose was
 * actually rewritten; and a plain sentence when it failed or changed nothing.
 */
import { useEffect, useState } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { ui } from '@/components/iq/ui';

type Upgrade = 'scheduled' | 'running' | 'ready' | 'no_change' | 'failed' | null;

const COPY: Record<Locale, Record<Exclude<Upgrade, null>, string>> = {
  zh: {
    scheduled: '深度版正在排队生成（通常再需 5–10 分钟）。完成后本页会自动刷新；如果失败，这里会说明。',
    running: '深度版正在生成：联网检索与评论分析会补进各页文字，数字不变。完成后本页自动刷新。',
    ready: '深度版已就绪，正在刷新…',
    no_change: '深度版已跑完，但这个地址没有拿到额外的检索证据，正文与标准版相同——你看到的就是最终版。',
    failed: '深度版生成失败，当前显示的标准版即为最终版；数字不受影响。',
  },
  en: {
    scheduled: 'The in-depth edition is queued (usually 5–10 more minutes). This page reloads when it lands; if it fails, you will read that here.',
    running: 'The in-depth edition is being written: web research and review analysis are folded into the page text; the numbers do not change. This page reloads when it is ready.',
    ready: 'The in-depth edition is ready — reloading…',
    no_change: 'The in-depth pass ran but found no additional evidence for this address, so the text is the same as the standard edition — what you see is final.',
    failed: 'The in-depth edition could not be generated; the standard edition shown here is final and the numbers are unaffected.',
  },
  es: {
    scheduled: 'La edición a fondo está en cola (normalmente 5–10 minutos más). Esta página se recarga cuando esté lista; si falla, lo leerás aquí.',
    running: 'La edición a fondo se está redactando: la investigación web y el análisis de reseñas se incorporan al texto; las cifras no cambian. La página se recarga al terminar.',
    ready: 'La edición a fondo está lista; recargando…',
    no_change: 'La pasada a fondo se ejecutó pero no encontró evidencia adicional para esta dirección; el texto es el de la edición estándar, que es la definitiva.',
    failed: 'No se pudo generar la edición a fondo; la edición estándar que ves es la definitiva y las cifras no cambian.',
  },
};

export function UpgradeWatch({ reportId, lang, narrativePass }: { reportId: string; lang: Locale; narrativePass: string | null }) {
  const [upgrade, setUpgrade] = useState<Upgrade>(null);
  useEffect(() => {
    if (narrativePass === 'llm-pro') return; // already the in-depth edition: nothing to say
    let cancelled = false;
    const startedAt = Date.now();
    (async () => {
      while (!cancelled && Date.now() - startedAt < 20 * 60_000) {
        const s = (await fetch(`/api/funnel/full-report/status?reportId=${encodeURIComponent(reportId)}`, { cache: 'no-store' })
          .then((r) => r.json())
          .catch(() => null)) as { upgrade?: Upgrade; legacy?: boolean } | null;
        if (cancelled) return;
        const u = s?.upgrade ?? null;
        setUpgrade(u);
        if (u === 'ready') {
          setTimeout(() => window.location.reload(), 800);
          return;
        }
        if (!u || u === 'failed' || u === 'no_change' || s?.legacy) return;
        await new Promise((r) => setTimeout(r, 8_000));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportId, narrativePass]);

  if (!upgrade) return null;
  const tone = upgrade === 'failed' ? ui.pill.clay : upgrade === 'no_change' ? ui.pill.neutral : ui.pill.steel;
  return (
    <p className={`report-viewer-chrome mx-auto mt-4 w-full max-w-[203.9mm] rounded-xl border px-4 py-3 text-sm ${tone}`} role="status" data-upgrade={upgrade}>
      {COPY[lang][upgrade]}
    </p>
  );
}
