'use client';

import { useEffect, useRef, useState } from 'react';

type Status = {
  ready: boolean;
  tier: string | null;
  generated_at: string | null;
  cost_usd: number | null;
  total: number | null;
  verdict: string | null;
  migration_needed?: boolean;
  precheck_reasons?: string[];
};

const T = {
  zh: {
    title: '360° 专业版报告（新引擎）',
    desc: '四圈层商圈 · Huff 需求捕获 · 四层竞争关系 · 自洽财务模型 · 六维评分。浅色打印版 14 页，每个数字都可追溯到数据来源。',
    generating: '正在生成（约 1–3 分钟，可离开页面稍后回来）…',
    ready: '已生成',
    precheck: '预检版：数据完整性未达付费交付标准，报告中已列出原因。',
    migration: '数据库尚未升级（迁移 0009）。请在 Vercel 设置 DATABASE_URL 后重新生成，系统会自动完成迁移。',
    download: '下载 360° PDF',
    preview: '在线预览',
    regen: '重新生成',
    score: '综合分',
    verdict: { GO: '可做', CONDITIONAL_GO: '有条件可做', NO_GO: '不建议' } as Record<string, string>,
    failed: '生成失败，请稍后重试。',
  },
  en: {
    title: '360° Professional Report (new engine)',
    desc: 'Four-ring trade area · Huff demand capture · four competitive layers · reconciled finance model · six-dimension score. 14 print-ready pages; every number traces to a source.',
    generating: 'Generating (1–3 min; you can leave and come back)…',
    ready: 'Ready',
    precheck: 'Pre-check version: data completeness is below the paid standard; reasons are listed in the report.',
    migration: 'Database not upgraded yet (migration 0009). Set DATABASE_URL on Vercel and regenerate — the migration runs automatically.',
    download: 'Download 360° PDF',
    preview: 'Preview online',
    regen: 'Regenerate',
    score: 'Score',
    verdict: { GO: 'GO', CONDITIONAL_GO: 'CONDITIONAL GO', NO_GO: 'NO GO' } as Record<string, string>,
    failed: 'Generation failed, please retry later.',
  },
};

export function Report360Panel({ reportId, lang = 'en' }: { reportId: string; lang?: 'en' | 'zh' }) {
  const t = T[lang];
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kicked = useRef(false);

  const load = async (): Promise<Status | null> => {
    try {
      const res = await fetch(`/api/iq/report360/${encodeURIComponent(reportId)}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const j = (await res.json()) as Status;
      setStatus(j);
      return j;
    } catch {
      return null;
    }
  };

  const kick = async (force = false) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/iq/report360/${encodeURIComponent(reportId)}${force ? '?force=1' : ''}`, { method: 'POST' });
      if (!res.ok && res.status !== 202) setError(t.failed);
    } catch {
      setError(t.failed);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      const s = await load();
      if (stopped) return;
      if (s && !s.ready && !s.migration_needed && !kicked.current) {
        kicked.current = true;
        await kick(false);
      }
      if (!s || !s.ready) timer = setTimeout(tick, s?.migration_needed ? 30_000 : 6_000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const pdfUrl = `/api/iq/report/${encodeURIComponent(reportId)}/pdf?lang=${lang}`;
  const printUrl = `/print/${encodeURIComponent(reportId)}`;

  return (
    <div className="rounded-2xl border border-sky-900/40 bg-sky-950/20 p-6">
      <h3 className="mb-1 text-lg font-semibold text-sky-100">{t.title}</h3>
      <p className="mb-4 text-sm text-sky-200/70">{t.desc}</p>
      {status?.migration_needed ? (
        <p className="text-xs text-amber-300/90" role="alert">
          {t.migration}
        </p>
      ) : status?.ready ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm text-sky-100">
            <span className="rounded-full border border-sky-700/60 bg-sky-900/40 px-2 py-0.5 text-xs">{t.ready}</span>
            {status.total != null ? (
              <span>
                {t.score} <strong>{status.total}</strong>
                {status.verdict ? ` · ${t.verdict[status.verdict] ?? status.verdict}` : ''}
              </span>
            ) : null}
            {status.tier === 'precheck' ? <span className="text-xs text-amber-300/90">{t.precheck}</span> : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={pdfUrl} className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-sky-950 transition hover:bg-sky-400">
              {t.download}
            </a>
            <a href={printUrl} target="_blank" rel="noopener" className="rounded-xl border border-sky-700/60 px-5 py-2.5 text-sm text-sky-100 transition hover:bg-sky-900/40">
              {t.preview}
            </a>
            <button type="button" onClick={() => void kick(true)} disabled={busy} className="rounded-xl border border-sky-800/60 px-4 py-2.5 text-xs text-sky-300 disabled:opacity-50">
              {t.regen}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-sm text-sky-200/80">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {t.generating}
        </div>
      )}
      {error ? (
        <p className="mt-3 text-xs text-amber-400/90" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
