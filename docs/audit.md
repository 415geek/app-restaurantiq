# 付费报告生成链路审计 · Pipeline Audit（Phase 0）

> 研发提示词 v1.0 · Phase 0 交付物。目的：逐字段回答「这个数字是谁算的」，并标出与 §1.4 硬性约束冲突的位置。
> 代码库事实：**Next.js 16 App Router + TypeScript，部署在 Vercel**。提示词 §1.1 假设的 Python FastAPI / LangGraph 后端与 Bedrock 路由在本仓库中并不存在（`restaurantiq-backend/` 是一个未接入付费报告的 NestJS 服务）。因此 §2 建议的 `backend/iq/` 目录在本仓库落地为 `lib/iq/`（TypeScript），`params/*.yaml` 原样保留。
> 回归用例：`qa/golden_set/millbrae_1711.json`；重放：`npm run replay:golden -- millbrae_1711`。

## 0. 一句话结论

当前付费报告的**绝大多数数字由 LLM 写出**，只有盈亏平衡 / 安全营收 / 成本表（D-4 财务模型）和 ACS 原始数值是公式产物；评分、客流指数、回收期、置信度、情景单量、竞品距离与评分全部是模型自述，且没有任何门槛区分「数据抓取失败」与「真实为零」。这正是 Millbrae 报告 R1–R8 的机制性根源。

## 1. 端到端调用链

| 步骤 | 文件 · 函数 | 说明 |
|---|---|---|
| 入口 | `app/api/funnel/full-report/route.ts` `POST` | 默认 `startReportGeneration` → 202；`persist:false` 预览或未迁移 DB 走同步旧路径 |
| 购买完成 | `lib/funnel/iq-complete-purchase.ts` `fulfillIqPaidPurchase` | 支付后直接起后台任务 |
| 后台状态机 | `lib/funnel/iq-report-job.ts` | `enrich → draft → verify → finalize → done`，每阶段 250s 预算，`generation_state_json` 断点；**进度条是合成曲线**（`STAGE_BANDS` + `easeOut`），不是真实进度 |
| 市场数据 | `lib/funnel/iq-market-data-resolve.ts` `resolveMarketDataForIqReport` | 顺序：Google Places ∪ Yelp ∪ Foursquare → ACS → site_history → 人口叙事 + DeepSeek 竞品洞察（非 lean）→ Tavily 深度研究 → Caltrans → LoopNet 挂牌 → BrightData → Tavily 兜底 → **`computeFinanceModel` 永远最后** |
| 生成 | `lib/funnel/iq-generate-full-report.ts` | 多 Agent（`IQ_ENGINE=multi_agent`）→ n8n → `runFullPremiumReport`（`lib/funnel/iq-llm.ts`） |
| 提示词 | `lib/funnel/iq-prompts-locationiq-v2.ts` + `lib/funnel/iq-premium-anchors.ts` `buildPremiumMarketDataSection` | 证据块顺序：anchors → ACS → deepResearch → web → caltrans → listings → brightdata → userInputs → financeModel → competitorInsights → siteHistory → 原始 JSON（默认 Anthropic 路由只给 120k 字符，**MiMo 路由才给完整上下文**） |
| 路由 | `lib/funnel/iq-provider-router.ts` | Anthropic 主、MiMo/OpenAI 备；`iq_full` 16K token，按剩余时间反推输出上限（`iq-deadline.ts`）；Claude 走结构化输出 |
| 后处理 | `iq-full-report-schema.ts` | `parseIqFullReport`（**校验失败仍返回原对象**）→ `applyCompetitorWhitelist` → 完整度 / 竞品接地重生成（最多两次）→ `applyFinanceModelOverride` → `applyDualModelVerification`（仅专业版）→ `stripInternalIqReportFields` |
| 渲染 | `components/iq/ReportContent.tsx`（深色网页）、`app/api/iq/report/[id]/pdf/route.ts`（独立的 HTML 模板 + `@sparticuz/chromium`） | 两套模板各自从同一 JSON 重画，无共享渲染层 |

## 2. 逐字段来源（D = 函数计算，L = LLM 生成，L→D = LLM 生成后被函数覆盖）

