/**
 * Transactional email for "your report is ready" — Resend REST API (no SDK).
 *
 * Env:
 *   RESEND_API_KEY   — required to enable the feature
 *   IQ_EMAIL_FROM    — verified sender, e.g. "RestaurantIQ <reports@restaurantiq.ai>"
 */

import { envValue } from '@/lib/env-value';
import { getPublicBaseUrl } from '@/lib/funnel/base-url';

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

export async function sendReportReadyEmail(input: {
  to: string;
  reportId: string;
  location: string;
  headline: string;
  lang: 'en' | 'zh';
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = envValue('RESEND_API_KEY');
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const from = envValue('IQ_EMAIL_FROM') || 'RestaurantIQ <reports@restaurantiq.ai>';
  const url = `${getPublicBaseUrl()}/iq/report/${encodeURIComponent(input.reportId)}`;
  const zh = input.lang === 'zh';
  const subject = zh
    ? `您的选址风险审计报告已生成 — ${input.location}`
    : `Your site risk audit is ready — ${input.location}`;
  const text = zh
    ? `您的完整选址报告已生成完毕。\n\n地址：${input.location}\n结论：${input.headline}\n\n查看报告：${url}\n\n— RestaurantIQ`
    : `Your full site report is ready.\n\nAddress: ${input.location}\nVerdict: ${input.headline}\n\nOpen the report: ${url}\n\n— RestaurantIQ`;
  const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b">
  <h2 style="margin:0 0 12px;font-size:20px">${zh ? '您的选址风险审计报告已生成' : 'Your site risk audit is ready'}</h2>
  <p style="margin:0 0 6px;color:#52525b;font-size:14px">${escapeHtml(input.location)}</p>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(input.headline)}</p>
  <a href="${url}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${zh ? '查看完整报告' : 'Open full report'}</a>
  <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa">${zh ? '若按钮无法点击，请复制链接：' : 'If the button does not work, copy this link:'}<br>${url}</p>
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
