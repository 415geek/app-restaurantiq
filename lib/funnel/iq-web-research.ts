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

const DEEP_RESEARCH_TIMEOUT_MS = 300_000; // 5 minutes for pro model deep research
const POLL_INTERVAL_MS = 5_000;

function buildDeepResearchPrompt(location: string, businessType: string, lang: 'en' | 'zh'): string {
  const biz = businessType || (lang === 'zh' ? '餐厅' : 'restaurant');
  if (lang === 'zh') {
    return `你是麦肯锡的顶级商业分析专家，拥有15年餐饮选址与商业地产经验。你的分析报告曾帮助数百家餐厅做出正确的选址决策。

地址：${location}
业态：${biz}

【核心任务】
写一份像样本报告那样的深度选址分析——不是填表式回答，而是**叙事型咨询报告**，每个判断都要有数据支撑和来源标注。

【必须搜索并回答的问题】

**1. 该地址为何可行/不可行（结构性分析）**
- 该物业目前是什么状态？是否在出租？现租户是谁？
- 该街道/道路的特性（车道数、限速、车流量、是否为干道）
- 历史上该地址或相似位置的餐厅成功/失败案例
- 周边正在进行或计划中的市政工程（道路施工、轻轨建设等）

**2. 人口与消费力（必须含具体数字+来源）**
- 该邮编区(zip code)的总人口、华裔/亚裔占比
- 家庭年收入中位数（精确到美元），25-44岁收入中位数
- 超过$200k收入的家庭占比
- 在家使用非英语语言的比例

**3. 竞争空白分析**
- 该业态（${biz}）在周边1-3英里内有几家？列出店名
- 整个城市/湾区有几家同类专门店？是否存在"零竞争"空白？
- 已关闭的同类竞品——关闭原因是什么？（如：出品质量差、选址错误）
- 周边同价格带($10-20)的快餐竞品密度

**4. 食材经济学（针对${biz}）**
- 主要食材的批发成本（$/磅）
- 典型的食材成本占营收比例
- 与同类业态相比，成本结构优势/劣势

**5. 替代选址（必须含具体铺位信息）**
如果该地址不适合，推荐附近3条商业走廊，每条须含：
- 走廊名称及其特点（步行评分、轻轨、华裔聚集度）
- **正在放租的具体铺位**：地址、面积(sqft)、月租金($)、来源(LoopNet/Craigslist/中介)
- 如无法找到具体房源，标注[需实地考察]并说明下一步

**6. 盈亏平衡估算**
- 假设月租$X，需要多少月营收才能盈亏平衡
- 按客单价$Y，日均需完成多少单
- 预计几个月可达盈亏平衡

【输出要求】
- 每个数据点必须标注来源：[Census]、[Yelp]、[Wikipedia]、[Caltrans]、[LoopNet]、[Google Maps]、[检索]、[估算]
- 竞品必须用真实店名，不要用"竞品A/B/C"
- 价格/数字必须精确，如"$152,587"而非"约15万"
- 失败案例要说明具体教训`;
  }

  return `You are a McKinsey-level commercial real estate expert with 15 years of restaurant site selection experience. Your analysis reports have helped hundreds of restaurants make correct location decisions.

Address: ${location}
Business Type: ${biz}

【CORE TASK】
Write a deep site selection analysis like a premium consulting report—not a form-fill exercise, but a **narrative consulting report** where every judgment is supported by data with source citations.

【QUESTIONS YOU MUST RESEARCH AND ANSWER】

**1. Why This Address Works/Doesn't Work (Structural Analysis)**
- What is the current status of this property? Is it for lease? Who is the current tenant?
- Road characteristics (number of lanes, speed limit, daily traffic volume, whether it's a major arterial)
- Historical success/failure cases of restaurants at this address or similar locations
- Ongoing or planned municipal projects nearby (road construction, transit expansion)

**2. Demographics & Spending Power (MUST include specific numbers + sources)**
- Total population of this zip code, Asian/Chinese percentage
- Median household income (exact USD), median income for 25-44 age group
- Percentage of households earning >$200k
- Percentage speaking non-English at home

**3. Competition Gap Analysis**
- How many ${biz} establishments within 1-3 miles? List names
- How many in the entire city/Bay Area? Is there a "zero competition" gap?
- Closed competitors of the same type—why did they close? (e.g., quality issues, wrong location)
- Density of similar price-point ($10-20) fast food competitors

**4. Food Economics (specific to ${biz})**
- Wholesale cost of main ingredients ($/lb)
- Typical food cost as % of revenue
- Cost structure advantages/disadvantages vs similar concepts

**5. Alternative Locations (MUST include specific listings)**
If this address is unsuitable, recommend 3 nearby commercial corridors, each with:
- Corridor name and characteristics (Walk Score, transit, Chinese population density)
- **Specific available listings**: address, sqft, monthly rent ($), source (LoopNet/Craigslist/broker)
- If no listings found, mark [needs site visit] and explain next steps

**6. Break-even Estimation**
- Assuming rent $X/month, what monthly revenue is needed to break even
- At average ticket $Y, how many orders per day needed
- Estimated months to break-even

【OUTPUT REQUIREMENTS】
- Every data point must cite source: [Census], [Yelp], [Wikipedia], [Caltrans], [LoopNet], [Google Maps], [search], [estimate]
- Competitors must use real business names, never "Competitor A/B/C"
- Numbers must be precise, e.g., "$152,587" not "about $150k"
- Failure cases must include specific lessons learned`;
}

