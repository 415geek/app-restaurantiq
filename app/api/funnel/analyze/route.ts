import { NextResponse } from 'next/server';
import { iqInsertReport } from '@/lib/funnel/iq-repository';
import { runPartialAnalysis } from '@/lib/funnel/iq-llm';
import { analyzeWithN8n } from '@/lib/n8n';

export const runtime = 'nodejs';
type AnalysisLanguage = 'en' | 'zh';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { location?: string; businessType?: string; language?: string };
    const location = String(body.location ?? '').trim();
    const businessType = String(body.businessType ?? '').trim();
    const language: AnalysisLanguage = String(body.language ?? 'en').toLowerCase() === 'zh' ? 'zh' : 'en';

    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    if (location.length > 500) {
      return NextResponse.json({ error: 'Location is too long' }, { status: 400 });
    }

    const hasN8nWebhook = Boolean(
      process.env.N8N_ANALYZE_WEBHOOK_URL?.trim() || process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim()
    );
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
    if (!hasN8nWebhook && !hasOpenAiKey) {
      const isDevLike = process.env.NODE_ENV !== 'production';
      const allowMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
      if (isDevLike || allowMock) {
        const headline = language === 'zh' ? '谨慎推进' : 'Proceed with caution';
        const reason =
          language === 'zh'
            ? '当前服务器尚未配置分析服务，此结果为本地开发环境的模拟输出。请配置 N8N_IQ_ANALYZE_WEBHOOK_URL 或 OPENAI_API_KEY 以启用真实分析。'
            : 'Analysis provider is not configured on this server, so this is a mock result for local development only. Configure N8N_IQ_ANALYZE_WEBHOOK_URL or OPENAI_API_KEY to enable real analysis.';
        return NextResponse.json({
          reportId: '',
          verdict: 'mock',
          headline,
          reason,
        });
      }
      return NextResponse.json(
        {
          error:
            'Analysis is not configured. Set N8N_IQ_ANALYZE_WEBHOOK_URL (preferred) or OPENAI_API_KEY on the server, then retry.',
        },
        { status: 503 }
      );
    }

    let parsed: Awaited<ReturnType<typeof analyzeWithN8n>>;
    try {
      parsed = hasN8nWebhook
        ? await analyzeWithN8n({
            address: location,
            industry: 'restaurant',
            cuisine_type: businessType || undefined,
            language,
          })
        : await runPartialAnalysis({ location, businessType, language });
    } catch (n8nErr) {
      // If n8n returns empty body / non-JSON or errors, fall back to OpenAI when configured.
      if (hasN8nWebhook && hasOpenAiKey) {
        console.warn('[funnel/analyze] n8n analyze failed, falling back to OpenAI:', n8nErr);
        parsed = await runPartialAnalysis({ location, businessType, language });
      } else {
        throw n8nErr;
      }
    }

    const verdict = String(parsed.verdict ?? '').trim();
    const headline = String(parsed.headline ?? '').trim();
    const reason = String(parsed.reason ?? '').trim();
    if (!verdict || !headline || !reason) {
      return NextResponse.json({ error: 'Invalid analysis response from provider' }, { status: 502 });
    }

    let reportId = '';
    try {
      reportId = await iqInsertReport({
        location,
        businessType: businessType || null,
        verdict,
        headline,
        reason,
      });
    } catch (err) {
      const isDevLike = process.env.NODE_ENV !== 'production';
      const message = err instanceof Error ? err.message : String(err);
      // In local development, allow analysis to succeed even if Supabase admin env is missing.
      if (!isDevLike || !message.includes('Supabase admin env is not configured')) {
        throw err;
      }
    }

    return NextResponse.json({
      reportId,
      verdict,
      headline,
      reason,
    });
  } catch (e) {
    console.error('[funnel/analyze]', e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: 'Failed to analyze location',
        detail: message.slice(0, 500),
      },
      { status: 500 },
    );
  }
}
