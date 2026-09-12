/**
 * Small LLM utilities for the 360° pipeline. Only two jobs are allowed to touch
 * a model: sub-cuisine classification of leftovers (Phase 3.3, batch ≤ 50) and
 * page narratives (Phase 5.4). Both go through the existing provider router.
 */
import { runIqProviderJson } from '@/lib/funnel/iq-provider-router';
import type { CostLedger } from '../data/types';
import { getTaxonomy } from '../params';

export const LLM_CLASSIFY_COST_PER_ITEM_USD = 0.002;

export function hasLlmKey(env: (n: string) => string | null): boolean {
  return Boolean(env('ANTHROPIC_API_KEY') || env('MIMO_API_KEY') || env('OPENAI_API_KEY'));
}

export type ClassifyDecision = { id: string; sub_cuisine: string; confidence: number; is_chain?: boolean; price_tier?: string };

export async function classifySubCuisineBatch(
  items: Array<{ id: string; name: string; categories: string[] }>,
  opts: { cost: CostLedger; env: (n: string) => string | null; timeoutMs?: number },
): Promise<ClassifyDecision[]> {
  if (items.length === 0 || !hasLlmKey(opts.env)) return [];
  const ids = getTaxonomy().cuisines.map((c) => `${c.id}(${c.label_zh})`).join(', ');
  const out: ClassifyDecision[] = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const res = await runIqProviderJson<{ items: ClassifyDecision[] }>({
      task: 'iq_competitor_insights',
      fastModel: true,
      timeoutMs: opts.timeoutMs ?? 30_000,
      maxTokens: 2_000,
      system:
        `你是餐饮 POI 分类器。把每个店名归入子菜系 id 之一：${ids}。` +
        `输出 JSON {"items":[{"id":"...","sub_cuisine":"<id>","confidence":0-1,"is_chain":bool,"price_tier":"$|$$|$$$"}]}。` +
        `无法判断时用 other_chinese 且 confidence < 0.6。不要输出其它文字。`,
      user: JSON.stringify(batch),
    });
    opts.cost.add('llm', batch.length * LLM_CLASSIFY_COST_PER_ITEM_USD, `sub-cuisine classify ×${batch.length}`);
    const items2 = Array.isArray(res?.data?.items) ? res!.data.items : [];
    for (const d of items2) {
      if (d && typeof d.id === 'string' && typeof d.sub_cuisine === 'string') {
        out.push({ id: d.id, sub_cuisine: d.sub_cuisine, confidence: Number(d.confidence) || 0, is_chain: Boolean(d.is_chain), price_tier: d.price_tier });
      }
    }
  }
  return out;
}
