/**
 * Optional web search enrichment for IQ reports (Tavily).
 * Set TAVILY_API_KEY on the server; omitted → no-op.
 *
 * Two modes:
 * - fetchTavilyMarketResearch: quick search (existing)
 * - fetchTavilyDeepResearch: full research report via /research endpoint (new)
 */

export type TavilySnippet = { title: string; url: string; snippet: string };

export type WebResearchPack = {
  provider: 'tavily';
  fetched_at: string;
  query: string;
  answer?: string;
  snippets: TavilySnippet[];
};

/** Deep research structured output — matches output_schema sent to Tavily */
export type DeepResearchReport = {
  executive_summary: string;
  site_suitability_verdict: 'highly_suitable' | 'suitable' | 'marginal' | 'not_suitable';
  site_suitability_rationale: string;
  demographic_analysis: {
    population_estimate: string;
    median_income_estimate: string;
    age_distribution_notes: string;
    spending_power_assessment: string;
  };
  trade_area_analysis: {
    primary_radius_mi: string;
    secondary_radius_mi: string;
    foot_traffic_assessment: string;
    parking_and_access_notes: string;
  };
  competition_analysis: {
    direct_competitors: Array<{ name: string; distance: string; threat_level: string; notes: string }>;
    indirect_competitors: Array<{ name: string; category: string; distance: string }>;
    market_saturation_level: string;
    whitespace_opportunities: string;
  };
  rent_and_real_estate: {
    estimated_rent_range_usd: string;
    comparable_listings: Array<{ address: string; sqft: string; rent_usd: string; source: string }>;
    lease_market_notes: string;
  };
  alternative_locations?: Array<{
    address_or_corridor: string;
    why_better: string;
    estimated_rent_usd: string;
    current_listings: string;
  }>;
  risks: Array<{ risk: string; severity: string; mitigation: string }>;
  opportunities: string[];
  data_sources_cited: string[];
};

export type DeepResearchPack = {
  provider: 'tavily_deep_research';
  model: 'mini' | 'pro';
  fetched_at: string;
  input_prompt: string;
  request_id: string;
  response_time_sec: number;
  report: DeepResearchReport | null;
  report_raw?: string;
  sources: Array<{ title: string; url: string }>;
  status: 'completed' | 'failed' | 'timeout';
  error?: string;
};

const DEEP_RESEARCH_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 5_000;

function buildDeepResearchPrompt(location: string, businessType: string, lang: 'en' | 'zh'): string {
  const biz = businessType || (lang === 'zh' ? '餐厅' : 'restaurant');
  if (lang === 'zh') {
    return `你是麦肯锡的顶级商业分析专家，也是商业数据收集与分析专家，还是商业选址专家。

我给你提供一个地址和我想开的 business 类型，你基于这两个数据，去用你的经验去深度分析这个地址是否适合做这个 business，为什么？需要有全方位数据做支撑。

相反如果不适合，那么基于我给出的地址，在哪里附近找怎样的位置比较合适，为什么？最好能提供目前正在放租的相关信息。

分析完给我一份完整版的选址分析报告。

地址：${location}
业态：${biz}

请搜索并分析以下维度：
1. 该地址的人口统计数据（人口、收入、年龄分布）
2. 该区域的商业环境与客流情况
3. 周边 1-3 英里内的直接和间接竞争对手
4. 该区域的租金水平和正在放租的商铺
5. 如果该地址不适合，推荐的替代位置及其优势
6. 主要风险和机会点`;
  }

  return `You are a McKinsey-level commercial real estate and site selection expert with deep expertise in restaurant and retail business analysis.

I am providing you with an address and the type of business I want to open. Based on these two inputs, conduct a comprehensive analysis to determine whether this location is suitable for this business, and why. Your analysis must be supported by real data.

If the location is NOT suitable, recommend alternative locations nearby that would be better suited, explain why, and provide any currently available commercial listings if possible.

Deliver a complete site selection analysis report.

Address: ${location}
Business Type: ${biz}

Please research and analyze:
1. Demographic data for this address (population, income levels, age distribution)
2. Commercial environment and foot traffic patterns in the area
3. Direct and indirect competitors within 1-3 miles
4. Rent levels and currently available commercial listings in the area
5. If this location is unsuitable, recommend alternative locations with their advantages
6. Key risks and opportunities`;
}