function buildDeepResearchSchema(): Record<string, unknown> {
  return {
    properties: {
      executive_summary: {
        type: 'string',
        description: 'A 3-4 paragraph executive summary in narrative style. Must include: (1) clear verdict with rationale, (2) key data points with source citations [Census]/[Yelp]/[Caltrans]/[DeepRes], (3) specific recommendation. Each data point must have a source tag.',
      },
      site_suitability_verdict: {
        type: 'string',
        description: 'Overall suitability verdict: highly_suitable, suitable, marginal, or not_suitable.',
      },
      site_structural_analysis: {
        type: 'string',
        description: 'Narrative analysis of why this specific address works or does not work. Must include: (1) current property status and tenant, (2) road characteristics with traffic data and source, (3) historical restaurant successes/failures at this location or nearby, (4) any municipal projects affecting the area. Every claim needs a [source] citation.',
      },
      demographic_narrative: {
        type: 'string',
        description: 'Narrative analysis of demographics and spending power. Must include EXACT numbers with [Census] citation: (1) zip code population with Asian/Chinese %, (2) median household income in USD, (3) median income for 25-44 age group, (4) % of households earning over $200k, (5) % speaking non-English at home.',
      },
      competition_gap_analysis: {
        type: 'string',
        description: 'Narrative analysis of competition gaps. Must include: (1) count of same-category restaurants within 1-3 mi with names, (2) whether "zero competition" gap exists in city/region, (3) any closed competitors and WHY they closed, (4) density of similar price-point competitors. Use real business names, never "Competitor A/B".',
      },
      food_economics_analysis: {
        type: 'string',
        description: 'Analysis of food economics specific to this business type. Must include: (1) main ingredient wholesale costs in $/lb with [estimate] tag, (2) typical food cost as % of revenue, (3) margin advantages vs similar concepts.',
      },
      historical_case_studies: {
        type: 'array',
        description: 'Specific case studies of restaurant successes/failures in this area.',
        items: {
          type: 'object',
          properties: {
            business_name: { type: 'string', description: 'Real business name.' },
            location: { type: 'string', description: 'Location/address.' },
            outcome: { type: 'string', description: 'success or failure.' },
            years_operated: { type: 'string', description: 'How long it operated.' },
            key_lesson: { type: 'string', description: 'What can be learned from this case.' },
            source: { type: 'string', description: 'Source of this information [Yelp]/[local news]/etc.' },
          },
        },
      },
      direct_competitors: {
        type: 'array',
        description: 'List of direct competitors with real names.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Real business name, never use placeholder.' },
            address: { type: 'string', description: 'Actual address.' },
            distance_mi: { type: 'number', description: 'Distance in miles.' },
            rating: { type: 'number', description: 'Google/Yelp rating.' },
            review_count: { type: 'number', description: 'Number of reviews.' },
            price_range: { type: 'string', description: 'Price range like $, $$, $$$.' },
            threat_level: { type: 'string', description: 'high, medium, or low.' },
            analysis: { type: 'string', description: 'Why this is/isnt a threat.' },
          },
        },
      },
      alternative_corridors: {
        type: 'array',
        description: 'Alternative location corridors with SPECIFIC property listings.',
        items: {
          type: 'object',
          properties: {
            corridor_name: { type: 'string', description: 'Name of the commercial corridor, e.g., "Sunset District - Irving Street".' },
            characteristics: { type: 'string', description: 'Walk Score, transit access, Chinese population density, foot traffic pattern.' },
            rationale: { type: 'string', description: 'Why this corridor is better than the subject address.' },
            listings: {
              type: 'array',
              description: 'Specific available properties. If none found, include one entry with source_tag "[needs site visit]".',
              items: {
                type: 'object',
                properties: {
                  address: { type: 'string', description: 'Property address or listing identifier.' },
                  sqft: { type: 'number', description: 'Square footage.' },
                  monthly_rent_usd: { type: 'number', description: 'Monthly rent in USD.' },
                  highlights: { type: 'string', description: 'Key features: parking, corner lot, foot traffic, etc.' },
                  source_tag: { type: 'string', description: 'Where this listing was found: [LoopNet], [Craigslist], [broker], or [needs site visit] if unavailable.' },
                },
              },
            },
          },
        },
      },
      breakeven_analysis: {
        type: 'object',
        description: 'Break-even estimation.',
        properties: {
          assumed_monthly_rent: { type: 'number', description: 'Assumed monthly rent in USD.' },
          monthly_revenue_to_breakeven: { type: 'number', description: 'Monthly revenue needed to break even.' },
          avg_ticket_price: { type: 'number', description: 'Assumed average ticket price.' },
          daily_orders_needed: { type: 'number', description: 'Daily orders needed at that ticket price.' },
          months_to_breakeven: { type: 'string', description: 'Estimated months to reach break-even, with assumptions stated.' },
          calculation_notes: { type: 'string', description: 'Brief explanation of the calculation methodology and key assumptions.' },
        },
      },
      key_evidence_points: {
        type: 'array',
        description: 'At least 8 specific data points that support the analysis. Each must include a [source] citation.',
        items: { type: 'string' },
      },
      data_sources_used: {
        type: 'array',
        description: 'List of data sources used in this analysis.',
        items: { type: 'string' },
      },
      next_steps_verification: {
        type: 'array',
        description: 'Specific actions the user should take to verify this analysis.',
        items: { type: 'string' },
      },
    },
    required: [
      'executive_summary',
      'site_suitability_verdict',
      'site_structural_analysis',
      'demographic_narrative',
      'competition_gap_analysis',
      'direct_competitors',
      'alternative_corridors',
      'key_evidence_points',
    ],
  };
}

