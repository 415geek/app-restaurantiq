/**
 * Transactional email for "your report is ready" — Resend REST API (no SDK).
 *
 * Env:
 *   RESEND_API_KEY   — required to enable the feature
 *   IQ_EMAIL_FROM    — verified sender, e.g. "RestaurantIQ <reports@restaurantiq.ai>"
 */

import { envValue } from '@/lib/env-value';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';
import { toLocale, type Locale } from '@/lib/i18n/locale';

export function isReportEmailConfigured(): boolean {
  return Boolean(envValue('RESEND_API_KEY'));
}

export function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 200;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COPY: Record<
  Locale,
  {
    subject: (location: string) => string;
    heading: string;
    text: (location: string, headline: string, url: string) => string;
    address: string;
    verdict: string;
    open: string;
    fallback: string;
  }
> = {
  en: {
    subject: (l) => `Your site risk audit is ready — ${l}`,
    heading: 'Your site risk audit is ready',
    text: (l, h, url) => `Your full site report is ready.\n\nAddress: ${l}\nVerdict: ${h}\n\nOpen the report: ${url}\n\n— RestaurantIQ`,
    address: 'Address',
    verdict: 'Verdict',
    open: 'Open the full report',
    fallback: 'If the button does not work, copy this link:',
  },
  zh: {
    subject: (l) => `您的选址风险审计报告已生成 — ${l}`,
    heading: '您的选址风险审计报告已生成',
    text: (l, h, url) => `您的完整选址报告已生成完毕。\n\n地址：${l}\n结论：${h}\n\n查看报告：${url}\n\n— RestaurantIQ`,
    address: '地址',
    verdict: '结论',
    open: '查看完整报告',
    fallback: '若按钮无法点击，请复制链接：',
  },
  es: {
    subject: (l) => `Tu auditoría de riesgo de ubicación está lista — ${l}`,
    heading: 'Tu auditoría de riesgo de ubicación está lista',
    text: (l, h, url) => `Tu informe completo de ubicación está listo.\n\nDirección: ${l}\nVeredicto: ${h}\n\nAbrir el informe: ${url}\n\n— RestaurantIQ`,
    address: 'Dirección',
    verdict: 'Veredicto',
    open: 'Abrir el informe completo',
    fallback: 'Si el botón no funciona, copia este enlace:',
  },
};

export async function sendReportReadyEmail(input: {
  to: string;
  reportId: string;
  location: string;
  headline: string;
  lang: Locale | string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = envValue('RESEND_API_KEY');
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const from = envValue('IQ_EMAIL_FROM') || 'RestaurantIQ <reports@restaurantiq.ai>';
  const lang = toLocale(input.lang);
  const t = COPY[lang];
  const url = `${getPublicBaseUrl()}/iq/report/${encodeURIComponent(input.reportId)}?lang=${lang}`;
  const subject = t.subject(input.location);
  const text = t.text(input.location, input.headline, url);
  const html = `
<div lang="${lang}" style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <h2 style="margin:0 0 12px;font-size:20px">${t.heading}</h2>
  <p style="margin:0 0 6px;color:#52525b;font-size:14px">${escapeHtml(input.location)}</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(input.headline)}</p>
  <a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${t.open}</a>
  <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa">${t.fallback}<br>${url}</p>
</div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [input.to], subject, text, html }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: `resend ${res.status}: ${body.message ?? 'unknown error'}` };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