function buildDeepResearchSchema(): Record<string, unknown> {
  return {
    properties: {
      executive_summary: {
        type: 'string',
        description: 'A 2-3 paragraph executive summary of the site selection analysis, including the verdict and key supporting data points.',
      },
      site_suitability_verdict: {
        type: 'string',
        description: 'Overall suitability verdict: highly_suitable, suitable, marginal, or not_suitable.',
      },
      site_suitability_rationale: {
        type: 'string',
        description: 'Detailed explanation of why the site is or is not suitable, with specific data references.',
      },
      demographic_analysis: {
        type: 'object',
        description: 'Demographic analysis of the trade area.',
        properties: {
          population_estimate: { type: 'string', description: 'Estimated population within 1-3 mile radius with source.' },
          median_income_estimate: { type: 'string', description: 'Estimated median household income with source.' },
          age_distribution_notes: { type: 'string', description: 'Notes on age distribution and target demographic fit.' },
          spending_power_assessment: { type: 'string', description: 'Assessment of local spending power for this business type.' },
        },
      },
      trade_area_analysis: {
        type: 'object',
        description: 'Trade area and accessibility analysis.',
        properties: {
          primary_radius_mi: { type: 'string', description: 'Primary trade area radius in miles.' },
          secondary_radius_mi: { type: 'string', description: 'Secondary trade area radius in miles.' },
          foot_traffic_assessment: { type: 'string', description: 'Assessment of foot traffic patterns and volumes.' },
          parking_and_access_notes: { type: 'string', description: 'Notes on parking availability and site accessibility.' },
        },
      },
      competition_analysis: {
        type: 'object',
        description: 'Competitive landscape analysis.',
        properties: {
          direct_competitors: {
            type: 'array',
            description: 'List of direct competitors within 1-2 miles.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Competitor name.' },
                distance: { type: 'string', description: 'Distance from subject address.' },
                threat_level: { type: 'string', description: 'Threat level: high, medium, or low.' },
                notes: { type: 'string', description: 'Brief notes on this competitor.' },
              },
            },
          },
          indirect_competitors: {
            type: 'array',
            description: 'List of indirect competitors (different category but competing for same customers).',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Competitor name.' },
                category: { type: 'string', description: 'Business category.' },
                distance: { type: 'string', description: 'Distance from subject address.' },
              },
            },
          },
          market_saturation_level: { type: 'string', description: 'Assessment of market saturation: low, moderate, high, oversaturated.' },
          whitespace_opportunities: { type: 'string', description: 'Identified gaps or whitespace in the competitive landscape.' },
        },
      },
      rent_and_real_estate: {
        type: 'object',
        description: 'Commercial real estate and rent analysis.',
        properties: {
          estimated_rent_range_usd: { type: 'string', description: 'Estimated monthly rent range for comparable spaces.' },
          comparable_listings: {
            type: 'array',
            description: 'Currently available commercial listings nearby.',
            items: {
              type: 'object',
              properties: {
                address: { type: 'string', description: 'Listing address or description.' },
                sqft: { type: 'string', description: 'Square footage.' },
                rent_usd: { type: 'string', description: 'Monthly rent in USD.' },
                source: { type: 'string', description: 'Source of listing (e.g., LoopNet, Crexi, broker).' },
              },
            },
          },
          lease_market_notes: { type: 'string', description: 'Notes on the local commercial lease market conditions.' },
        },
      },
      alternative_locations: {
        type: 'array',
        description: 'Alternative locations if the subject address is not ideal.',
        items: {
          type: 'object',
          properties: {
            address_or_corridor: { type: 'string', description: 'Alternative address or commercial corridor.' },
            why_better: { type: 'string', description: 'Why this alternative is better suited.' },
            estimated_rent_usd: { type: 'string', description: 'Estimated monthly rent.' },
            current_listings: { type: 'string', description: 'Any current listings or availability notes.' },
          },
        },
      },
      risks: {
        type: 'array',
        description: 'Key risks identified for this location.',
        items: {
          type: 'object',
          properties: {
            risk: { type: 'string', description: 'Risk description.' },
            severity: { type: 'string', description: 'Severity: high, medium, or low.' },
            mitigation: { type: 'string', description: 'Suggested mitigation strategy.' },
          },
        },
      },
      opportunities: {
        type: 'array',
        description: 'Key opportunities identified.',
        items: { type: 'string' },
      },
      data_sources_cited: {
        type: 'array',
        description: 'List of data sources referenced in the analysis.',
        items: { type: 'string' },
      },
    },
    required: [
      'executive_summary',
      'site_suitability_verdict',
      'site_suitability_rationale',
      'demographic_analysis',
      'trade_area_analysis',
      'competition_analysis',
      'rent_and_real_estate',
      'risks',
      'opportunities',
      'data_sources_cited',
    ],
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tavily Deep Research — creates a research task and polls until completion.
 * Returns a structured report matching DeepResearchReport schema.
 * Falls back to raw content string if structured parsing fails.
 */