### dashboard
| 字段 | 来源 | 备注 / §1.4 冲突 |
|---|---|---|
| `overall_score` | **L**（默认）；多 Agent 模式 L→D（`agents/orchestrator.ts` `buildDecisionMatrix`） | 与 `risk_audit.overall_score` 从不对账 → **R5**；违反约束 4（单一事实源） |
| `foot_traffic_index` | **L** | 没有任何客流输入（Caltrans AADT 只是提示词文本）→ **R6**；违反约束 3 |
| `competition_intensity` | **L** | |
| `payback_months` | **L**（形如 `"18-26"`） | **代码库中不存在任何 CapEx / 回收期模型**（grep 仅命中提示词与渲染标签）→ **R6**；违反约束 3 |
| `occupancy_cost_pct` | L→D（`= finance_model.occupancy_cost_pct_at_safe`） | 算出来了但网页与 PDF 都**不渲染** |
| `recommendation` | **L**；多 Agent 模式 D | |

### decision_matrix
- 默认路径 **完全 L**：权重只是提示词指令（`iq-prompts-locationiq-v2.ts` zh:516 / en:703「客流与位置 25% / 人群 20% / 竞争 20% / 财务 20% / 运营 15%」），无代码校验 Σ权重 = 100 或 `weighted_score = score × weight`。
- 多 Agent 路径 **D**：`SCORE_WEIGHTS = { foot_traffic .25, demographic_fit .2, competition .2, accessibility .2, rent_value .15 }`。
- **两套维度互不兼容**（财务/运营 vs 可达/租金）却共用一个字段名 → **R5**；违反约束 4。

### risk_audit
| 字段 | 来源 | 备注 |
|---|---|---|
| `overall_score` | **L**，从不被覆盖 | 多 Agent 模式下与三行之外的确定性 `dashboard.overall_score` 直接矛盾 |
| `layers[] / *_score` | **L**（六层 rubric 仅在提示词） | |
| `radar` | **L**（键由 `RADAR_KEYS` 钉死） | |
| `break_even_revenue_monthly_usd` / `safe_revenue_monthly_usd` / `cost_breakdown` | **L→D**（`applyFinanceModelOverride`） | 现有链路中唯一被强制接管的一组数字 |
| `data_confidence_pct` | **L** | 未计算、未校验，也不与 `finance_model.confidence` 对账；违反约束 3/5 |
| `decision_tier` | **L**（site_history 关店只在提示词里要求降级，非代码约束） | |

### revenue_model
- `scenarios[]`：**L**，被两组互不对账的锚点牵引——`computeRevenueAnchorsUsd`（纯启发式：`density = n·2100 + rating·2800 + min(reviews,2000)·8`，`low = 9000 + density·0.95`）与 D-4 硬规则（要求引用 `daily_covers_needed_*`）。
- **座位 × 翻台一致性：默认路径不存在任何校验**。seats / turns 仅出现在提示词要求的 `key_assumptions` 文案里；唯一做 `seats × turns × ticket × 30` 的代码是可选多 Agent 的 `metrics.ts:299-309`，且从不与 `finance_model` 对账 → **R4**；违反约束 4。
- `breakeven` 是散文，不被覆盖，可与两张卡之外的 D-4 数字打架。

### competitors[]
- **L 生成 → D 过滤**：`applyCompetitorWhitelist` 只按名字白名单裁剪；每行的 `distance_mi / rating / review_count / price_tier / threat_level` **全部是 LLM 写的**，白名单里已有的真实 `rating / reviewCount / lat / lng` 不回填；违反约束 3。

### site_history / 人口 / 租金溢价
- `site_history.*` 叙事字段：L（基于 D 数据包）；确定性字段由 `SiteHistorySection.tsx` 单独渲染。
- 人口：ACS 数值 D（`iq-acs-enrichment.ts`），`demographic_profile` 散文 L，**没有校验散文中的数字是否等于 ACS 数值**；图表（`ReportDataViz.tsx`）直接读 ACS，散文幻觉与正确图表可并排出现。
- 租金溢价 %：**schema / 提示词 / 渲染中均不存在该字段**；Millbrae 报告中的「溢价 127%」纯属 LLM 散文，来源为单一挂牌 → **R8**；违反 D8「≥3 对标」。

### 其余散文字段
`executive_summary / final_verdict / trade_area_analysis / competition_landscape / revenue_estimate / risks / risk_matrix / opportunities / failure_scenarios / differentiation_strategy / acquisition_channels / action_plan* / comparables / key_evidence_points / alternative_corridors / dayparts / cannibalization / verdict_sensitivity / deal_terms_guidance / site_and_access_assessment / one_line_conclusion / lease_checklist / data_sources_and_disclaimer` —— **全部 L**，无字段引用，无 NumberGuard。

