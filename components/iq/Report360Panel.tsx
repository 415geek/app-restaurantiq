'use client';

/**
 * Shown under the legacy report while the 360° model is still missing: polls
 * the status, kicks generation once, and reloads the page as soon as the model
 * lands so the reader gets the 360° document (app/iq/report/[id]) without a click.
 *
 * Loop guard: if the very first poll already says "ready" (the page rendered
 * without a model, so the stored model is unrenderable, or generation finished
 * in the SSR → poll window) we reload once per session and, on a second
 * occurrence, fall back to the PDF / print links instead of reloading forever.
 */
import { useCallback } from 'react';
import type { Locale } from '@/lib/i18n/locale';
import { useReport360Generation } from '@/components/iq/useReport360Generation';
import { ui } from '@/components/iq/ui';

type Copy = {
  title: string;
  desc: string;
  generating: string;
  migration: string;
  ready: string;
  download: string;
  preview: string;
  failed: string;
  timeout: string;
};

const T: Record<Locale, Copy> = {
  zh: {
    title: '360° 专业版报告',
    desc: '步行与开车四个范围的商圈 · 需求分流测算 · 四层竞争关系 · 自洽财务模型 · 六维评分 · 真实地图 · 老板总结。浅色打印版 15 页，每个数字都可追溯到公开数据来源。',
    generating: '正在生成（约 1–3 分钟，可离开页面稍后回来）…生成完成后本页会自动刷新。',
    migration: '数据库尚未升级（迁移 0009）。请在 Vercel 设置 DATABASE_URL 后重新生成，系统会自动完成迁移。',
    ready: '已生成',
    download: '下载 360° PDF',
    preview: '在线预览',
    failed: '生成失败，请稍后重试。',
    timeout: '生成超时，请稍后刷新页面。',
  },
  en: {
    title: '360° Professional Report',
    desc: 'Four-ring trade area · demand capture · four competitive layers · reconciled finance model · six-dimension score · real map · owner summary. 15 print-ready pages; every number traces back to a public source.',
    generating: 'Generating (1–3 min; you can leave and come back)… this page refreshes automatically when it is ready.',
    migration: 'Database not upgraded yet (migration 0009). Set DATABASE_URL on Vercel and regenerate — the migration runs automatically.',
    ready: 'Ready',
    download: 'Download the 360° PDF',
    preview: 'Preview online',
    failed: 'Generation failed. Please try again later.',
    timeout: 'Generation timed out. Please refresh the page later.',
  },
  es: {
    title: 'Informe profesional 360°',
    desc: 'Área comercial de cuatro anillos · captura de demanda · cuatro capas competitivas · modelo financiero conciliado · puntuación en seis dimensiones · mapa real · resumen para el dueño. 15 páginas listas para imprimir; cada cifra se rastrea hasta una fuente pública.',
    generating: 'Generando (1–3 min; puedes salir y volver después)… esta página se actualiza sola cuando esté listo.',
    migration: 'La base de datos aún no está actualizada (migración 0009). Configura DATABASE_URL en Vercel y vuelve a generar; la migración se ejecuta automáticamente.',
    ready: 'Listo',
    download: 'Descargar PDF 360°',
    preview: 'Vista previa en línea',
    failed: 'La generación falló. Inténtalo de nuevo más tarde.',
    timeout: 'La generación tardó demasiado. Actualiza la página más tarde.',
  },
};

function reloadOnceKey(reportId: string): string {
  return `iq360-reloaded:${reportId}`;
}

export function Report360Panel({ reportId, lang = 'en' }: { reportId: string; lang?: Locale }) {
  const t = T[lang];

  const onReady = useCallback(
    () => {
      if (typeof window === 'undefined') return;
      let reloadedBefore = false;
      try {
        const key = reloadOnceKey(reportId);
        const at = Number(sessionStorage.getItem(key) ?? 0);
        reloadedBefore = Date.now() - at < 5 * 60_000;
        if (!reloadedBefore) sessionStorage.setItem(key, String(Date.now()));
      } catch {
        /* storage unavailable: reload anyway */
      }
      if (!reloadedBefore) window.location.reload();
    },
    [reportId],
  );

  const { status, error } = useReport360Generation({
    reportId,
    pollOnMount: true,
    autoKick: true,
    onReady,
    failedMessage: t.failed,
    timeoutMessage: t.timeout,
  });

  const pdfUrl = `/api/iq/report/${encodeURIComponent(reportId)}/pdf?lang=${lang}`;
  const printUrl = `/print/${encodeURIComponent(reportId)}?lang=${lang}`;

  return (
    <div className={`${ui.card} p-6`}>
      <h3 className="mb-1 text-lg font-semibold tracking-tight text-brand-navy">{t.title}</h3>
      <p className="mb-4 text-sm text-zinc-600">{t.desc}</p>
      {status?.migration_needed ? (
        <p className="text-xs text-amber-800" role="alert">
          {t.migration}
        </p>
      ) : status?.ready ? (
        /* Reached only when the reload guard tripped: the stored model exists but this page could not render it. */
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${ui.pill.green}`}>{t.ready}</span>
          <a href={pdfUrl} className={`${ui.btnPrimary} py-2.5`}>
            {t.download}
          </a>
          <a href={printUrl} target="_blank" rel="noopener" className={`${ui.btnSecondary} py-2.5`}>
            {t.preview}
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-zinc-600">
          <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t.generating}
        </div>
      )}
      {error ? (
        <p className="mt-3 text-xs text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
