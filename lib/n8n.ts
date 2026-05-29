type N8nAnalyzeInput = {
  address: string;
  industry: 'restaurant' | 'retail' | 'service' | 'cafe';
  cuisine_type?: string;
  budget_range?: string;
  target_audience?: string;
  language?: 'en' | 'zh';
  /** Optional: server pre-fetched Places/ACS pack so the workflow can skip duplicate fetches or enrich the LLM. */
  market_data?: Record<string, unknown>;
};

type N8nAnalyzeOutput = {
  analysis_id?: string;
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
  /** Populated when Analyze workflow merges GatherMarketData.external_data (Google + Yelp). */
  market_data?: Record<string, unknown>;
  reason?: string;
  tension_type?: string;
  preview?: Record<string, unknown>;
};

type N8nFullReportInput = {
  analysis_id?: string;
  address: string;
  industry: string;
  cuisine_type?: string;
  budget_range?: string;
  target_audience?: string;
  language?: 'en' | 'zh';
  market_data?: Record<string, unknown>;
  /** Free-tier headline — anchors paid V2.0 report continuity */
  headline?: string;
  /** Free-tier rationale text */
  reason?: string;
};

/** Aligns with iq-full-report-schema + ReportContent (LocationIQ V2 deep premium). */
type N8nFullReportOutput = Record<string, unknown>;

import { envValue } from '@/lib/env-value';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Must match workflow Code nodes: N8N_IQ_WEBHOOK_SECRET first, then N8N_INTERNAL_AUTH_TOKEN. */
function getN8nToken(): string | null {
  return envValue('N8N_IQ_WEBHOOK_SECRET') || envValue('N8N_INTERNAL_AUTH_TOKEN');
}

function buildHeaders(): HeadersInit {
  const token = getN8nToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? `: ${e.cause.message}` : '';
    throw new Error(`n8n webhook request failed for ${url}${cause}`, { cause: e });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`n8n webhook failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      'n8n webhook returned an empty body. Check the workflow "Respond to Webhook" node (e.g. response body should be ={{ $json }}).',
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`n8n webhook returned non-JSON response: ${trimmed.slice(0, 200)}`);
  }
}

/**
 * Force-OpenAI override:
 *   IQ_USE_OPENAI=1 / true   → ignore n8n analyze + full-report webhooks
 *   IQ_PROVIDER=openai       → same effect
 * Useful for testing new prompt changes locally without pushing to n8n.
 */
function isOpenAiForced(): boolean {
  const flag = envValue('IQ_USE_OPENAI');
  if (flag && /^(1|true|yes|on)$/i.test(flag)) return true;
  const provider = envValue('IQ_PROVIDER');
  return provider != null && /^openai$/i.test(provider);
}

export function getAnalyzeWebhookUrl(): string | null {
  if (isOpenAiForced()) return null;
  // Prefer N8N_IQ_* — legacy N8N_ANALYZE_* entries were sometimes pasted with JSON quotes.
  return envValue('N8N_IQ_ANALYZE_WEBHOOK_URL') || envValue('N8N_ANALYZE_WEBHOOK_URL');
}

/** Exported so funnel code can align n8n vs OpenAI fallback without duplicating env names. */
export function getFullReportWebhookUrl(): string | null {
  if (isOpenAiForced()) return null;
  return envValue('N8N_IQ_FULL_REPORT_WEBHOOK_URL') || envValue('N8N_FULL_REPORT_WEBHOOK_URL');
}

/** When MiMo is the in-repo primary, prefer the app LLM pipeline over a legacy n8n full-report webhook. */
export function shouldUseN8nForIqFullReport(): boolean {
  if (isOpenAiForced()) return false;
  if (!getFullReportWebhookUrl()) return false;
  const primary = envValue('IQ_PRIMARY_PROVIDER')?.toLowerCase();
  if (primary === 'mimo') return false;
  return true;
}

export async function analyzeWithN8n(input: N8nAnalyzeInput): Promise<N8nAnalyzeOutput> {
  const webhookUrl = getAnalyzeWebhookUrl();
  if (!webhookUrl) {
    throw new Error('N8N analyze webhook is not configured');
  }
  return postJson<N8nAnalyzeOutput>(webhookUrl, input);
}

export async function generateFullReportWithN8n(
  input: N8nFullReportInput
): Promise<N8nFullReportOutput> {
  const webhookUrl = getFullReportWebhookUrl();
  if (!webhookUrl) {
    throw new Error('N8N full-report webhook is not configured');
  }
  return postJson<N8nFullReportOutput>(webhookUrl, input);
}

