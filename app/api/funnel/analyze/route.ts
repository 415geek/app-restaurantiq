import { NextResponse } from 'next/server';
import { iqInsertReport } from '@/lib/funnel/iq-repository';
import { resolveMarketDataForIqReport } from '@/lib/funnel/iq-market-data-resolve';
import { buildFreeTierMarketBrief } from '@/lib/funnel/iq-premium-anchors';
import { runPartialAnalysis } from '@/lib/funnel/iq-llm';
import { analyzeWithN8n, getAnalyzeWebhookUrl } from '@/lib/n8n';
import { unknownErrorMessage } from '@/lib/unknown-error-message';

export const runtime = 'nodejs';
type AnalysisLanguage = 'en' | 'zh';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      location?: string;
      businessType?: string;
      language?: string;
      monthlyRentUsd?: number | string;
      sqft?: number | string;
    };
    const location = String(body.location ?? '').trim();
    const businessType = String(body.businessType ?? '').trim();
    const monthlyRentUsd = body.monthlyRentUsd != null ? Number(body.monthlyRentUsd) : undefined;
    const sqft = body.sqft != null ? Number(body.sqft) : undefined;
    const userInputs =
      (Number.isFinite(monthlyRentUsd) && monthlyRentUsd! > 0) ||
      (Number.isFinite(sqft) && sqft! > 0)
        ? {
            ...(Number.isFinite(monthlyRentUsd) && monthlyRentUsd! > 0
              ? { monthly_rent_usd: monthlyRentUsd }
              : {}),
            ...(Number.isFinite(sqft) && sqft! > 0 ? { sqft } : {}),
          }
        : undefined;
    const language: AnalysisLanguage = String(body.language ?? 'en').toLowerCase() === 'zh' ? 'zh' : 'en';

    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 });
    }

    if (location.length > 500) {
      return NextResponse.json({ error: 'Location is too long' }, { status: 400 });
    }

    const hasN8nWebhook = Boolean(getAnalyzeWebhookUrl());
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

    let prefetchedMarket: Record<string, unknown> | null = null;
    try {
      prefetchedMarket =
        (await resolveMarketDataForIqReport({
          existing: null,
          location,
          businessType: businessType || 'restaurant',
          isPremium: false,
          lang: language,
        })) ?? null;
    } catch (prefetchErr) {
      console.warn('[funnel/analyze] market prefetch failed, continuing:', prefetchErr);
    }
    const freeBrief = buildFreeTierMarketBrief(prefetchedMarket, language);

    let parsed: Awaited<ReturnType<typeof analyzeWithN8n>>;
    try {
      if (hasN8nWebhook) {
        parsed = await analyzeWithN8n({
          address: location,
          industry: 'restaurant',
          cuisine_type: businessType || undefined,
          language,
          ...(prefetchedMarket && Object.keys(prefetchedMarket).length > 0
            ? {
                market_data: {
                  ...prefetchedMarket,
                  ...(userInputs ? { user_inputs: userInputs } : {}),
                },
              }
            : userInputs
              ? { market_data: { user_inputs: userInputs } }
              : {}),
        });
      } else {
        parsed = await runPartialAnalysis({
          location,
          businessType,
          language,
          marketDataBrief: freeBrief,
          monthlyRentUsd:
            Number.isFinite(monthlyRentUsd) && monthlyRentUsd! > 0 ? monthlyRentUsd : undefined,
          sqft: Number.isFinite(sqft) && sqft! > 0 ? sqft : undefined,
        });
      }
    } catch (n8nErr) {
      if (hasN8nWebhook && hasOpenAiKey) {
        console.warn('[funnel/analyze] n8n analyze failed, falling back to OpenAI:', n8nErr);
        parsed = await runPartialAnalysis({
          location,
          businessType,
          language,
          marketDataBrief: freeBrief,
          monthlyRentUsd:
            Number.isFinite(monthlyRentUsd) && monthlyRentUsd! > 0 ? monthlyRentUsd : undefined,
          sqft: Number.isFinite(sqft) && sqft! > 0 ? sqft : undefined,
          openAiOnly: true,
        });
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

    let marketSeed: Record<string, unknown> | null = null;
    const fromN8n = parsed.market_data;
    if (fromN8n && typeof fromN8n === 'object' && !Array.isArray(fromN8n)) {
      marketSeed = { ...(prefetchedMarket ?? {}), ...(fromN8n as Record<string, unknown>) };
    } else if (prefetchedMarket && Object.keys(prefetchedMarket).length > 0) {
      marketSeed = { ...prefetchedMarket };
    }

    let marketDataJson: Record<string, unknown> | null = null;
    try {
      marketDataJson = await resolveMarketDataForIqReport({
        existing:
          userInputs && marketSeed
            ? { ...marketSeed, user_inputs: userInputs }
            : userInputs
              ? { user_inputs: userInputs }
              : marketSeed,
        location,
        businessType: businessType || 'restaurant',
        isPremium: false,
        lang: language,
      });
    } catch (mergeErr) {
      console.warn('[funnel/analyze] post-analyze market merge failed:', mergeErr);
      marketDataJson = marketSeed;
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
      const message = err instanceof Error ? err.message : String(err);
      const missingAdmin = message.includes('Supabase admin env is not configured');
      if (process.env.NODE_ENV === 'production' && !missingAdmin) {
        console.error('[funnel/analyze] iqInsertReport failed (non-fatal):', message);
        // Analysis already succeeded — do not fail the user-facing response when persistence fails.
        reportId = '';
      } else if (process.env.NODE_ENV !== 'production' && missingAdmin) {
        reportId = '';
      } else {
        throw err;
      }
    }
    const decisionTier = String((parsed as { decision_tier?: string }).decision_tier ?? '').trim();
    const riskAuditPreview = (parsed as { risk_audit_preview?: unknown }).risk_audit_preview;

    return NextResponse.json({
      reportId,
      verdict,
      headline,
      subheadline,
      market_snapshot: marketSnapshot,
      hidden_risk: hiddenRisk,
      paywall_teaser: paywallTeaser,
      ...(decisionTier ? { decision_tier: decisionTier } : {}),
      ...(riskAuditPreview && typeof riskAuditPreview === 'object'
        ? { risk_audit_preview: riskAuditPreview }
        : {}),
    });
  } catch (e) {
    const cause =
      e instanceof Error && e.cause !== undefined ? unknownErrorMessage(e.cause, 300) : undefined;
    console.error('[funnel/analyze]', e, cause ? { cause } : '');
    return NextResponse.json(
      {
        error: 'Failed to analyze location',
        detail: unknownErrorMessage(e, 500),
        ...(cause ? { cause } : {}),
      },
      { status: 500 },
    );
  }
}
