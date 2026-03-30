import { NextResponse } from 'next/server';
import { iqInsertReport } from '@/lib/funnel/iq-repository';
import { gatherIqMarketDataFromGoogle } from '@/lib/funnel/iq-market-data';
import { runPartialAnalysis } from '@/lib/funnel/iq-llm';
import { analyzeWithN8n } from '@/lib/n8n';
import { unknownErrorMessage } from '@/lib/unknown-error-message';

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
        return NextResponse.json({
          reportId: '',
          verdict: 'mock',
          headline: language === 'zh' ? '谨慎推进' : 'Proceed with caution',
          subheadline: language === 'zh' 
            ? '此为模拟数据，请配置分析服务以获取真实结果。' 
            : 'This is mock data. Configure analysis provider for real results.',
          market_snapshot: [
            language === 'zh' ? '竞争密度：未知' : 'Competition density: Unknown',
            language === 'zh' ? '需求模式：未知' : 'Demand pattern: Unknown',
            language === 'zh' ? '价格带：未知' : 'Price band: Unknown',
          ],
          hidden_risk: language === 'zh' 
            ? '未配置分析服务，无法识别真实风险。' 
            : 'Analysis not configured, cannot identify real risks.',
          paywall_teaser: language === 'zh' 
            ? '配置 N8N 或 OpenAI 以解锁完整分析能力。' 
            : 'Configure N8N or OpenAI to unlock full analysis capabilities.',
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
    let usedN8n = false;
    try {
      if (hasN8nWebhook) {
        parsed = await analyzeWithN8n({
          address: location,
          industry: 'restaurant',
          cuisine_type: businessType || undefined,
          language,
        });
        usedN8n = true;
      } else {
        parsed = await runPartialAnalysis({ location, businessType, language });
      }
    } catch (n8nErr) {
      if (hasN8nWebhook && hasOpenAiKey) {
        console.warn('[funnel/analyze] n8n analyze failed, falling back to OpenAI:', n8nErr);
        parsed = await runPartialAnalysis({ location, businessType, language });
        usedN8n = false;
      } else {
        throw n8nErr;
      }
    }

    const verdict = String(parsed.verdict ?? '').trim();
    const headline = String(parsed.headline ?? '').trim();
    const subheadline = String(parsed.subheadline ?? '').trim();
    const marketSnapshot = Array.isArray(parsed.market_snapshot) 
      ? parsed.market_snapshot.map(s => String(s ?? '').trim()).filter(Boolean)
      : [];
    const hiddenRisk = String(parsed.hidden_risk ?? '').trim();
    const paywallTeaser = String(parsed.paywall_teaser ?? '').trim();

    if (!verdict || !headline) {
      return NextResponse.json({ error: 'Invalid analysis response from provider' }, { status: 502 });
    }

    let marketDataJson: Record<string, unknown> | null = null;
    const fromN8n = parsed.market_data;
    if (fromN8n && typeof fromN8n === 'object' && !Array.isArray(fromN8n)) {
      marketDataJson = fromN8n as Record<string, unknown>;
    } else if (!usedN8n) {
      marketDataJson = await gatherIqMarketDataFromGoogle({
        location,
        businessType: businessType || 'restaurant',
      });
    }

    let reportId = '';
    try {
      reportId = await iqInsertReport({
        location,
        businessType: businessType || null,
        verdict,
        headline,
        reason: subheadline || hiddenRisk,
        language,
        marketDataJson: marketDataJson ?? undefined,
      });
    } catch (err) {
      const isDevLike = process.env.NODE_ENV !== 'production';
      const message = err instanceof Error ? err.message : String(err);
      if (!isDevLike || !message.includes('Supabase admin env is not configured')) {
        throw err;
      }
    }

    return NextResponse.json({
      reportId,
      verdict,
      headline,
      subheadline,
      market_snapshot: marketSnapshot,
      hidden_risk: hiddenRisk,
      paywall_teaser: paywallTeaser,
    });
  } catch (e) {
    console.error('[funnel/analyze]', e);
    return NextResponse.json(
      {
        error: 'Failed to analyze location',
        detail: unknownErrorMessage(e, 500),
      },
      { status: 500 },
    );
  }
}
