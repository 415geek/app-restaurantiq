type N8nAnalyzeInput = {
  address: string;
  industry: 'restaurant' | 'retail' | 'service' | 'cafe';
  cuisine_type?: string;
  budget_range?: string;
  target_audience?: string;
  language?: 'en' | 'zh';
};

type N8nAnalyzeOutput = {
  analysis_id?: string;
  verdict: string;
  headline: string;
  subheadline?: string;
  market_snapshot?: string[];
  hidden_risk?: string;
  paywall_teaser?: string;
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
};

type N8nFullReportOutput = {
  revenue_estimate?: Record<string, unknown> | string;
  top_3_risks?: unknown[];
  top_3_opportunities?: unknown[];
  action_plan?: string[];
  confidence?: string;
  share_preview?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function getN8nToken(): string | null {
  return process.env.N8N_INTERNAL_AUTH_TOKEN?.trim() || process.env.N8N_IQ_WEBHOOK_SECRET?.trim() || null;
}

function buildHeaders(): HeadersInit {
  const token = getN8nToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

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

function getAnalyzeWebhookUrl(): string | null {
  return (
    process.env.N8N_ANALYZE_WEBHOOK_URL?.trim() ||
    process.env.N8N_IQ_ANALYZE_WEBHOOK_URL?.trim() ||
    null
  );
}

function getFullReportWebhookUrl(): string | null {
  return (
    process.env.N8N_FULL_REPORT_WEBHOOK_URL?.trim() ||
    process.env.N8N_IQ_FULL_REPORT_WEBHOOK_URL?.trim() ||
    null
  );
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

