# IQ V3 Upgrade — 现状与改造点

> 审计日期：2026-05-29 · 依据仓库真实代码（非假设）

## §0 五个审计问题

### 1. `runFullPremiumReportOpenAI` 完整调用链与 `marketData` 字段

**调用链（OpenAI 回退路径）：**

```
generateIqFullReportWithN8nFallback (iq-generate-full-report.ts)
  → [n8n webhook] 或 runFullPremiumReportOpenAI (iq-llm.ts)
      → extractCompetitorWhitelist(marketData)
      → buildPremiumPrompts → buildPremiumMarketDataSection + whitelist block
      → OpenAI chat.completions (json_object)
      → parseIqFullReport
      → applyCompetitorWhitelist (+ 可选 retry)
  → applyFinanceModelOverride(financeModel from marketData.finance_model)
  → logFullReportQuality
```

**`marketData` 在付费路径中实际可携带（由 `resolveMarketDataForIqReport` 富化）：**

| 字段 | 来源 | 注入 prompt 方式 |
|---|---|---|
| `acs_context` | ACS API | `buildAcsQuantAnchorsBlock` 完整表 |
| `summary` / `sample_competitors_google` | Google Places | 锚点 + JSON（含 `place_id`） |
| `sample_competitors_yelp` | Yelp | 锚点 + JSON |
| `sample_competitors_foursquare` | Foursquare | JSON |
| `competitor_insights` | DeepSeek D-5 | 专用块（JSON 中仅 meta 摘要） |
| `finance_model` | D-4 确定性 | `formatFinanceModelForAnchors` |
| `commercial_listings` | LoopNet RapidAPI | `formatListingsForAnchors` |
| `caltrans_aadt` | Caltrans | `formatCaltransForAnchors` |
| `brightdata_market_research` | Bright Data | `formatBrightDataForAnchors` |
| `deep_research` | Tavily | 摘要块（report 正文在块内，JSON 仅 meta） |
| `web_research` | 可选 | `summarizeWebResearchForAnchors` |
| `demographic_narrative` | Claude 可选 | 参考，非全文 |
| `user_inputs` | 表单 | 租金/面积块 |

### 2. `marketData` 是否被截断？

**是，存在多处“省 token”裁剪（OpenAI 时代合理，MiMo 1M 可放开）：**

- `buildPremiumMarketDataSection`：`deep_research` 在 JSON dump 中仅保留 status/model/sources_count；`competitor_insights` 在 JSON 中仅保留 provider/model/count。
- `buildCompetitorInsightsBlock` 已输出 D-5 叙事，但原始 review 摘录不在 JSON dump。
- `FREE_BRIEF_MAX_CHARS = 2800` 仅影响免费 brief，不影响付费。
- D-5 `MAX_COMPETITORS = 6`、review 每条 slice 350 字符（DeepSeek 路径，非主报告 LLM）。

**MiMo 改造点（Phase 2）：** `fullContext: true` 时保留完整 `marketData` JSON（含 `competitor_insights` 全文、未剥离的 deep_research），并增加 `[SOURCE][DATE]` 证据块说明。

### 3. 后处理覆盖机制（换模型后必须保持）

| 机制 | 触发位置 | 行为 |
|---|---|---|
| `applyCompetitorWhitelist` | `iq-llm.ts` 每次 LLM 返回后；`iq-generate-full-report.ts` n8n 分支 | 剔除白名单外店名，写 `_dropped_*` / `_warnings` |
| `shouldRetryForCompetitorGrounding` | `iq-llm.ts` | 幻觉≥2 或保留数不足 → 更严 prompt 重试一次 |
| `applyFinanceModelOverride` | `iq-generate-full-report.ts` n8n/OpenAI 两条分支之后 | 强制 `risk_audit.break_even_*` / `cost_breakdown` = D-4 模型 |

**V3 要求：** 仅替换“调用 LLM 那一行”；上述三步顺序与逻辑不变。

### 4. `.env.example` 承诺的 `iq-provider-router.ts` 是否存在？

**审计结论：缺失。** `.env.example` L58–64 注释指向 `lib/funnel/iq-provider-router.ts`，但仓库中无此文件。IQ 路径硬编码 `iq-llm.ts` → OpenAI；Ops 使用 `lib/server/llm/provider-json.ts`（任务键不同）。

**V3 Phase 1：** 新建 `iq-provider-router.ts` + `llm/mimo-client.ts`。

### 5. Schema 已支持但提示词未充分驱动的字段

| 字段 | Schema | 提示词强度 |
|---|---|---|
| `alternative_corridors` | ✅ | 已要求 ≥3，依赖 listings 数据 |
| `data_sources_and_disclaimer` | ✅ | 有要求，缺 provider/model 溯源 |
| `site_and_access_assessment` | ✅ | 有叙述要求 |
| `comparables` | ✅ | 要求 success/failure 各 1，常填泛化 |
| `dayparts` | ❌ → V3 新增 | — |
| `site_history` | ❌ → V3 新增 | — |
| `verdict_sensitivity` | ❌ → V3 新增 | — |
| `deal_terms_guidance` | ❌ → V3 新增 | — |
| `cannibalization` | ❌ → V3 新增 | — |
| `occupancy_cost_pct` | ❌ → V3 新增（D-4 计算） | — |

---

## 已存在 → 增强（非新建）

| 能力 | 状态 |
|---|---|
| 竞品白名单 + 幻觉重试 | ✅ 保持 |
| D-4 `computeFinanceModel` | ✅ 扩展 occupancy_cost_pct |
| D-5 DeepSeek 竞品洞察 | ✅ 保持；MiMo 可并列 `iq_competitor_insights` 任务 |
| 决策矩阵 / risk_audit 六层 | ✅ 提示词已有，V3 加强溯源与双模型校验 |
| `alternative_corridors` / `comparables` | ✅ schema 已有，V3 提示词强化 |

---

## 分阶段交付状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 本文档 | ✅ |
| 1 | MiMo client + provider router + iq-llm 路由 | ✅ 代码已落地 |
| 2 | 全量 marketData（`fullContext`） | ✅ |
| 3 | B-1…B-7 schema + 提示词 | ✅ 核心字段与指令 |
| 4 | C-1…C-6 付费价值 | ✅ 溯源/区间/翻盘/砍价/完成度门禁；双模型校验为可选 env |
| 5 | ARCHITECTURE / API 文档 | 待用户确认后补 |

**生产默认：** `IQ_PRIMARY_PROVIDER` 默认 `openai`（`.env.example`）；本地可用 `mimo` 做 Phase 2 对比验收。

---

## MiMo vs OpenAI 对比记录（待填）

| 指标 | OpenAI (`gpt-4o`) | MiMo (`mimo-v2.5-pro`) |
|---|---|---|
| 单份付费报告 token 估计 | TBD | TBD |
| 竞品具名数（同地址） | TBD | TBD |
| 完成度 score | TBD | TBD |
| 备注 | | |
