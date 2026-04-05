/**
 * Optional web search enrichment for IQ reports (Tavily).
 * Set TAVILY_API_KEY on the server; omitted → no-op.
 */

export type TavilySnippet = { title: string; url: string; snippet: string };

export type WebResearchPack = {
  provider: 'tavily';
  fetched_at: string;
  query: string;
  answer?: string;
  snippets: TavilySnippet[];
};

export async function fetchTavilyMarketResearch(input: {
  location: string;
  businessType: string;
}): Promise<WebResearchPack | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  const loc = input.location.trim();
  const biz = (input.businessType || 'restaurant').trim();
  if (!loc) return null;

  const query = [
    biz,
    'restaurant',
    loc,
    'demographics foot traffic competition retail rent commercial corridor',
  ].join(' ');

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        max_results: 10,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      console.warn('[tavily] HTTP', res.status, await res.text().then((t) => t.slice(0, 200)));
      return null;
    }

    const raw = (await res.json()) as {
      answer?: string;
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };

    const snippets: TavilySnippet[] = (raw.results ?? [])
      .map((r) => ({
        title: String(r.title ?? '').trim() || 'Result',
        url: String(r.url ?? '').trim(),
        snippet: String(r.content ?? '').trim().slice(0, 900),
      }))
      .filter((s) => s.url && s.snippet);

    if (snippets.length === 0 && !raw.answer?.trim()) return null;

    return {
      provider: 'tavily',
      fetched_at: new Date().toISOString(),
      query,
      answer: raw.answer?.trim() || undefined,
      snippets,
    };
  } catch (e) {
    console.warn('[tavily] failed', e);
    return null;
  }
}

/** Stored shape under market_data_json.web_research */
export function summarizeWebResearchForAnchors(pack: WebResearchPack | null | undefined): string {
  if (!pack?.snippets?.length && !pack?.answer) return '';
  const lines: string[] = [];
  if (pack.answer) lines.push(`Answer: ${pack.answer}`);
  pack.snippets.slice(0, 8).forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} — ${s.snippet.slice(0, 320)}${s.snippet.length > 320 ? '…' : ''} (${s.url})`);
  });
  return lines.join('\n');
}
