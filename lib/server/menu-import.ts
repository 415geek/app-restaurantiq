import { generateNovaCompletion } from '@/lib/server/aws-nova-client';
import { runOpenAIJsonSchema } from '@/lib/server/openai-json';
import { extractPdfText } from '@/lib/iq/render/pdf';

export type ImportedMenuItem = {
  name: string;
  category?: string;
  price?: number;
};

const parseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['name'],
      },
    },
  },
  required: ['items'],
};

function sanitizeText(input: string) {
  return input
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 50_000);
}

function safeUrlOrNull(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return null;

    // Basic SSRF guard (private ranges + link-local)
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return null;
    if (/^169\.254\./.test(host)) return null;

    return url;
  } catch {
    return null;
  }
}

async function fetchHtmlTextFromUrl(url: URL): Promise<string> {
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'RestaurantIQ Menu Importer',
      Accept: 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`fetch_failed_${res.status}`);
  }

  const html = await res.text();
  // Strip scripts/styles, then tags.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ');

  return sanitizeText(stripped);
}

function heuristicParse(text: string): ImportedMenuItem[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 600);

  const items: ImportedMenuItem[] = [];
  let currentCategory: string | undefined;

  for (const line of lines) {
    if (line.length <= 2) continue;

    // Category heuristics
    if (line.length < 24 && !/\d/.test(line) && /[A-Za-z\u4e00-\u9fff]/.test(line)) {
      currentCategory = line;
      continue;
    }

    const priceMatch = line.match(/([$￥¥€])\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    const plainPriceMatch = !priceMatch ? line.match(/\b([0-9]+(?:\.[0-9]{1,2})?)\b\s*$/) : null;
    const priceRaw = priceMatch?.[2] ?? plainPriceMatch?.[1];
    const price = priceRaw ? Number(priceRaw) : undefined;

    if (!price || !Number.isFinite(price) || price <= 0) continue;

    const name = line
      .replace(/([$￥¥€])\s*([0-9]+(?:\.[0-9]{1,2})?)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!name || name.length < 2) continue;

    items.push({
      name,
      category: currentCategory,
      price,
    });

    if (items.length >= 120) break;
  }

  return items;
}

async function llmParse(text: string): Promise<ImportedMenuItem[]> {
  const prompt = `You are a restaurant menu extraction assistant.

Extract menu items from the text below.
Return JSON with this shape: { "items": [{"name": string, "category"?: string, "price"?: number}] }

Rules:
- Deduplicate obvious duplicates.
- If price is missing, omit it.
- Keep categories short.
- Return ONLY JSON.

TEXT:\n${text}`;

  const openai = await runOpenAIJsonSchema<{ items: ImportedMenuItem[] }>({
    prompt,
    schemaName: 'menu_extract',
    schema: parseSchema,
    maxOutputTokens: 2500,
    temperature: 0.2,
  });

  if (openai?.items?.length) return openai.items;

  try {
    const raw = await generateNovaCompletion(prompt, { temperature: 0.2, maxTokens: 2500 });
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { items?: ImportedMenuItem[] };
    if (Array.isArray(parsed.items) && parsed.items.length) return parsed.items;
  } catch {
    // ignore
  }

  return [];
}

export async function parseMenuFromPdf(bytes: Uint8Array): Promise<{ items: ImportedMenuItem[]; warnings: string[] }> {
  // pdf-parse 2.x is a class, not a function; the shared helper knows the shape.
  const text = sanitizeText((await extractPdfText(Buffer.from(bytes))) || '');
  if (!text.trim()) {
    return { items: [], warnings: ['pdf_text_empty'] };
  }

  const llmItems = await llmParse(text);
  if (llmItems.length) return { items: llmItems, warnings: [] };

  const heuristic = heuristicParse(text);
  return {
    items: heuristic,
    warnings: heuristic.length ? ['llm_unavailable_used_heuristic'] : ['parse_failed'],
  };
}

export async function parseMenuFromUrl(rawUrl: string): Promise<{ items: ImportedMenuItem[]; warnings: string[]; extractedText: string }> {
  const url = safeUrlOrNull(rawUrl);
  if (!url) {
    return { items: [], warnings: ['invalid_url'], extractedText: '' };
  }

  const text = await fetchHtmlTextFromUrl(url);
  const llmItems = await llmParse(text);
  if (llmItems.length) return { items: llmItems, warnings: [], extractedText: text };

  const heuristic = heuristicParse(text);
  return {
    items: heuristic,
    warnings: heuristic.length ? ['llm_unavailable_used_heuristic'] : ['parse_failed'],
    extractedText: text,
  };
}