export async function fetchTavilyDeepResearch(input: {
  location: string;
  businessType: string;
  lang?: 'en' | 'zh';
  model?: 'mini' | 'pro';
}): Promise<DeepResearchPack | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  const loc = input.location.trim();
  if (!loc) return null;

  const lang = input.lang ?? 'en';
  const model = input.model ?? 'pro';
  const prompt = buildDeepResearchPrompt(loc, input.businessType, lang);
  const schema = buildDeepResearchSchema();

  const startTime = Date.now();

  try {
    const createRes = await fetch('https://api.tavily.com/research', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: prompt,
        model,
        stream: false,
        output_schema: schema,
        citation_format: 'numbered',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => '');
      console.warn('[tavily-deep] create failed', createRes.status, errText.slice(0, 300));
      return null;
    }

    const createData = (await createRes.json()) as {
      request_id?: string;
      status?: string;
    };

    const requestId = createData.request_id;
    if (!requestId) {
      console.warn('[tavily-deep] no request_id in response');
      return null;
    }

    console.log('[tavily-deep] research task created:', requestId, 'model:', model);

    while (Date.now() - startTime < DEEP_RESEARCH_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(`https://api.tavily.com/research/${requestId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      const pollData = (await pollRes.json()) as {
        status?: string;
        content?: string | DeepResearchReport;
        sources?: Array<{ title?: string; url?: string }>;
        response_time?: number;
      };

      if (pollRes.status === 202 || pollData.status === 'pending' || pollData.status === 'in_progress') {
        console.log('[tavily-deep] polling...', pollData.status);
        continue;
      }

      if (!pollRes.ok && pollRes.status !== 200) {
        console.warn('[tavily-deep] poll error', pollRes.status);
        return {
          provider: 'tavily_deep_research',
          model,
          fetched_at: new Date().toISOString(),
          input_prompt: prompt,
          request_id: requestId,
          response_time_sec: Math.round((Date.now() - startTime) / 1000),
          report: null,
          sources: [],
          status: 'failed',
          error: `Poll failed: ${pollRes.status}`,
        };
      }

      if (pollData.status === 'failed') {
        return {
          provider: 'tavily_deep_research',
          model,
          fetched_at: new Date().toISOString(),
          input_prompt: prompt,
          request_id: requestId,
          response_time_sec: Math.round((Date.now() - startTime) / 1000),
          report: null,
          sources: [],
          status: 'failed',
          error: 'Research task failed',
        };
      }

      if (pollData.status === 'completed') {
        const sources = (pollData.sources ?? []).map((s) => ({
          title: String(s.title ?? '').trim() || 'Source',
          url: String(s.url ?? '').trim(),
        }));

        let report: DeepResearchReport | null = null;
        let reportRaw: string | undefined;

        if (typeof pollData.content === 'object' && pollData.content !== null) {
          report = pollData.content as DeepResearchReport;
        } else if (typeof pollData.content === 'string') {
          reportRaw = pollData.content;
          try {
            report = JSON.parse(pollData.content) as DeepResearchReport;
          } catch {
            console.log('[tavily-deep] content is string, not JSON — keeping as raw');
          }
        }

        console.log('[tavily-deep] completed in', Math.round((Date.now() - startTime) / 1000), 'sec');

        return {
          provider: 'tavily_deep_research',
          model,
          fetched_at: new Date().toISOString(),
          input_prompt: prompt,
          request_id: requestId,
          response_time_sec: Math.round((Date.now() - startTime) / 1000),
          report,
          report_raw: reportRaw,
          sources,
          status: 'completed',
        };
      }

      console.log('[tavily-deep] unexpected status:', pollData.status);
    }

    console.warn('[tavily-deep] timeout after', DEEP_RESEARCH_TIMEOUT_MS / 1000, 'sec');
    return {
      provider: 'tavily_deep_research',
      model,
      fetched_at: new Date().toISOString(),
      input_prompt: prompt,
      request_id: requestId,
      response_time_sec: Math.round((Date.now() - startTime) / 1000),
      report: null,
      sources: [],
      status: 'timeout',
      error: `Timeout after ${DEEP_RESEARCH_TIMEOUT_MS / 1000} seconds`,
    };
  } catch (e) {
    console.warn('[tavily-deep] error', e);
    return null;
  }
}

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

/**
 * Convert DeepResearchPack into a comprehensive context block for LLM prompts.
 * This provides rich, structured data from Tavily's deep research.
 */
export function summarizeDeepResearchForAnchors(
  pack: DeepResearchPack | null | undefined,
  lang: 'en' | 'zh' = 'en'
): string {
  if (!pack || pack.status !== 'completed') return '';
  
  const lines: string[] = [];
  const L = lang === 'zh';

  lines.push(L ? '## Tavily 深度研究报告' : '## Tavily Deep Research Report');
  lines.push(L ? `模型: ${pack.model} | 耗时: ${pack.response_time_sec}秒` : `Model: ${pack.model} | Time: ${pack.response_time_sec}s`);
  lines.push('');

  if (pack.report) {
    const r = pack.report;

    lines.push(L ? '### 执行摘要' : '### Executive Summary');
    lines.push(r.executive_summary || (L ? '(无)' : '(none)'));
    lines.push('');

    lines.push(L ? '### 选址判定' : '### Site Suitability Verdict');
    const verdictMap: Record<string, string> = L
      ? { highly_suitable: '非常适合', suitable: '适合', marginal: '边缘', not_suitable: '不适合' }
      : { highly_suitable: 'Highly Suitable', suitable: 'Suitable', marginal: 'Marginal', not_suitable: 'Not Suitable' };
    lines.push(`**${verdictMap[r.site_suitability_verdict] || r.site_suitability_verdict}**`);
    lines.push(r.site_suitability_rationale || '');
    lines.push('');

    if (r.demographic_analysis) {
      const d = r.demographic_analysis;
      lines.push(L ? '### 人口统计分析' : '### Demographic Analysis');
      lines.push(L ? `- 人口估计: ${d.population_estimate}` : `- Population: ${d.population_estimate}`);
      lines.push(L ? `- 收入中位数: ${d.median_income_estimate}` : `- Median Income: ${d.median_income_estimate}`);
      lines.push(L ? `- 年龄分布: ${d.age_distribution_notes}` : `- Age Distribution: ${d.age_distribution_notes}`);
      lines.push(L ? `- 消费力评估: ${d.spending_power_assessment}` : `- Spending Power: ${d.spending_power_assessment}`);
      lines.push('');
    }

    if (r.trade_area_analysis) {
      const t = r.trade_area_analysis;
      lines.push(L ? '### 贸易区分析' : '### Trade Area Analysis');
      lines.push(L ? `- 主要半径: ${t.primary_radius_mi}` : `- Primary Radius: ${t.primary_radius_mi}`);
      lines.push(L ? `- 次要半径: ${t.secondary_radius_mi}` : `- Secondary Radius: ${t.secondary_radius_mi}`);
      lines.push(L ? `- 客流评估: ${t.foot_traffic_assessment}` : `- Foot Traffic: ${t.foot_traffic_assessment}`);
      lines.push(L ? `- 停车与通达: ${t.parking_and_access_notes}` : `- Parking & Access: ${t.parking_and_access_notes}`);
      lines.push('');
    }

    if (r.competition_analysis) {
      const c = r.competition_analysis;
      lines.push(L ? '### 竞争分析' : '### Competition Analysis');
      lines.push(L ? `- 市场饱和度: ${c.market_saturation_level}` : `- Market Saturation: ${c.market_saturation_level}`);
      lines.push(L ? `- 空白机会: ${c.whitespace_opportunities}` : `- Whitespace: ${c.whitespace_opportunities}`);
      
      if (c.direct_competitors?.length) {
        lines.push(L ? '\n**直接竞争者:**' : '\n**Direct Competitors:**');
        c.direct_competitors.slice(0, 6).forEach((comp) => {
          lines.push(`  - ${comp.name} (${comp.distance}) - ${L ? '威胁' : 'Threat'}: ${comp.threat_level}${comp.notes ? ` — ${comp.notes}` : ''}`);
        });
      }

      if (c.indirect_competitors?.length) {
        lines.push(L ? '\n**间接竞争者:**' : '\n**Indirect Competitors:**');
        c.indirect_competitors.slice(0, 4).forEach((comp) => {
          lines.push(`  - ${comp.name} (${comp.category}, ${comp.distance})`);
        });
      }
      lines.push('');
    }

    if (r.rent_and_real_estate) {
      const re = r.rent_and_real_estate;
      lines.push(L ? '### 租金与房产' : '### Rent & Real Estate');
      lines.push(L ? `- 租金范围: ${re.estimated_rent_range_usd}` : `- Rent Range: ${re.estimated_rent_range_usd}`);
      lines.push(L ? `- 市场状况: ${re.lease_market_notes}` : `- Market Notes: ${re.lease_market_notes}`);
      
      if (re.comparable_listings?.length) {
        lines.push(L ? '\n**当前放租:**' : '\n**Current Listings:**');
        re.comparable_listings.slice(0, 5).forEach((lst) => {
          lines.push(`  - ${lst.address}: ${lst.sqft} sqft, ${lst.rent_usd}/mo (${lst.source})`);
        });
      }
      lines.push('');
    }

    if (r.alternative_locations?.length) {
      lines.push(L ? '### 替代位置建议' : '### Alternative Locations');
      r.alternative_locations.slice(0, 4).forEach((alt, i) => {
        lines.push(`${i + 1}. **${alt.address_or_corridor}**`);
        lines.push(`   ${L ? '优势' : 'Why'}: ${alt.why_better}`);
        lines.push(`   ${L ? '租金' : 'Rent'}: ${alt.estimated_rent_usd}`);
        if (alt.current_listings) lines.push(`   ${L ? '放租' : 'Listings'}: ${alt.current_listings}`);
      });
      lines.push('');
    }

    if (r.risks?.length) {
      lines.push(L ? '### 风险' : '### Risks');
      r.risks.slice(0, 5).forEach((risk) => {
        lines.push(`- **${risk.risk}** (${risk.severity}) — ${L ? '缓解' : 'Mitigation'}: ${risk.mitigation}`);
      });
      lines.push('');
    }

    if (r.opportunities?.length) {
      lines.push(L ? '### 机会' : '### Opportunities');
      r.opportunities.slice(0, 5).forEach((opp) => {
        lines.push(`- ${opp}`);
      });
      lines.push('');
    }
  } else if (pack.report_raw) {
    lines.push(L ? '### 研究报告（原文）' : '### Research Report (Raw)');
    lines.push(pack.report_raw.slice(0, 3000));
    if (pack.report_raw.length > 3000) lines.push('...(truncated)');
    lines.push('');
  }

  if (pack.sources?.length) {
    lines.push(L ? '### 数据来源' : '### Sources');
    pack.sources.slice(0, 10).forEach((s, i) => {
      lines.push(`[${i + 1}] ${s.title} — ${s.url}`);
    });
  }

  return lines.join('\n');
}