## 3. 财务模型（`lib/funnel/iq-finance-model.ts` `computeFinanceModel`）

```
fixed_total   = rent + labor + utilities + insurance + pos + marketing + misc
variable_rate = food_cost_pct + paper_pct + 0.025 (CC) + 0.07 (delivery blended)
contribution  = max(0.15, 1 − variable_rate)
break_even    = fixed_total / contribution
safe          = break_even × max(1.20, archetype.safe_revenue_multiplier)
covers        = daily_revenue / archetype.avg_ticket_usd
```
- 输入：租金四级优先（用户 → sqft 估算 → LoopNet 中位 → 档位估算，来源写入 `rent_source`）；sqft 用户或原型默认；**seats 不是输入；客单价永远是原型常量（$8.5–$70），从不接受用户输入**；工资 / 租金档由 ACS MHI + 州判定。
- 置信度 = `[user_rent, user_sqft, acs, listings≥2]` 计数（≥3 高 / ≥2 中 / 否则低）。
- **保留价值**（Phase 4 继续沿用）：固定成本 / 边际贡献的口径、原型基准表、租金来源链。**冲突**：与 §4.5 唯一口径（seats × turns、去掉入座率、三情景反算断言）不一致，需重写为 `engines/finance.ts` 单一函数。

## 4. 竞品抓取

| 来源 | 调用 | 半径 | 上限 |
|---|---|---|---|
| Google textsearch | `iq-market-data.ts:144` | **无半径**（`"{cuisine} restaurant near {address}"`） | 12（10 入样本） |
| Yelp | `external-data/yelp-competitors.ts` | 2,400 m | 20 |
| Foursquare | `external-data/foursquare-places.ts` | 2,400 m | 20 |
| BrightData / Place Details | 搜索 / 评论 | — | — |

- 合并去重：`extractCompetitorWhitelist`（名字归一化）。
- **零竞品处理没有「失败 vs 真实为零」判别**：`summary.places_status / yelp_status / foursquare_status` 被记录但**没有任何守卫读取**；`REQUEST_DENIED`、无 key、geocode 失败与真实乡村零竞争输出完全相同（`_insufficient_competitor_data = true`，置信度降为 Low）。
- 「零竞争 / 空白」措辞来源全部在提示词：`iq-prompts-locationiq-v2.ts:451/493/520`（含示例「旧金山为零——品类开创者机会」）、`iq-web-research.ts:104-106`、`agents/specialists.ts:137/161`、`iq-paywall-sections.ts:11`。即抓取失败会被提示词**主动导向**「机会」叙事 → **R1**；违反约束 3/5。
- 与 §1.4 第 2 条冲突：现有链路依赖 Yelp Fusion（条款禁止分析用途）与 Foursquare / LoopNet / BrightData 付费源；目标架构改为 Overture + Google（≤6 次）为主。

## 5. ACS 人口

- 地理解析：lat/lng → FCC Area API → block FIPS → 只取 **tract（[5:11]）+ county**；不查 block group，不查 ZIP。
- 表：B01003 / B01002 / B19013 / B19301 / B25077 / B25064 / B03002 / B19001 / B15003；年份 2023 → 2022。**缺 B16001（家庭语言）、B02018（亚裔细分）、B11001 / B25010 / B11003 / B08301 / B01001** 等 D2 要求的表。
- 失败行为：FCC 失败或 county 无行 → `acs_context` 直接缺席，提示词随后要求模型写「无普查片区级官方统计」；tract 抑制 → 空行 + 提示回落 county。**代码中不存在字面「无法解析」**，R2 的文案是 LLM 在 `acs_context` 缺席时自由发挥（FCC 单点失败即全军覆没，没有 Census Geocoder 备用）。
- `resolveCostTier` 在 MHI 为空时静默按州降级为 hcol/mcol，财务模型照样输出自信数字。

## 6. 渲染

- 网页：深色主题（`bg-zinc-900`），`@media print` 反转为白底——这就是 R3 的来源（用户用浏览器打印深色页面）。
- 网页 dashboard 只渲染五个键，丢掉 `occupancy_cost_pct`；决策矩阵 `weighted_score` 原样打印不复算。
- `ReportDataViz.tsx` 是唯一从原始数据复算的组件，但 `statCompetitors = google + yelp` **不去重**，与同页 `_whitelist_total` 矛盾；保本 / 安全线读 `finance_model`，风险审计卡读 `risk_audit.*`，两者只因 override 才一致。
- PDF：独立 1,300 行 HTML 模板，浅色硬编码色值，A4，`@sparticuz/chromium`；与网页模板结构性重复（违反约束 4）。R3 所指的深色 PDF 来自浏览器打印路径，服务端 PDF 本身是浅色的。

