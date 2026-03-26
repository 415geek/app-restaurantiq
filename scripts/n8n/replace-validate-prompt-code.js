/**
 * 粘贴到 n8n「Code」节点（替换无法安装的 Validate+Prompt）。
 * 入参与 app 一致：address, industry, cuisine_type, language（见 lib/n8n.ts）。
 * 自托管请在 n8n 环境变量中设置 OPENAI_API_KEY（Settings → Variables 或进程 env）。
 *
 * 下游：若已有 OpenAI 节点，可只输出 prompt；本示例在 Code 内直接请求 OpenAI 并返回 verdict/headline/reason。
 */
const item = $input.first().json;
const body = item.body && typeof item.body === 'object' ? item.body : item;

const address = String(body.address ?? '').trim();
const cuisine = String(body.cuisine_type ?? '').trim();
const language = body.language === 'zh' ? 'zh' : 'en';

const outputLanguageInstruction =
  language === 'zh'
    ? 'Output language MUST be Simplified Chinese. Keep verdict in Chinese too.'
    : 'Output language MUST be English.';

const userPrompt = `You are a brutally honest restaurant consultant.

Your job is to make a decision, not describe data.

Given a restaurant location and business type, decide:

1. Will this restaurant likely succeed, fail, or be risky?
2. Give one short emotional headline.
3. Give one concise reason.
4. Be direct and conversion-oriented.
5. ${outputLanguageInstruction}

Location: ${address}
Business type: ${cuisine || 'Not specified'}

Return valid JSON only with keys: verdict, headline, reason.
Example shape: {"verdict":"risky","headline":"...","reason":"..."}`;

const apiKey = $env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY in n8n environment variables');
}

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: userPrompt }],
  }),
});

if (!res.ok) {
  const t = await res.text();
  throw new Error(`OpenAI HTTP ${res.status}: ${t.slice(0, 500)}`);
}

const data = await res.json();
const text = data.choices?.[0]?.message?.content;
if (!text) throw new Error('Empty OpenAI response');

const parsed = JSON.parse(text);
const verdict = String(parsed.verdict ?? '').trim();
const headline = String(parsed.headline ?? '').trim();
const reason = String(parsed.reason ?? '').trim();

if (!verdict || !headline || !reason) {
  throw new Error('Invalid JSON: need verdict, headline, reason');
}

return [
  {
    json: {
      verdict,
      headline,
      reason,
      analysis_id: body.analysis_id ?? '',
    },
  },
];