// Legacy schema for backward compatibility
function buildDeepResearchSchemaLegacy(): Record<string, unknown> {
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
  if (!pack) return '';
  
  if (pack.status === 'timeout' || pack.status === 'failed') {
    return lang === 'zh'
      ? `\n\n【深度研究状态】Tavily Deep Research ${pack.status === 'timeout' ? '超时' : '失败'}（${pack.response_time_sec}秒）。请依赖下方的 web_research 摘要和 ACS 数据进行分析。\n`
      : `\n\n[DEEP RESEARCH STATUS] Tavily Deep Research ${pack.status} after ${pack.response_time_sec}s. Rely on web_research digest and ACS data below for analysis.\n`;
  }
  
  if (pack.status !== 'completed') return '';
  
  const lines: string[] = [];
  const L = lang === 'zh';

  lines.push(L ? '## [DeepRes] Tavily 深度研究报告' : '## [DeepRes] Tavily Deep Research Report');
  lines.push(L ? `模型: ${pack.model} | 耗时: ${pack.response_time_sec}秒` : `Model: ${pack.model} | Time: ${pack.response_time_sec}s`);
  lines.push('');
  lines.push(L ? '> 以下数据已经过 Tavily 深度研究验证，引用时使用 [DeepRes] 标签' : '> Data below has been verified via Tavily Deep Research. Cite as [DeepRes]');
  lines.push('');

  if (pack.report) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = pack.report as any;

    // New schema: narrative fields
    if (r.executive_summary) {
      lines.push(L ? '### 执行摘要 [DeepRes]' : '### Executive Summary [DeepRes]');
      lines.push(r.executive_summary);
      lines.push('');
    }

    lines.push(L ? '### 选址判定 [DeepRes]' : '### Site Suitability Verdict [DeepRes]');
    const verdictMap: Record<string, string> = L
      ? { highly_suitable: '非常适合', suitable: '适合', marginal: '边缘', not_suitable: '不适合' }
      : { highly_suitable: 'Highly Suitable', suitable: 'Suitable', marginal: 'Marginal', not_suitable: 'Not Suitable' };
    lines.push(`**${verdictMap[r.site_suitability_verdict] || r.site_suitability_verdict}**`);
    lines.push('');

    // New schema: site structural analysis (narrative)
    if (r.site_structural_analysis) {
      lines.push(L ? '### 物业与道路结构分析 [DeepRes]' : '### Site Structural Analysis [DeepRes]');
      lines.push(r.site_structural_analysis);
      lines.push('');
    }

    // New schema: demographic narrative
    if (r.demographic_narrative) {
      lines.push(L ? '### 人口与消费力分析 [DeepRes]' : '### Demographics & Spending Power [DeepRes]');
      lines.push(r.demographic_narrative);
      lines.push('');
    }

    // Legacy schema: demographic_analysis (fallback)
    if (!r.demographic_narrative && r.demographic_analysis) {
      const d = r.demographic_analysis;
      lines.push(L ? '### 人口统计分析 [DeepRes]' : '### Demographic Analysis [DeepRes]');
      lines.push(L ? `- 人口估计: ${d.population_estimate}` : `- Population: ${d.population_estimate}`);
      lines.push(L ? `- 收入中位数: ${d.median_income_estimate}` : `- Median Income: ${d.median_income_estimate}`);
      lines.push(L ? `- 年龄分布: ${d.age_distribution_notes}` : `- Age Distribution: ${d.age_distribution_notes}`);
      lines.push(L ? `- 消费力评估: ${d.spending_power_assessment}` : `- Spending Power: ${d.spending_power_assessment}`);
      lines.push('');
    }

    // New schema: competition gap analysis (narrative)
    if (r.competition_gap_analysis) {
      lines.push(L ? '### 竞争空白分析 [DeepRes]' : '### Competition Gap Analysis [DeepRes]');
      lines.push(r.competition_gap_analysis);
      lines.push('');
    }

    // New schema: food economics analysis
    if (r.food_economics_analysis) {
      lines.push(L ? '### 食材经济学分析 [DeepRes]' : '### Food Economics Analysis [DeepRes]');
      lines.push(r.food_economics_analysis);
      lines.push('');
    }

    // New schema: historical case studies
    if (r.historical_case_studies?.length) {
      lines.push(L ? '### 历史案例研究 [DeepRes]' : '### Historical Case Studies [DeepRes]');
      r.historical_case_studies.forEach((cs: { business_name: string; location: string; outcome: string; years_operated: string; key_lesson: string; source: string }) => {
        const outcome = cs.outcome === 'success' ? (L ? '成功' : 'Success') : (L ? '失败' : 'Failure');
        lines.push(`- **${cs.business_name}** (${cs.location}) — ${outcome}`);
        lines.push(`  ${L ? '经营时间' : 'Years'}: ${cs.years_operated} | ${L ? '教训' : 'Lesson'}: ${cs.key_lesson} ${cs.source}`);
      });
      lines.push('');
    }

    // Direct competitors (both schemas)
    const directComps = r.direct_competitors || r.competition_analysis?.direct_competitors;
    if (directComps?.length) {
      lines.push(L ? '### 直接竞争者 [DeepRes]' : '### Direct Competitors [DeepRes]');
      directComps.slice(0, 8).forEach((comp: { name: string; address?: string; distance_mi?: number; distance?: string; rating?: number; review_count?: number; price_range?: string; price_tier?: string; threat_level: string; analysis?: string; notes?: string }) => {
        const dist = comp.distance_mi ? `${comp.distance_mi} mi` : comp.distance;
        const rating = comp.rating ? ` ⭐${comp.rating}` : '';
        const reviews = comp.review_count ? ` (${comp.review_count} reviews)` : '';
        const price = comp.price_range || comp.price_tier || '';
        const threat = comp.threat_level;
        lines.push(`- **${comp.name}** — ${dist}${rating}${reviews} ${price} — ${L ? '威胁' : 'Threat'}: ${threat}`);
        if (comp.analysis || comp.notes) {
          lines.push(`  ${comp.analysis || comp.notes}`);
        }
      });
      lines.push('');
    }

    // New schema: alternative corridors with specific listings
    if (r.alternative_corridors?.length) {
      lines.push(L ? '### 替代商业走廊 [DeepRes]' : '### Alternative Corridors [DeepRes]');
      r.alternative_corridors.forEach((corr: { corridor_name: string; characteristics: string; rationale: string; listings?: { address: string; sqft: number; monthly_rent_usd: number; highlights: string; source_tag: string }[] }, i: number) => {
        lines.push(`**${i + 1}. ${corr.corridor_name}**`);
        lines.push(`${L ? '特征' : 'Characteristics'}: ${corr.characteristics}`);
        lines.push(`${L ? '推荐理由' : 'Rationale'}: ${corr.rationale}`);
        if (corr.listings?.length) {
          lines.push(L ? '**放租铺位:**' : '**Available Listings:**');
          corr.listings.forEach((lst) => {
            lines.push(`  - ${lst.address}: ${lst.sqft} sqft, $${lst.monthly_rent_usd}/mo — ${lst.highlights} ${lst.source_tag}`);
          });
        }
        lines.push('');
      });
    }

    // Legacy schema: alternative_locations (fallback)
    if (!r.alternative_corridors?.length && r.alternative_locations?.length) {
      lines.push(L ? '### 替代位置建议 [DeepRes]' : '### Alternative Locations [DeepRes]');
      r.alternative_locations.slice(0, 4).forEach((alt: { address_or_corridor: string; why_better: string; estimated_rent_usd: string; current_listings?: string }, i: number) => {
        lines.push(`${i + 1}. **${alt.address_or_corridor}**`);
        lines.push(`   ${L ? '优势' : 'Why'}: ${alt.why_better}`);
        lines.push(`   ${L ? '租金' : 'Rent'}: ${alt.estimated_rent_usd}`);
        if (alt.current_listings) lines.push(`   ${L ? '放租' : 'Listings'}: ${alt.current_listings}`);
      });
      lines.push('');
    }

    // New schema: breakeven analysis
    if (r.breakeven_analysis) {
      const be = r.breakeven_analysis;
      lines.push(L ? '### 盈亏平衡分析 [DeepRes]' : '### Break-even Analysis [DeepRes]');
      lines.push(L ? `- 假设月租: $${be.assumed_monthly_rent}` : `- Assumed Monthly Rent: $${be.assumed_monthly_rent}`);
      lines.push(L ? `- 盈亏平衡月营收: $${be.monthly_revenue_to_breakeven}` : `- Monthly Revenue to Break-even: $${be.monthly_revenue_to_breakeven}`);
      lines.push(L ? `- 平均客单价: $${be.avg_ticket_price}` : `- Average Ticket: $${be.avg_ticket_price}`);
      lines.push(L ? `- 日均订单需求: ${be.daily_orders_needed}` : `- Daily Orders Needed: ${be.daily_orders_needed}`);
      lines.push(L ? `- 预计回本周期: ${be.months_to_breakeven}` : `- Months to Break-even: ${be.months_to_breakeven}`);
      if (be.calculation_notes) {
        lines.push(`${L ? '计算说明' : 'Notes'}: ${be.calculation_notes}`);
      }
      lines.push('');
    }

    // New schema: key evidence points
    if (r.key_evidence_points?.length) {
      lines.push(L ? '### 关键证据点 [DeepRes]' : '### Key Evidence Points [DeepRes]');
      r.key_evidence_points.forEach((pt: string) => {
        lines.push(`- ${pt}`);
      });
      lines.push('');
    }

    // Legacy schema: risks & opportunities
    if (r.risks?.length) {
      lines.push(L ? '### 风险 [DeepRes]' : '### Risks [DeepRes]');
      r.risks.slice(0, 5).forEach((risk: { risk: string; severity: string; mitigation: string }) => {
        lines.push(`- **${risk.risk}** (${risk.severity}) — ${L ? '缓解' : 'Mitigation'}: ${risk.mitigation}`);
      });
      lines.push('');
    }

    if (r.opportunities?.length) {
      lines.push(L ? '### 机会 [DeepRes]' : '### Opportunities [DeepRes]');
      r.opportunities.slice(0, 5).forEach((opp: string) => {
        lines.push(`- ${opp}`);
      });
      lines.push('');
    }

    // New schema: next steps
    if (r.next_steps_verification?.length) {
      lines.push(L ? '### 下一步验证建议 [DeepRes]' : '### Next Steps for Verification [DeepRes]');
      r.next_steps_verification.forEach((step: string) => {
        lines.push(`- ${step}`);
      });
      lines.push('');
    }
  } else if (pack.report_raw) {
    lines.push(L ? '### 研究报告（原文）[DeepRes]' : '### Research Report (Raw) [DeepRes]');
    lines.push(pack.report_raw.slice(0, 4000));
    if (pack.report_raw.length > 4000) lines.push('...(truncated)');
    lines.push('');
  }

  if (pack.sources?.length) {
    lines.push(L ? '### 数据来源 [DeepRes]' : '### Sources [DeepRes]');
    pack.sources.slice(0, 15).forEach((s, i) => {
      lines.push(`[${i + 1}] ${s.title} — ${s.url}`);
    });
  }

  return lines.join('\n');
}