## 7. 置信度

三个互不相关的置信度并存：`report.confidence`（LLM 字符串，仅在白名单 < 3 或双模型分歧时被代码降级）、`risk_audit.data_confidence_pct`（LLM 整数）、`finance_model.confidence`（函数计数）。可以同时出现「High / 82% / low」。违反约束 3/5 → §4.4 需改为唯一计算公式。

## 8. 成本记录

**不存在按报告的成本核算。** 仅有 `IqRouteAttempt` 的输出 token / 耗时（OpenAI 分支连输出 token 都不记；**任何分支都不读输入 token**），无价格表、无 DB 列。`_generation_attempts` 不在 `INTERNAL_KEYS` 中，提供商与模型名**泄漏**到持久化并下发给客户端的 JSON。违反约束 1。

## 9. 现有测试

无测试框架；`scripts/*.mjs` 为手工冒烟（竞品接地、D-4 财务、ACS、PDF、路由）。`smoke-d2-pdf.mjs` 复制粘贴了 PDF 模板，会漂移。状态机、双模型验证、多 Agent、渲染器均无测试。

## 10. 保留 / 标记冲突清单（§Phase 0 第 3 条）

| 现有能力 | 处置 |
|---|---|
| D-4 确定性财务模型的成本结构与原型基准表 | **保留口径**，迁入 `lib/iq/engines/finance.ts` 并改为 seats × turns 单一函数（§4.5） |
| 六层风险审计（`risk_audit.layers`） | **保留**为第 12 页风险登记的输入结构，但分数改由 §4.1 唯一评分函数派生 |
| 竞品白名单 grounding（`iq-market-signals.ts`） | **保留**思路，升级为 Phase 3 四层竞争关系 + 竞品守卫（守卫读取 API 状态） |
| ACS 富化（`iq-acs-enrichment.ts`） | **保留**表变量解析代码，补齐 D2 表与 block group / tract 双层 + Census Geocoder 备用 |
| site_history 数据包 | **保留**为 L4 / 风险信号输入（Yelp 分支按约束 2 改为可选且默认关闭） |
| Yelp / Foursquare / LoopNet / BrightData / Tavily 深度研究 | **与约束 1/2 冲突**：不进入 `report_model.json` 主干；仅 Tavily / Brave 用于 D8 租金与 D11 开发管线各 ≤1 次 |
| 多 Agent 引擎（`lib/funnel/agents/`） | **与约束 3/4 冲突**（专家 Agent 自报数字）：其确定性 `metrics.ts` 思路并入 Phase 2 引擎；专家叙事改为附录 E 的只读 JSON 叙事 |
| 合成进度条 | 由 Phase 1 并行抓取 + 真实阶段状态替换 |

## 11. R1–R8 → 机制映射

| # | 机制根因（本审计定位） | 拦截位置 |
|---|---|---|
| R1 | 零竞品无失败判别 + 提示词导向「机会」 | Phase 3.9 守卫读取 `api_status`；Phase 6 禁用措辞门槛 |
| R2 | FCC 单点解析失败即无 ACS；LLM 自由发挥文案 | Phase 1 D1 Census Geocoder → tract/BG；D2 三级降级 |
| R3 | 浏览器打印深色网页 | Phase 5 `/print` 浅色 + 服务端 Playwright；Phase 6 对比度检查 |
| R4 | 情景表由 LLM 写，无 seats × turns 函数 | Phase 4.5 唯一财务函数 + 反算断言 |
| R5 | 两套评分（LLM 7 维 / 提示词 5 维 / 多 Agent 5 维）互不对账 | Phase 4.1 `score()` 唯一来源 |
| R6 | 无 CapEx / 客流输入却输出 KPI | Phase 4.4：无输入则字段为 null 且模板不渲染 |
| R7 | 无地图组件 | Phase 5.4 等时圈 + Overture 地图 |
| R8 | 全部散文无字段引用；租金溢价来自单一挂牌 | Phase 5.2 一事一节 + NumberGuard；D8 ≥3 对标 |
