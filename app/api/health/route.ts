import { NextRequest, NextResponse } from 'next/server';
import { integrationEnvStatus } from '@/lib/env';
import { getAnalyzeWebhookUrl } from '@/lib/n8n';
import { unknownErrorMessage } from '@/lib/unknown-error-message';
import type { AnthropicDiagnostic } from '@/lib/funnel/llm/anthropic-client';

export const runtime = 'nodejs';
/** The iq-full-report probe runs the real generation pipeline. */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const service = req.nextUrl.searchParams.get('service') as keyof typeof integrationEnvStatus | null;
  const probe = req.nextUrl.searchParams.get('probe');

  if (probe === 'iq-supabase') {
    try {
      const { supabaseAdmin } = await import('@/lib/server/supabase-admin');
      const sb = supabaseAdmin();
      const { error } = await sb.from('iq_location_reports').select('id').limit(1);
      return NextResponse.json({
        ok: !error,
        error: error?.message ?? null,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: unknownErrorMessage(e, 300),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (probe === 'iq-llm') {
    // Report resolved LLM routing (providers + models only — never secrets).
    try {
      const { resolveIqRoute } = await import('@/lib/funnel/iq-provider-router');
      const partial = resolveIqRoute('iq_partial');
      const full = resolveIqRoute('iq_full');
      return NextResponse.json({
        ok: Boolean(partial && full),
        keys: {
          anthropic: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
          mimo: Boolean(process.env.MIMO_API_KEY?.trim()),
          openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
        },
        partial: partial ? { provider: partial.provider, model: partial.model } : null,
        full: full ? { provider: full.provider, model: full.model } : null,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: unknownErrorMessage(e, 300),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (probe === 'iq-claude') {
    // Live Claude call matrix. The free/partial path works while the paid full
    // path fails, and the two differ only in model, thinking flag and token
    // cap — so probe those axes directly instead of guessing. Prompts are
    // trivial (a few tokens) so this is cheap; max_tokens is only a ceiling.
    try {
      const { runAnthropicJson } = await import('@/lib/funnel/llm/anthropic-client');
      const { resolveIqRoute } = await import('@/lib/funnel/iq-provider-router');
      const fullRoute = resolveIqRoute('iq_full');

      const variants: Array<{
        label: string;
        model: string;
        effort: 'low' | 'medium' | 'high';
        disableThinking: boolean;
        maxTokens: number;
      }> = [
        // Mirrors the working partial path — the control.
        {
          label: 'partial-equivalent',
          model: process.env.ANTHROPIC_IQ_PARTIAL_MODEL?.trim() || 'claude-opus-5',
          effort: 'low',
          disableThinking: false,
          maxTokens: 4_096,
        },
        // Mirrors the failing lean full-report path exactly.
        {
          label: 'full-lean',
          model: process.env.ANTHROPIC_IQ_FULL_LEAN_MODEL?.trim() || 'claude-sonnet-5',
          effort: 'low',
          disableThinking: true,
          maxTokens: 16_000,
        },
        // Same as full-lean but with thinking left on — isolates the flag.
        {
          label: 'full-lean-thinking-on',
          model: process.env.ANTHROPIC_IQ_FULL_LEAN_MODEL?.trim() || 'claude-sonnet-5',
          effort: 'low',
          disableThinking: false,
          maxTokens: 16_000,
        },
        // The quality path's model/effort — isolates the model.
        {
          label: 'full-quality',
          model: fullRoute?.model || 'claude-opus-5',
          effort: 'medium',
          disableThinking: false,
          maxTokens: 16_000,
        },
      ];

      const results = await Promise.all(
        variants.map(async (v) => {
          const diag: AnthropicDiagnostic = {};
          const out = await runAnthropicJson({
            model: v.model,
            system: 'You are a JSON generator.',
            user: 'Return {"ok":true}',
            maxTokens: v.maxTokens,
            effort: v.effort,
            disableThinking: v.disableThinking,
            timeoutMs: 45_000,
            diag,
          });
          return { label: v.label, returned: Boolean(out), diag };
        }),
      );

      return NextResponse.json({
        ok: results.every((r) => r.returned),
        resolvedFullRoute: fullRoute
          ? { provider: fullRoute.provider, model: fullRoute.model }
          : null,
        fallbackKeys: {
          mimo: Boolean(process.env.MIMO_API_KEY?.trim()),
          openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
        },
        results,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: unknownErrorMessage(e, 400),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (probe === 'iq-full-report') {
    // Reproduce the paid pipeline against a stored report and return the real
    // failure. The iq-claude matrix proves the API and parameters are fine, so
    // whatever breaks only shows up with the actual prompt — which means the
    // actual prompt has to be run.
    const reportId = req.nextUrl.searchParams.get('reportId');
    if (!reportId) {
      return NextResponse.json({ ok: false, error: 'Missing reportId' }, { status: 400 });
    }
    const startedAt = Date.now();
    try {
      const { iqGetReport } = await import('@/lib/funnel/iq-repository');
      const { runFullPremiumReport } = await import('@/lib/funnel/iq-llm');
      const report = await iqGetReport(reportId);
      if (!report) {
        return NextResponse.json({ ok: false, error: 'Report not found' }, { status: 404 });
      }
      const marketData =
        (report.market_data_json as Record<string, unknown> | null) ?? undefined;
      const out = await runFullPremiumReport({
        location: report.location,
        businessType: report.business_type,
        headline: report.headline,
        reason: report.reason,
        marketData,
        language: report.language === 'zh' ? 'zh' : 'en',
        leanGeneration: true,
        timeoutMs: 240_000,
      });
      return NextResponse.json({
        ok: true,
        durationMs: Date.now() - startedAt,
        marketDataChars: marketData ? JSON.stringify(marketData).length : 0,
        provider: (out as Record<string, unknown>)._generation_provider ?? null,
        model: (out as Record<string, unknown>)._generation_model ?? null,
        reportChars: JSON.stringify(out).length,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      return NextResponse.json({
        ok: false,
        durationMs: Date.now() - startedAt,
        // The whole point of this probe: the unmasked provider-level cause.
        error: unknownErrorMessage(e, 1200),
        stack: e instanceof Error ? (e.stack ?? '').split('\n').slice(0, 6).join(' | ') : null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (probe === 'iq-n8n') {
    const url = getAnalyzeWebhookUrl();
    if (!url) {
      return NextResponse.json({
        ok: false,
        reason: 'N8N analyze webhook URL not configured',
        timestamp: new Date().toISOString(),
      });
    }
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep raw for debug */
    }
    const secret =
      process.env.N8N_IQ_WEBHOOK_SECRET?.trim() || process.env.N8N_INTERNAL_AUTH_TOKEN?.trim();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ address: 'probe', industry: 'restaurant', language: 'en' }),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      return NextResponse.json({
        ok: res.ok,
        host,
        status: res.status,
        bodyPreview: text.slice(0, 120),
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const cause = e instanceof Error && e.cause !== undefined ? unknownErrorMessage(e.cause, 200) : undefined;
      return NextResponse.json({
        ok: false,
        host,
        error: unknownErrorMessage(e, 300),
        ...(cause ? { cause } : {}),
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (!service) {
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: integrationEnvStatus,
      iqN8n: {
        configured: Boolean(getAnalyzeWebhookUrl()),
        host: (() => {
          const u = getAnalyzeWebhookUrl();
          if (!u) return null;
          try {
            return new URL(u).host;
          } catch {
            return 'invalid_url';
          }
        })(),
      },
    });
  }

  const configured = integrationEnvStatus[service];
  if (configured) {
    return NextResponse.json({ status: 'connected', detail: `${service} configuration detected.`, timestamp: new Date().toISOString() });
  }
  return NextResponse.json({ status: 'missing', detail: `${service} is not configured in env. Mock fallback active if supported.`, timestamp: new Date().toISOString() });
}
