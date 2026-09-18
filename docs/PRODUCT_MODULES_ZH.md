# RestaurantIQ 产品功能模块介绍（中文）

> 更新时间：2026-03-28（America/Los_Angeles）
> 维护规则：每次功能变更后同步更新本文件，并与英文版保持一致。

## 1. 官网（Marketing）
- 路径：`/`
- 功能：品牌价值展示、功能亮点、定价、FAQ、预约 Demo、注册转化。
- 关键能力：中英文切换、CTA 跳转（注册/登录）、营销表单接口。

## 2. 总览（Dashboard）
- 路径：`/dashboard`
- 功能：核心经营 KPI、运营健康总览、推荐动作、执行日志摘要。
- 数据来源：优先真实解析/接入数据，失败时回退到可用兜底数据并标记状态。

## 3. 分析中心（Analysis）
- 路径：`/analysis`
- 功能：地址检索商家、发起多源分析、生成结构化报告与可执行建议。
- 关键能力：
  - 支持上传运营文件作为前期数据入口；
  - 已上传文档默认折叠，点击后展开查看详情，降低页面占用；
  - 调用多 Agent 融合分析（运营、社媒、宏观）；
  - 执行建议支持预览、状态流转与回滚窗口。
  - 新增“运营数据分析”面板：基于上传数据展示解析清洗摘要、关键洞察与可执行建议；
  - 新增地址自动补全（Google Places）+ 商家分析/对比双入口（同地址可做经营基线对比）；
  - 商家分析结果扩展：评论深度主题、消费画像、竞对切分、平台情报、差距优先级清单。

## 4. 订单中心（Order Center）
- 路径：`/delivery`
- 目标：专注订单接单与履约，不再承载平台授权入口。
- 首屏逻辑：
  - 不显示“选择接入平台”与“统一操作平台”模块；
  - 若暂无已连接平台，仅提示前往 `设置中心 → Integrations` 进行授权；
  - 授权成功后自动跳回订单中心并展示操作工作区。
- 当前能力：
  - 订单中台（Otter/StreamOrder风格）：状态筛选、订单列表、详情与履约动作同屏；
  - 订单履约看板（新单→接单→制作→待取→完成）；
  - 订单查询模块（按平台/日期/顾客姓名/关键词筛选）；
  - 点击订单可查看平台 API 返回的完整订单字段明细；
  - 自动化策略（自动接单阈值、队列阈值、备餐缓冲等）；
  - Uber Eats Webhook 事件审计。
- UX 策略：融合 Deliverect / Otter / StreamOrder 的高频操作习惯，降低迁移学习成本。

## 5. 菜单管理（Menu Management）
- 路径：`/menu-management`
- 功能：
  - 菜品搜索、分类筛选、平台筛选、快速清空筛选；
  - 多平台价格与上架状态统一编辑；
  - 批量发布菜单更新到已连接平台；
  - 移动端卡片化编辑，桌面端高密度表格编辑；
  - 新增 **门店运营配置（Store Ops）**：
    - 常规营业时间（`service_availability`）按周编辑并推送；
    - 假期覆盖时间（`holidayhours`）按日期覆盖；
    - 门店在线/暂停状态（`status`）切换；
    - 备餐时间偏移与默认备餐时间（`pos_data`）配置；
    - 促销草稿编辑（未配置 Promotions endpoint 时保持本地草稿并提示）；
    - 支持「从 Uber 拉取 / 保存本地配置 / 推送到 Uber」闭环。

## 6. 社媒雷达（Social Radar）
- 路径：`/social-radar`
- 功能：社媒指标汇总、最新评论处理、AI 回复与回撤窗口、外部提及监控。

## 7. 设置中心（Settings）
- 路径：`/settings`
- 功能：
  - 餐厅基础配置；
  - Agent 开关与刷新策略；
  - 执行策略与模型路由；
  - 三方集成状态检查与测试；
  - 外卖平台授权入口统一放在 Integrations（点击对应平台进行授权/断开，授权成功后回跳订单中心）。

## 8. 账户中心（Account）
- 路径：`/account`
- 功能：用户与组织信息、订阅状态、团队成员、API 配置提示。

## 9. Agent 管理（内部）
- 路径：`/agent-management`（`agenttune.restaurantiq.ai`）
- 功能：内部可视化编排与配置 Agent（模型、提示词、参数、连线关系）。
- 访问策略：内部域名 + 登录白名单控制。

## 10. 对话式经营执行（Conversational Ops）
- 路径：`/ops-copilot`
- 目标：把“聊天输入”升级为“可审计、可审批、可回滚”的经营动作执行系统。
- 当前能力：
  - 自然语言指令解析（中英）并生成结构化执行预览；
  - 状态机流转：`draft -> parsed -> awaiting_confirmation -> awaiting_approval -> scheduled -> executing -> synced/partially_failed -> completed/rolled_back`；
  - 高风险动作审批门槛、定时生效、自动恢复时间配置；
  - 多平台同步结果可视化（成功/失败分平台）；
  - UberEats 优先执行适配层（可配置真实写回 endpoint）；
  - 失败补偿重试队列（可见重试次数/下次重试时间）；
  - 全链路审计日志（谁触发、谁审批、状态如何变化）。
- 设计原则：先保证“可控执行”，再逐步提升“自动执行”覆盖。

## 11. 鉴权与权限
- 登录/注册：Clerk（`/sign-in`、`/sign-up`）
- 受保护页面：分析、设置、账户、订单中心、菜单管理、Agent 管理等。

## 12. API 与集成层
- 核心接口：
  - `/api/analysis`、`/api/execute`
  - `/api/ops/commands`、`/api/ops/commands/[commandId]`
  - `/api/delivery/management`
  - `/api/delivery/orders`、`/api/delivery/orders/[orderId]`
  - `/api/integrations/*`（UberEats / Meta / Google Business / Yelp / Maps / Weather）
  - `/api/webhooks/ubereats`
- 安全规则：所有敏感 key 仅放服务端环境变量，不落前端。

## 本次新增（2026-03-08）
- Uber 门店运营配置闭环（菜单管理页）：
  - 新增 Store Ops 可视化配置面板，覆盖营业时间、假期、在线状态、备餐参数、促销草稿；
  - 新增 `GET/PATCH /api/delivery/store-ops`；
  - 增加 `integration_enabled` 检测与告警，便于快速发现 nominated integrator 绑定问题；
  - 推送回执与同步告警在同页展示，便于运营复核。
- 外卖新单提醒与操作闭环增强：
  - 新增全局“新订单弹窗”（非 Agent Studio 页），后台任意页面都能收到新单提醒；
  - 弹窗支持一键执行履约动作：`接单 / 开始制作 / 标记待取 / 完成 / 取消`；
  - 新增订单动作接口：`POST /api/delivery/orders/[orderId]/actions`，支持真实 Uber 动作回写（配置 action endpoint 时）；
  - 未配置 Uber 动作 endpoint 时，系统会给出 warning 并执行本地状态回写，避免前台卡死。
- Uber 订单可见性增强（防漏单）：
  - 新增 Webhook 订单标准化解析层，将 Uber 推送事件解析为统一订单结构；
  - `Delivery Management` 数据接口改为合并三路订单源：
    - 本地状态
    - Webhook 解析订单

## 本次新增（2026-03-11）
- 分析中心业务定位与深度分析增强：
  - 新增地址自动补全接口：`POST /api/analysis/address-autocomplete`；
  - `POST /api/analysis` 新增 `compareMode` 支持，用于“分析/对比”双模式；
  - 商家分析结果新增：`reviewDeepDive / consumerProfile / competition / platformIntel / comparison`。
- 分析入口交互回调优化：
  - 地址输入区恢复为“输入地址 -> 搜索商家 -> 返回 business name 候选列表 -> 选择后分析/对比”；
  - 保留新的分析链路与对比输出逻辑，仅调整入口体验为候选商家选择模式。
- 运营数据上传区新增“运营数据分析”可视面板：
  - 展示 Agent A 解析清洗进度、数据健康度、优先问题与执行建议；
  - 保持“上传文档默认折叠”策略，减少页面干扰。
- Nova Act 适配预留：
  - 新增 `lib/server/adapters/nova-act-market-scan.ts`；
  - 支持通过 `NOVA_ACT_*` 环境变量切换真实抓取与安全回退输出。
    - 实时订单查询结果（若配置 live endpoint）
  - 即使 Webhook 存在延迟，订单看板也能通过实时查询兜底显示新单。
- 环境变量模板新增：
  - `UBEREATS_ORDER_ACTION_ENDPOINT_TEMPLATE`
  - `UBEREATS_ORDER_ACTION_METHOD`

## 历史更新（2026-03-06）
- Copilot 稳定性修复：
  - 修复“经营 Copilot 指令队列持续闪烁/反复刷新”问题；
  - 通过稳定 `useToast` 实例，避免 effect 重复触发 API 加载。
- 分析中心上传区交互优化：
  - 已上传文档默认折叠；
  - 用户按需点击“展开已上传”查看详情，减少页面干扰。
- 外卖管理接入流重构：
  - 首次进入仅展示平台接入卡片；
  - 平台卡片操作统一为“授权接入 / 取消链接”；
  - 未接入时隐藏运营工作区，接入后自动解锁菜单/订单/查询/自动化模块。
- 外卖管理工作台 UI 重构（Deliverect/Otter/StreamOrder 迁移友好）：
  - 新增左侧工作台导航（订单中台/菜单中台/订单查询/自动化/事件流）；
  - 订单中台改为“三栏操作”：状态筛选与列表、订单详情、履约动作；
  - 菜单中台改为“工具栏 + 大表格”模式，支持多维筛选与渠道价格编辑；
  - 新增移动端专用布局：
    - 横向可滚动工作台 tabs；
    - 订单/菜单/查询移动卡片流；
    - 仅看已接入平台菜品筛选开关；
  - 目标是让从上述三平台切换过来的用户可以低学习成本直接上手。
- 外卖管理可调用功能可见化：
  - 将高频可调用功能按钮常驻在统一操作台，不再分散隐藏在多个子区块；
  - 履约动作区支持按当前选中订单直接执行 `接单 / 开始制作 / 标记待取 / 完成 / 取消`；
  - 平台接单开关区支持按平台直接 `暂停接单 / 恢复接单`。
- 移动端布局修复（Dashboard/Analysis）：
  - 顶部导航在小屏下将“运行分析”收敛为图标按钮，避免语言切换后按钮挤压；
  - `Analysis` 上传区按钮改为移动端纵向排列，修复按钮文字竖排与超出卡片边界问题；
  - `PageHeader` 操作区改为移动端自适应换行，避免标题与操作控件互相挤占；
  - Dashboard 日报文本增加断词保护，防止英文长句把页面撑出横向滚动。
- 外卖管理模块升级为全流程工作台：
  - 新增开通工作流与订阅/授权/同步状态推进；
  - 新增运营 KPI 区与平台接入中心；
  - 新增订单查询与订单详情（平台原始字段）能力；
  - 保留并增强菜单、接单、自动化、Webhook 事件联动。
- 对话式经营执行模块（P0）上线：
  - 新增 `/ops-copilot` 页面；
  - 新增自然语言指令解析与结构化执行预览；
  - 新增审批/定时/执行/回滚状态机与审计日志；
  - 新增后端接口：`/api/ops/commands`、`/api/ops/commands/[commandId]`；
  - 新增“真实执行 + 重试补偿”能力：
    - `UberEats` 平台执行适配器（需配置 `UBEREATS_MENU_MUTATION_ENDPOINT`）；
    - 重试队列持久化（`.runtime/ops-retry-queue/*.json`）。

## 本次新增（2026-03-28）
- **LocationIQ / 选址漏斗（Business IQ）分析引擎 V2.0**
  - 免费速评与付费深度报告提示词升级为 V2.0 框架（5 维评分卡、事实→影响→建议、GO/CAUTION/NO-GO、付费钩子；付费版覆盖贸易区/客流/竞对/三场景营收/风险矩阵/90 天作战等思想）。
  - 提示词集中在 `lib/funnel/iq-prompts-locationiq-v2.ts`；OpenAI 直连与 n8n `RestaurantIQ - Analyze` / `RestaurantIQ - Full Report` 工作流 **Validate+Prompt** 节点保持语义对齐（`response_format: json_object`）。
  - 付费全量报告：n8n webhook 请求体与 `runFullReport` 一致，携带 `headline`、`reason`、`language`、`market_data`；返回 JSON 键与报告页 / `fullSchema` 一致（如 `executive_summary`、`risks[5]` 等）。
  - 相关接口：`/api/funnel/analyze`、`/api/funnel/full-report`、Stripe 支付完成后生成全量报告路径。

## 本次新增（2026-08-14）
- **LocationIQ 支付履约修复：延迟生成全量报告**
  - `/iq/success` 返回页与 Stripe webhook 此前在标记 `paid` 之前同步生成全量报告（耗时数分钟），受默认函数超时（约 10–15 秒）限制会被中断，导致用户已付款但报告持续显示锁定。
  - 两条路径现改为 `deferFullReportGeneration: true`（与访问码兑换路径一致）：先快速写入 `paid=true`，再由报告页通过 `/api/funnel/full-report`（`maxDuration: 300`）带进度条生成全量报告。
  - 涉及文件：`app/iq/success/page.tsx`、`app/api/funnel/stripe/webhook/route.ts`、`lib/funnel/iq-complete-purchase.ts`（已有参数，无改动）。
- **访问码解锁增强：内置 `TESTFREE` 测试码 + 更准确的解锁错误提示**
  - `/api/funnel/redeem-access-code` 除环境变量 `IQ_ACCESS_CODE` 配置的码外，恒定接受内置测试码 `TESTFREE`（不区分大小写），便于 QA 免 Stripe 解锁付费报告。
  - 结果页在 `reportId` 缺失（分析结果未成功入库）时，解锁/支付按钮改为提示"报告尚未保存成功，请重新运行分析后再解锁"，替换原先误导性的"暂时无法支付"。

## 本次新增（2026-08-15）
- **付费全量报告生成提速（修复 89% 超时）**
  - LLM 客户端显式超时：MiMo 120 秒（`MIMO_TIMEOUT_MS` 可调）且不自动重试；OpenAI 120 秒、最多重试 1 次。此前 SDK 默认 10 分钟超时 + 自动重试，单次挂起请求即可耗尽 300 秒 serverless 预算。
  - 浏览器触发的精简生成路径（首次进入报告页）改用快速模型：MiMo 主路由时用 `mimo-v2-flash`（`MIMO_IQ_FULL_LEAN_MODEL` 可调），输出上限 10K token，关闭 thinking；提示词改用紧凑版市场数据摘要（不再注入完整大 JSON）。
  - 「重试生成」（quality 模式）保持 `mimo-v2.5-pro` 完整管线（深度市场数据 + 双模型校验）不变。
- **报告质量升级：数据看板 + 全链路数据溯源 + 自动专业版**
  - 新增 `ReportDataViz` 数据看板：竞对热度（按评论数，Google/Yelp 原始值）、ACS 高收入家庭结构、营收情景 vs 确定性盈亏平衡/安全线（D-4）、关键指标卡（人口/收入中位数/学历/竞对数/评分）。所有图表数值直接读取 `market_data_json` 原始数据，绝不使用 LLM 生成的数字；数据缺失时明确标注、不做虚构填充。
  - 新增「数据溯源」附录：逐源列出 Google Places / Yelp / Foursquare / Census ACS / D-4 财务模型的状态、覆盖范围与获取时间。
  - 报告分层：首次生成为 `standard`（快速版，秒级出报告）后，页面自动在后台重新生成 `professional`（完整市场数据 + 双模型交叉验证）并自动刷新替换；页面顶部有生成中提示。
  - 深度研究轮询上限从 300 秒压缩至 75 秒（`DEEP_RESEARCH_TIMEOUT_MS` 可调），确保专业版整体管线可在 serverless 预算内完成，超时自动降级为普通检索。
- **LLM 主引擎切换为 Anthropic Claude**
  - 新增 Anthropic 提供商（官方 `@anthropic-ai/sdk`，默认模型 `claude-opus-5`）：只要配置 `ANTHROPIC_API_KEY`，免费速评、付费全量报告、双模型交叉验证均默认由 Claude 生成；MiMo / OpenAI 自动降为备选链路。
  - 路由规则：主提供商可用 `IQ_PRIMARY_PROVIDER=anthropic|mimo|openai` 覆盖；备选自动选择与主提供商不同且已配置密钥的引擎。修复了免费分析在 OpenAI 未配置时直接报错、不走路由器的问题（此前 OpenAI 额度耗尽即 429 全线失败）。
  - Claude 路由带 120 秒超时、`output_config.effort` 分层（速评/精简 low、完整报告 high、验证 medium），thinking 预算计入 max_tokens 已按 1.5 倍留余量。
  - 新增可选环境变量：`ANTHROPIC_IQ_PARTIAL_MODEL` / `ANTHROPIC_IQ_FULL_MODEL` / `ANTHROPIC_IQ_FULL_LEAN_MODEL` / `ANTHROPIC_IQ_VERIFY_MODEL` / `ANTHROPIC_TIMEOUT_MS`（均有默认值）。
- **新增 LLM 路由诊断探针**：`/api/health?probe=iq-llm` 返回当前解析出的主/备 LLM 提供商与模型（仅布尔与模型名，不含密钥），用于验证 Claude 切换是否生效。
- **修复 Claude 完整报告二次超时**：Anthropic 客户端改为流式输出（长 JSON 生成不再被固定请求超时掐断），总预算 240 秒（`ANTHROPIC_TIMEOUT_MS`）且不自动重试；完整报告推理深度调为 medium（Opus 5 的 medium ≈ 上代 high，速度更快），输出预算上限 16K token。
- **付费报告管线加入硬性时间预算（根治反复超时）**
  - 新增 `lib/funnel/iq-deadline.ts`：路由入口按 300 秒 maxDuration 建立 wall-clock 预算（预留 20 秒收尾），各阶段按剩余时间自我裁剪。深度研究（最长 75 秒）仅在剩余 ≥150 秒时执行；双模型验证仅在剩余 ≥90 秒时执行；剩余不足 25 秒直接快速返回可重试提示，而不是撞破 300 秒上限。
  - LLM 调用改为接收剩余预算作为硬超时（Anthropic 客户端支持按调用传入 timeout），并新增耗时/输出 token 日志（`[anthropic]`、`[funnel/full-report]`）便于定位瓶颈。
  - 快速路径改用 `claude-sonnet-5`（`ANTHROPIC_IQ_FULL_LEAN_MODEL` 可调）并**关闭 extended thinking**：Opus 5 的思考默认开启且计入 max_tokens，是首屏延迟的主因。
  - 「重试生成」按钮改为重跑快速路径（此前送 `quality: force`，一点重试就触发深度研究+完整生成+双验证三重串行，必然超时）；专业深度版仍由报告页后台自动升级触发（`quality: true` 显式指定）。
- **修复快速版报告"生成失败"（输出被截断）**
  - 快速路径输出上限从 10K 提到 16K token：完整报告 JSON 装不下 10K，会在中途被截断导致解析失败（表现为约 130 秒后「完整报告生成失败」）。
  - 新增 `lib/funnel/llm/json-repair.ts`：当响应因 `max_tokens` 截断时，自动闭合未完成的结构、抢救出模型已写完的章节，而不是整份报告作废（已用 6 个截断点单测验证）。
  - 备选提供商顺序调整：Claude 为主时优先回落 MiMo 而非 OpenAI（OpenAI 账户额度耗尽会立刻 429，等于没有兜底）。
- **完整报告失败原因可观测（不再被吞掉）**
  - 此前无论真实原因是什么，付费报告失败都统一抛出 `FULL_REPORT_GENERATION_FAILED`，前端只看到「完整报告生成失败」，线上无法定位。现在提供商的原始错误会随错误一并抛出，并通过 `/api/funnel/full-report` 响应的 `detail` 字段返回（仅含提供商/模型名与 API 错误文本，不含任何密钥）。
  - LLM 路由器新增 `attempts` 诊断：记录主/备每一条链路的 provider、model 与失败原因（超时、模型不可用、JSON 不可解析、配额 429 等），并汇总进错误信息。此前路由器对所有失败一律返回 null，主备两条链路的失败原因全部丢失。
  - 新增 `/api/health?probe=iq-claude` 实时探针：并行发起 4 组极小的 Claude 调用矩阵（免费速评等效配置、快速完整报告配置、关闭 thinking 的对照组、专业版模型），返回每组的模型、耗时、stop_reason、输出 token 数与原始报错，用于区分「模型不可用」「参数组合被拒」「输出被截断」三类原因；同时返回备选提供商密钥是否配置。
  - 新增 `/api/health?probe=iq-full-report&reportId=<id>` 复现探针（`maxDuration=300`）：用数据库中真实报告的 `market_data_json` 跑一遍快速路径生成管线，成功时返回耗时/提供商/模型/报告长度，失败时返回**未经掩盖的原始错误与调用栈**。iq-claude 矩阵已证明 API 与参数本身正常，因此只有用真实 prompt 才能复现故障。
  - 复现探针的结果同时写入新表 `iq_diagnostics`（service role 写入，deny-all RLS，不对客户端开放）：完整报告生成通常超过 HTTP 客户端的 60 秒上限，把结果落库后即使调用方已经放弃响应，也仍能读到真实错误。
  - 新增 `/api/health?probe=iq-full-prompt&reportId=<id>`：用真实报告的完整 prompt（与快速路径逐字一致）同时调用 Claude 与 MiMo 备选链路，但把输出上限压到 1.2K token，因此可在 HTTP 超时之内返回。返回 prompt 各部分字符数（market_data / system / user / 白名单条数）与两条链路各自的结果与原始报错——用于区分「输入本身有问题」与「生成太长/太慢」。
- **MiMo 备选链路失败原因可观测**：`runMimoJson` 此前对任何失败（HTTP 报错、空响应、JSON 解析失败）一律返回 null，备选链路为什么没兜住完全不可见。现在新增 `MimoDiagnostic`（model / maxTokens / 耗时 / finish_reason / 输出 token 数 / 文本长度 / 解析结果 / 原始报错），并接入路由器的 `attempts` 汇总。
- **`iq-full-prompt` 探针支持 `&maxTokens=`**（上限 8K，默认 1.2K）：用两个不同输出上限各测一次，即可把这条 ~3 万 token prompt 的固定预填充耗时与逐 token 解码速率分离出来——这个速率决定了 16K token 的完整报告在路由预算内到底能不能生成完。
- **根因修复：备选链路模型失效 + 输出预算与剩余时间脱节**
  - 生产实测（`probe=iq-full-prompt`，真实报告 prompt 约 3 万输入 token）：`claude-sonnet-5` 关闭 thinking 时，1200 token 上限耗时 21,994ms，2400 token 上限耗时 32,995ms。即**解码约 9.2ms/token（≈109 token/s）**，预填充+网络固定开销约 11 秒。
  - 由此得出：固定 16K 输出上限意味着约 160 秒纯解码；若开启 thinking（专业深度版走 Opus + thinking）则根本装不进 300 秒窗口，调用会在生成中途被硬超时掐断，整份报告失败。
  - 新增 `outputTokenBudget(remainingMs, {thinking})`：按剩余时间反推本次真正付得起的输出 token 数（预留 15 秒预填充，非 thinking 按 10ms/token、thinking 按 20ms/token 计，下限 2000、上限 16000）。生成因此总能跑完；模型若还想写更多，则在已知位置被截断并由 json-repair 修复。
  - 阶段预算门槛按实测重算：深度研究 150s → **200s**，双模型验证 90s → **120s**，生成下限 25s → **35s**。
  - **修复 MiMo 备选链路完全失效**：快速路径此前硬编码 `mimo-v2-flash`，接口返回 `400 Unsupported model`，即备选链路每次都瞬间失败，背后只剩已无额度的 OpenAI——这正是「主链路一旦没跑完就整单失败」的原因。默认改为与非精简路线一致的模型，并可用 `MIMO_IQ_FULL_LEAN_MODEL` 覆盖。
  - 新增 `/api/health?probe=iq-mimo-models`：列出该账号实际可调用的 MiMo 模型，避免再用猜测的模型名。
- **清除重复的模型默认值（此前正是这个重复让已修好的路由看起来仍未修好）**
  - `mimo-v2-flash` 同时是免费速评（`MIMO_IQ_PARTIAL_MODEL`）与快速完整报告的默认模型，两处都已失效；改为 `mimo-v2.5` / `mimo-v2.5-pro`（由 `probe=iq-mimo-models` 实测确认账号可调用：`mimo-v2.5`、`mimo-v2.5-pro`）。
  - 新增 `RETIRED_MIMO_MODELS` 白名单校验：环境变量若仍指向已下线的模型 id，按未设置处理并回落到有效默认值，避免一个陈旧的 Vercel 环境变量再次让整条备选链路瞬间失败。
  - 新增 `resolveIqRouteResolved(task, {useFallback, fastModel})`：探针与诊断一律走它解析主/备链路，不再各自复制模型字面量。
- **MiMo 也支持截断修复 + 解码速率常数按三点实测修正**
  - MiMo 此前没有截断修复：作为备选链路时，只要输出触到上限，一份几乎写完的报告会因最后几个字符而整份作废（实测 `finish_reason=length` → `parsed=failed`）。现在与 Anthropic 客户端一致，触顶时调用 `repairTruncatedJson` 抢救。
  - 解码速率按三个实测点（700 / 1200 / 2400 token 上限）重新拟合：同一配置两次 2400 的耗时相差约 2.4 秒，因此改用最宽跨度（700→2400）得出的 ~12.3ms/token，并留出余量取 **13ms/token**（thinking 路线 26ms）。低估这个速率正是报告失败的机制——预算会买下超过时间所能解码的 token 数，调用随即在生成中途被掐断。
  - `probe=iq-full-report` 新增 `&budgetMs=`（上限 240s）：预算调小则推导出的 token 上限同步变小，因而整条管线可以在 HTTP 客户端超时之内完整跑完并验证。
- **复现探针支持后台模式（`&defer=1`）与专业深度模式（`&quality=1`）**
  - 完整预算下的一次生成耗时以分钟计，超过任何 HTTP 客户端的等待时间；而请求一旦中断，serverless 函数会随之被终止——这正是此前两次复现尝试连一行诊断都没留下的原因。现改用 Next.js `after()`：响应先返回，生成在后台继续，结果无论成败都写入 `iq_diagnostics`（含 mode / quality / budgetMs / 耗时 / 提供商 / 模型 / 报告长度 / 原始错误）。
  - `&quality=1` 走非精简（专业深度）路径，用于验证 Opus + thinking 这条真正出问题的链路能否在预算内跑完。
- **真正的根因（已由生产诊断记录确认）：Claude 正常生成完毕，但 JSON 无法解析，而修复逻辑只在 `max_tokens` 时才触发**
  - `iq_diagnostics` 中 09:57 的记录还原了用户遇到的那次失败：`anthropic/claude-sonnet-5: stop=end_turn out=15530 parsed=failed | mimo/mimo-v2-flash: no parseable JSON returned`，最后 `openai/gpt-4o: 429 无额度` → 整单失败（耗时 201,590ms）。
  - 关键点：`stop_reason=end_turn` 表示模型是**正常写完**的，并非被截断；但输出的 JSON 无法解析。而截断修复此前被限定在 `stop_reason === 'max_tokens'` 分支内，因此救援逻辑根本没有执行——一份 15,530 token 的完整报告，因为格式问题被整份丢弃。
  - 修复：只要解析失败就尝试修复（Anthropic 与 MiMo 两个客户端一致），不再看 stop_reason。
  - 新增 `sanitizeJsonControlChars`：转义字符串字面量内部的裸控制字符（换行/制表符等）。中文长段落输出最容易出现这种情况，且文档结构是完整闭合的，单纯补括号救不回来——这才是真正能还原它的变换。修复逻辑同时尝试「裁剪到最后一个 `}`」，以覆盖「markdown 代码围栏 + 内嵌换行」这种两条路径都失效的组合。已用 9 个用例验证（含中文换行、制表符、截断、围栏、尾随散文、嵌套数组截断、无花括号）。
  - 顺带确认：201,590ms / 15,530 token ≈ 13ms/token，与本次设定的解码速率常数一致。
- **备选链路不再无视剩余预算**：实测一次 `budgetMs=68000` 的运行实际耗时 148,449ms——Claude 用完 68 秒后，MiMo 又以自己全新的 120 秒超时重新开始。现在 `runMimoJson` 接受 `timeoutMs`，路由器按「总预算 − 已耗时」把剩余时间交给备选链路。
- **专业深度版的 thinking 解码速率改为实测值（此前是推测，且推测错了）**
  - 后台实测：`claude-opus-5`（thinking 开、effort medium）在 240 秒预算下实际耗时 **296,334ms** —— 超预算 56 秒。虽然报告本身生成成功（8,966 字符），但在真实路由的 300 秒上限下这就是失败。
  - 其推导出的输出上限为 8,653 token，故单 token 成本**至多** ~34ms；且只有在「跑满了整个上限」时才恰好是 34ms，若提前结束则真实速率更高。因此常数取 **40ms/token**（而非按乐观读数拟合的 36），此前的 26ms/token 是按「Sonnet 的两倍」推测出来的，纯属错误。
  - 按实测速率复核各阶段：标准版满预算余量 104s、专业版不跑深度研究余量 42s、跑完 75s 深度研究后余量 32s、剩余 160s 时余量 25s——全部可在预算内跑完。
  - `IqRouteAttempt` 现在在**成功时**也记录耗时 / 输出 token 数 / stop_reason / maxTokens：只有拿到 token 数，观测到的墙钟时间才能换算成单 token 速率。结果通过 `_generation_attempts` 一并写入诊断记录。
- **两条链路端到端验证通过，并据此纠正解码速率模型**
  - 后台实测（预算均为 240 秒）：标准版 `claude-sonnet-5` 耗时 **180,450ms**、输出 13,885 token、`stop=end_turn`、报告 17,697 字符；专业版 `claude-opus-5` 耗时 **194,023ms**、报告生成成功。两者均在预算内完成。
  - 关键验证点：标准版这次正是此前失败的同一形态——`stop_reason=end_turn` 且输出上万 token——现在解析成功并产出完整报告。
  - 单次调用的实测速率：sonnet **13.0ms/token**、opus **17.2ms/token**。据此纠正了「thinking 使速率翻倍」的错误模型：thinking token 本身就是计入 max_tokens 的普通输出 token，并不会让每个 token 变慢，只是把预算花在推理而非报告上。此前 40ms/token 的常数，是用「一次运行的总耗时」除以「单次调用的上限」得出的——而专业路径实际会发起**第二次生成**（竞品白名单校正重试），所以那个总耗时涵盖了两次调用，速率被放大了约一倍。
  - 速率改为按模型区分：`MS_PER_TOKEN_FAST=13`、`MS_PER_TOKEN_DEEP=19`（在 16K 上限处 1ms 误差即 16 秒，故留足余量）。
  - **重试也纳入预算**：`shouldRetryForCompetitorGrounding` 与完整度重生成此前完全不看剩余时间——一次调用装得下、两次就装不下，这正是专业版跑到 296 秒的原因。现在每次尝试都按「剩余时间」重新推导输出上限，剩余不足 35 秒则直接跳过重试。
  - 复核结果：标准版满预算余量 61s、专业版满预算余量 29s、专业版跑完深度研究后余量 22s。专业版输出上限也从 5,625 提升到 13,947 token（此前因速率高估，专业版反而比标准版更短）。
- **专业深度版最终验证通过**：预算 240 秒、实际 **201,169ms**（余量 39 秒），`claude-opus-5` 输出 11,840 token，报告 **13,047 字符**（修正速率前仅 4,440）。单次调用实测 17.0ms/token，低于配置的 19ms/token，余量真实存在；重试因预算已用尽而被正确跳过。
- **计费型探针改为默认关闭**：`iq-claude` / `iq-full-prompt` / `iq-full-report` 每次调用都会真实消耗 LLM 额度，而 `/api/health` 是公开路由——此前任何人拿到一个 report id 就能持续烧额度。现在这三个探针需要 `IQ_DIAG_KEY` 且必须以 `?key=` 匹配；未设置该环境变量时直接返回 404。其余只读探针（`iq-supabase` / `iq-llm` / `iq-n8n` / `iq-mimo-models`）不受影响。
## 本次新增（2026-08-18）
- **LocationIQ 多 Agent 分析引擎 V3（对标专业选址机构方法论）**
  - 新增 `lib/funnel/agents/` 引擎：确定性指标层 → 五位专家 Agent 并行（市场人口 / 竞争情报 / 场址可达 / 财务建模 / 风控）→ 代码计算决策矩阵 → 合伙人综合撰写 → QA 质检（不通过强制修订一轮）。
  - 确定性指标层（`metrics.ts`，公式可复算、禁止 LLM 改数）：贸易区需求池（BLS CEX 2024 户均外出就餐 $3,945/年、收入弹性 0.8）、饱和度（对标美国 2.2 家/千人）、公平份额营收模型（需求池÷贸易区餐厅数×吸引力乘数 0.5–2.0x 封顶）、8% 租售比红线与日均单数盈亏点、Caltrans AADT 车流。
  - V2.0 五维权重（客流 25% / 人群 20% / 竞争 20% / 可达 20% / 租金 15%）由代码计算并锁定，`dashboard.overall_score` 恒等于加权综合分；免费版速评同样注入计算指标摘要。
  - 财务模型内置行业基准：三场景法（悲观=营收-20%/成本+5%）、爬坡曲线（首月 40-50%）、Prime Cost（快餐 55-60%）、营收三角验证。
  - 接入方式向后兼容：付费报告链路为 多Agent → n8n → 单次调用降级；`IQ_ENGINE=legacy` 一键回退。
- **分析引擎切换至 Claude（Anthropic SDK）**
  - 新增 `lib/funnel/agents/llm.ts` 提供方层：设 `ANTHROPIC_API_KEY` 后 Claude（默认 `claude-opus-5`）为主引擎，OpenAI 为备用；`IQ_LLM_PROVIDER` 可强制指定；`ANTHROPIC_IQ_MODEL / _AGENT_MODEL / _FULL_MODEL` 分层配置。
  - 处理 Claude `refusal` 停止原因、Markdown 围栏剥离、JSON 解析失败自动修复重试一次。
  - 修复：n8n 失败降级不再回环调用失败的 webhook；`gatherIqMarketDataFromGoogle` 现在填充 `geocode.city/state`（解锁 Caltrans 车流与商业挂牌城市检索）。
- **新增诊断接口 `/api/health/analyze`**：实测 Anthropic / OpenAI / N8N 三通道连通性（延迟、可达性、可操作提示），用于快速定位 "Failed to analyze location" 类故障。

## 本次新增（2026-09-12）
- **付费报告改为后台分阶段生成（修复「89% 超时」）**
  - 根因：整条流水线塞在一个 300 秒的 HTTP 请求里；一次 Claude 解码 188 秒后输出非法 JSON → 重试撞墙 → 504；LLM 阶段零落库，重试从头再来。
  - 新增 `lib/funnel/iq-report-job.ts`：`enrich → draft → verify → finalize` 每阶段独立调用（`POST /api/funnel/full-report/worker`，`after()` 链式触发），各自 250 秒预算，进度与草稿落库 `generation_state_json`（迁移 `0008`）；重试从失败阶段续跑；卡死的任务由状态接口自动重新拉起。
  - `POST /api/funnel/full-report` 改为返回 202 入队；前端轮询 `GET /api/funnel/full-report/status`（按阶段的真实进度，不再是纯计时曲线）。语言预览与未迁移数据库自动走原同步路径。
  - Claude 调用启用结构化输出（`output_config.format`，schema 由 zod 报告 schema 生成，`lib/funnel/iq-report-output-schema.ts`），从根源杜绝「输出不是合法 JSON」；`IQ_STRUCTURED_OUTPUT=false` 可关闭。
  - 支付完成即后台起任务，用户到达报告页时常已生成完毕。
- **邮件送达报告**：生成页可留邮箱（`POST /api/funnel/full-report/notify`），finalize 阶段通过 Resend 发送报告链接（`RESEND_API_KEY`、`IQ_EMAIL_FROM`）；用户可直接离开页面。
- **该地址过往/现有商家评论分析（新数据点）**：`lib/funnel/external-data/site-history.ts` 用 Google Find Place + Nearby（≤45m）与 Yelp（≤60m）识别在**该地址本身**营业/曾营业的商家，拉取 Place Details / Yelp 评论，LLM 提炼正负面主题、关店信号与对新经营者的启示，写入 `market_data.site_history`；注入付费提示词锚点、竞对白名单、多 Agent 场址/竞争分析师；报告 `site_history` 字段扩展（prior_business_name/status、review_themes、lessons），报告页新增「该地址过往/现有商家与评论」板块。
- **修复移动端「PDF 无法下载」**：此前报告页先用 `fetch` 把 PDF 读成 Blob，再用脚本点击一个 `<a download>`——iOS Safari / 微信内置浏览器 / 多数 Android WebView 会直接忽略这种程序化下载（无任何反应或打开空白页）。现改为：先向 `/api/iq/report/[id]/pdf` 发送探测请求（`x-iq-pdf-probe: 1`，服务端只做已付费 / 报告就绪校验并返回 204，不启动 Chromium），通过后由浏览器自身导航到 PDF 地址完成下载——桌面浏览器原地保存文件，iOS 打开系统 PDF 预览并可分享 / 存入「文件」。未付费 / 未生成 / 服务端失败仍会在页面内给出可读的错误提示。

## 付费报告 360° 升级（研发提示词 v1.0）· Phase 0 基线（2026-09-12）
- 新增 `qa/golden_set/millbrae_1711.json`：把 Millbrae 报告（编号 5c361b95）暴露的 R1–R8 缺陷固化为回归基线（输入 + 观测到的缺陷 + 对应拦截门槛）。
- 新增 `npm run replay:golden -- millbrae_1711`（`scripts/replay-golden.ts`）：用当前付费链路重放该用例（不落库），输出到 `qa/out/`，并逐项扫描 R1–R8 是否仍然出现；缺少 API key 时以退出码 2 明确报错。
- 新增 `npm run test:iq`（Node 内置 test runner + tsx）与 `npm run qa:gates` 占位，供后续 Phase 使用；依赖新增 `tsx`（dev）与 `yaml`（参数表）。

## 360° 升级 · Phase 1 数据层（2026-09-12）
- 新增 `lib/iq/data/`：D1–D12 十二个数据模块，统一接口 `fetch(site, ctx) → DataResult{status: ok|partial|failed, data, source, fetched_at, license, cost_usd, coverage_note}`；任何失败都如实写入 `sources[]`，**绝不用估算值填充**。
  - D1 Census Geocoder（备用 Google Geocoding + Census coordinates / FCC）→ 经纬度 + block / block group / tract / county / ZCTA；D2 ACS 5-year **按 block group + tract 查询**（B01003 / B11001 / B19013 / B19001 / B01001 / B25010 / B11003 / B08301 / B25064 / B25077 / B25003 / C16001 中文使用者 + B02018 华裔）并从 TIGERweb 取 block group 几何——从根源消除「ZIP 无 ACS」（R2）；D3 LODES v8 WAC（`iq_lodes_wac`，`scripts/load-lodes.ts`）；D4 Mapbox 等时圈（步行 10 / 车程 5·10·15），无 token 时退化为直线半径并标 `[直线半径]`；D5 Overture Places 落库 `iq_poi`（`scripts/load_overture.py`，DuckDB 直读 S3）；D6 Google Places API (New) Nearby，Pro 字段掩码、**每报告 ≤ 6 次**、30 天缓存、免费额度内计 $0（`GOOGLE_PLACES_BILLED=1` 后按 $0.032/次记账）；D7 评论增速快照（`iq_poi_snapshot`，`scripts/snapshot-reviews.ts`）→ 相对客流等级；D8 租金对标（用户输入 + 挂牌页解析 + 一次联网检索），**对标 < 3 个不输出溢价 %**；D9 BART / Caltrain 站点表 + Caltrans AADT；D10 BLS CEX 2023 五分位外出就餐支出；D11 开发管线（一次检索，须带 URL）；D12 用户输入归一化（缺 CapEx → 回收期隐藏）。
- 参数表 `lib/iq/params/{defaults,cuisine_taxonomy,hubs}.yaml`（附录 A/B/C，zod 校验），`lib/iq/geo.ts` 几何工具（等时圈 × block group 面积加权采样），`lib/iq/model/schema.ts`（`report_model.json` 唯一事实源 schema，附录 D）。
- 迁移 `0009_iq_360_data_layer.sql`：`iq_poi`、`iq_poi_snapshot`、`iq_lodes_wac`、`iq_cost_log` 与报告行 `report_model_json / narrative_json / report_tier / report_cost_usd`。
- 验收：`qa/e2e-data.test.ts` 离线重放 Millbrae 用例——D2 返回 tract 级华裔与收入、D5 1 英里内 ≥ 30 家餐饮 POI 且中餐 ≥ 10、D6 ≤ 6 次、`sources[]` 12 项全部有状态、数据成本 ≤ $0.10；降级路径（无 Mapbox / 竞品源失效）逐一断言。`npm run test:iq` 99 项通过。本沙箱无法访问外网，线上首跑请以 `sources[]` 表为准核对各源状态。

## 360° 升级 · Phase 2 商圈引擎（2026-09-12）
- `lib/iq/engines/trade-area.ts`：固定四圈层 walk10 / drive5 / drive10 / drive15，block group 指标按「等时圈 × block group 面积份额」裁切汇总（人口、户数、户数加权收入中位、中文家庭占比、华裔人口、25–44 岁、有孩家庭、户均人数、租房比例、日间岗位、餐饮 / 中餐 / 菜系需求）；主商圈按菜系 `range_class` 选定（everyday → drive5，regular → drive10，destination → drive15）。
- 需求估算 §2.3：`餐饮支出 = 户数 × CEX(收入分位) × 区域系数`；`中餐支出 = 餐饮支出 × [p_cn × 0.55 + (1 − p_cn) × 0.08]`；`cuisine_share` 不拍脑袋——`lib/iq/engines/cuisine-share.ts` 按贸易区中餐供给的评论数 log 权重自校准（Laplace 平滑，3%–50% 截断）。
- `lib/iq/engines/demand-huff.ts`：Huff 引力捕获 `P_ij = A_j^α d_ij^−β / Σ A_k^α d_ik^−β`，`A = log(1 + 评论数) × (评分 / 4.2)`，β 按菜系 2.0 / 1.5 / 1.1，L2 权重 0.5；午市单独按 walk10 岗位 × 外食率 × 中餐份额 × 午市客单 × 21 天与 walk10 竞品分摊；输出捕获月需求、午晚拆分、按来源圈层堆叠、各竞品分流比例与 P 值分布。
- 验收（`qa/e2e-report.test.ts`）：Millbrae 四圈层表齐全；`coverage_ratio = 捕获 ÷ 保本` 各中间量可打印；菜系改为「中式快餐」时主商圈自动变为 drive5、β = 2.0、捕获需求随之变化。

## 360° 升级 · Phase 3 竞对引擎（2026-09-12）
- `lib/iq/engines/competitor.ts`：候选池 = Overture ∪ Google；去重（名字归一化 + ≤100 m + 同类型，保留两边 id，Google 的评分 / 状态优先）；三级子菜系分类器（类别映射 → 中英文店名关键词 → LLM 批量兜底 `lib/iq/narrative/llm.ts`，confidence < 0.6 归「其他中餐」）；四层竞争关系 L1 同子菜系 / L2 其他中餐 / L3 walk10 同价位场景替代 / L4 亚超・奶茶・点心・中文学校・华人银行锚点。
- 指标：每万居民 / 每万华裔的 L1 密度、L1 评论数 HHI、价格阶梯、品质缺口（均分 < 4.0 机会 / > 4.4 高门槛）、关店率、标杆营收带（月新增评论 × k=80 × 客单，历史不足时标 `relative_tier_only`）；集聚 U 型分（0 家 30 / 1–3 60 / 4–8 85 / 9–15 60 / >15 35，按 coverage_ratio ±10）。
- 空白分析：必须**同时**满足 drive10 华裔 ≥ 3,000、密度 < 枢纽中位数 50%、L2 ≥ 4，否则只能写「该品类供给较少」；枢纽中位数由 `scripts/refresh-hubs.ts` 月度预计算写入缓存。
- **竞品守卫（拦截 R1）**：metro 内该子菜系 ≥ 10 家而 drive10 内 L1+L2 = 0 → 「竞品抓取异常」；drive10 餐饮 POI < 15 且人口 > 20,000 → 「POI 覆盖异常」；D5/D6 同时失效 → 守卫不通过；触发即标记预检版、禁止付费交付。
- 验收：Millbrae L1（湘菜）≥ 1、L2 ≥ 15、L4 含亚超；人为清空 POI 表重放时守卫触发且不出现「空白」措辞。

## 360° 升级 · Phase 4 评分 · 财务自洽 · 置信度（2026-09-12）
- **唯一评分函数** `lib/iq/engines/cuisine-fit.ts`（拦截 R5）：六维 需求覆盖 25 / 客群匹配 15 / 竞争态势 20 / 可达与流量 15 / 财务可行 15 / 场景与外卖 10，权重和 = 100，`total = Σ 权重 × 分 ÷ 100`；≥ 75 GO / 60–74 CONDITIONAL GO / < 60 NO GO；缺输入的维度记中性 50 并写明「未知」，绝不编数；条件由得分最低两维自动生成，数字反算自模型（如「租金需谈至 ≤ $X 使占用成本比 ≤ 10%」）。
- 替代菜系 §4.2：同一地址对附录 B 全部 14 个子菜系重跑（只换竞品集合、β、价位、需求份额），输出排名与用户菜系名次；蚕食分析 §4.3：已有门店用同一 Huff 模型算分流比例。
- **财务自洽** `lib/iq/engines/finance.ts`（拦截 R4）：`堂食覆盖 = seats × turns`、`外卖单 = 堂食 × r/(1−r)`、`月营收 = (堂食 × 客单 + 外卖 × 外卖客单) × 营业日`；去掉入座率；三情景只改 turns / 外卖占比 / 客单，表中单量由函数反算并断言 |Δ| < $1；敏感性（租金 +10%、翻台 −0.5、客单 −12.5%、外卖 +15pt）同一函数；**无 CapEx 则 `payback_months = null`**（拦截 R6）。
- **置信度** `lib/iq/engines/confidence.ts`：`Σ w_s × q_s`（ACS 20 / 竞品 25 / 客流代理 15 / 租金对标 15 / 日间人口 10 / 交通 5 / 开发管线 5 / 用户输入 5，q ∈ {0, 0.5, 1}），< 60 预检版。
- `lib/iq/pipeline.ts` `runReport360`：数据层 → 引擎 → `report_model.json`（zod 校验，附录 D）；`npm run replay:golden -- millbrae_1711 --engine v360` 可重放。风险登记 `engines/risk.ts` 与客群画像 `engines/audience.ts` 只用模型数字填模板。
- 验收（`qa/e2e-report.test.ts`）：所有分数 = `score()` 输出、权重和 100、三情景单量 ↔ 营收互相反算一致、无 CapEx 时回收期为 null、替代菜系表 14 行；`npm run test:iq` 102 项通过。

## 360° 升级 · Phase 5a 叙事层（2026-09-12）
- `lib/iq/narrative/templates.ts`：14 页信息架构（§5.2）与确定性模板句（只用模型数字 + `[src:字段路径]`）；`pageFragment` 给每页切出只读 JSON 片段。
- `lib/iq/narrative/generate.ts`：附录 E 提示词逐页生成（页面用快速模型，执行摘要用 Claude），输出 `{title ≤ 28 字且含判断, body ≤ 120 字, refs}`；`lib/iq/narrative/number-guard.ts` 校验叙事中每个数字（含 $ / % / 万 / 单 / 家）都能在该页 JSON 片段中找到（±1 舍入）、引用路径存在、禁用词（零竞争 / 空白 仅在 `void.is_void` 时允许；保守估计 / 大约 一律禁止）；失败重生成一次，再失败用模板句替代并标注 `guard`。执行摘要的「签约前条件」必须逐字复制 `score.conditions`。
- `lib/iq/generate.ts` `generateReport360`：管线 → 叙事 → QA 门槛 → 落库 `report_model_json / narrative_json / report_tier / report_cost_usd` → `iq_cost_log`；新增 `POST/GET /api/iq/report360/[id]`（202 后台生成；`?sync=1` + worker secret 同步返回）。

## 360° 升级 · Phase 6 质量门槛与回归测试（2026-09-12）
- `lib/iq/qa/gates.ts`（`npm run qa:gates [model.json]`）：① schema 校验（附录 D）② 数据完整性（置信度 ≥ 60、竞品守卫通过、D1/D2/D5 = ok）③ 合理性（中文家庭占比 ≤ 100% 且与县值同数量级、租金 $1–$15/sf/月、高人口区零竞品异常）④ 数值自洽（三情景反算、保本 = 固定成本 ÷ 边际贡献、权重和 = 100、总分 = Σ、无 CapEx 不得有回收期、coverage_ratio 一致）⑤ NumberGuard ⑥ 禁用措辞；任一失败 → 预检版。
- `lib/iq/qa/gates.test.ts`：Millbrae 原始缺陷 R1、R2、R4、R5、R6、R8 各有一个失败用例被拦截（R3 由 Phase 5b 视觉回归、R7 由地图页覆盖）。
- Golden set 回测：`qa/golden_set/backtest_bay_area.json`（6 家经营 ≥ 4 年门店 + 6 家已关门店，标签需用 D6 `business_status` 复核）与 `scripts/backtest-golden.ts`（评分 AUC ≥ 0.75 才允许上线；本沙箱无网络，需在有网环境执行）。

## 360° 升级 · Phase 7 成本控制与运营（2026-09-12）
- 单份报告变动成本预算 ≤ $0.50：数据 ≤ $0.10（Overture 月度落库、ACS / LODES 12 月缓存、Google ≤ 6 次 + 30 天缓存且免费额度内计 $0、等时圈按 100 m 网格缓存）、LLM ≤ $0.25（子菜系分类批处理 $0.002/家并按月复用；叙事每页 ≤ 600 token 约 $0.004，仅执行摘要用 Claude 约 $0.03）、检索 ≤ $0.06（租金 + 开发管线各 1 次）、渲染 ≈ $0.02。`CostLedger` 逐项记账，`persistCostLog` 写入 `iq_cost_log`，合计 > $0.50 记录报警日志。
- 运营脚本：`scripts/load_overture.py`（月）、`scripts/snapshot-reviews.ts`（月）、`scripts/refresh-hubs.ts`（月）、`scripts/load-lodes.ts`（年）、`scripts/refresh-cex.ts`（年）、`scripts/backtest-golden.ts`（每次参数变更）。
- 降级策略均落在 `sources[]`：Google 配额耗尽 → 只用 Overture、评分类指标「未获取」、置信度自动下调；Mapbox 耗尽 → 直线半径；LLM 失败 → 模板句；任何降级都出现在第 14 页来源表。
- 「连续 20 份报告平均成本 ≤ $0.50、P95 ≤ 90 秒」需在有网环境用 `replay:golden --engine v360` 循环验证；离线重放的数据成本为 $0.06。

## 360° 升级 · Phase 5b 报告信息架构与渲染（2026-09-12）
- 新增 `/print/[reportId]`（`app/print/`）：服务端读取 `report_model_json` + `narrative_json` 渲染 **浅色打印版 14 页**（US Letter、18 mm 页边距、页脚 = 报告编号 · 数据截至 · 页码），强制浅色 token（`prefers-color-scheme` 无效），Noto Sans SC + Inter，Lucide 线性图标，无 emoji；每页固定结构：action title（含判断）→ 英文小标题 → 一个核心图表 / 表格 → ≤ 120 字解读 → 数据来源 chip（官方统计 / 平台数据 / 用户输入 / 模型估算 / 联网检索，状态取自 `sources[]`）。非生产环境 `?fixture=millbrae` 可用离线模型预览。
- 页面：封面 / 执行摘要（结论徽章 + 三支撑 + 三风险 + 保本 vs 捕获双柱 + 签约前条件）/ 商圈地图（SVG：四圈层等时圈 + L1/L2 竞品 + L4 锚点 + 拟选址，仅 Overture 与自算图层，不含 Google 底图）/ Esri 式四圈层表 / 客群画像 / 竞争格局（L1–L4、价格阶梯、集聚曲线位置、关店率）/ 直接竞品卡片 + 标杆营收带 / 品类缺口与替代菜系 / Huff 需求捕获（圈层堆叠、午晚拆分、覆盖比仪表）/ 财务模型（成本表、三情景、敏感性瀑布，无 CapEx 不显示回收期）/ 六维评分 / 风险矩阵 / 签约核查与 90 天计划 / 方法与数据来源（`sources[]` 表 + 公式）。缺失值一律「未获取」。
- `lib/iq/render/pdf.ts`：服务端 Chromium 打开 `/print`，等待 `window.__REPORT_READY__`，`page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true })`；`GET /api/iq/report/[id]/pdf` 在存在 `report_model_json` 时自动走该路径（否则沿用旧模板），彻底替代浏览器打印深色页面（R3）。`/print` 在生产环境要求已付费或 `IQ_PRINT_TOKEN`。
- 视觉回归（门槛 7）：`npx tsx scripts/smoke-print.ts`（需 `next dev -p 3111`）——实测 14 个 `h1.action-title`、0 个空单元格、全部文本节点对比度 ≥ 4.5:1（含 SVG 文字）、每页不溢出、PDF 1.4 MB / 14 页 / Letter、无 tofu 字形。为满足对比度，珊瑚色只作徽章填充与关键数字下划线，语义色文字改用加深色阶。

## 360° 升级 · 自动接入前端与自动化运维（2026-09-12）
- **自动生成**：旧版付费报告落库（后台 finalize 或同步路径）后立即 `POST /api/iq/report360/:id`，360° 引擎在独立调用中生成并落库；报告页新增「360° 专业版报告」面板（`components/iq/Report360Panel.tsx`）：自动触发、每 6 秒轮询状态、就绪后显示综合分 / 结论并提供「下载 360° PDF」「在线预览 /print」「重新生成」；`IQ360_AUTO=false` 可关闭自动触发。
- **自动迁移**：写入 `report_model_json` 时若发现迁移 0009 未执行，`lib/iq/ops/migrate.ts` 通过 `DATABASE_URL` 幂等执行全部迁移文件后重试；无 `DATABASE_URL` 时面板提示「数据库尚未升级」。
- **Bootstrap 模式**：Overture 尚未落库但 Google Places 返回 ≥ 15 家餐饮 POI 时，以 Google 为 POI 底图继续交付，并在 `meta.degradations` 与第 14 页明确声明（`sources[]` 中 D5 仍如实标 failed）；Overture 加载后自动恢复正常模式。

## 360° 升级 · 运维 / Ops：数据任务上 Vercel Cron（2026-09-12）
- 新增 `GET|POST /api/iq/ops?task=migrate|lodes|hubs|snapshots|all&metro=sf-bay&state=ca&year=2022&counties=06081,…&dryRun=1&maxDetails=0&force=1`（`runtime nodejs`、`maxDuration 300`）。鉴权二选一：`Authorization: Bearer ${CRON_SECRET}`（项目设置了 `CRON_SECRET` 环境变量时 Vercel Cron 自动携带）或 `x-iq-worker-secret`（`IQ_WORKER_SECRET`，或由 `SUPABASE_SERVICE_ROLE_KEY` 派生的 worker 密钥，同 full-report worker）。任务在 300 s 预算内同步执行并返回 JSON：`{ ok, tasks: [{ task, ok, ms, cost_usd, result | error }], cost_usd, total_ms }`；`all` 按 migrate → hubs → snapshots → lodes（单县）顺序执行，任一任务失败只记录到 `tasks[].error`、不抛出（HTTP 仍为 200，`ok:false`）。日志打印每任务成本汇总。
- 三个脚本的核心逻辑迁入可导入函数（`lib/iq/ops/`），脚本退化为同参数的 CLI 壳：`loadLodes({ state, year, counties, budgetMs, maxRows? })`（流式 fetch + gunzip + 逐行解析，按县 FIPS 前缀过滤，每 1000 行 upsert `iq_lodes_wac`；预算将尽时干净停止，返回 `counties_done / counties_remaining / truncated`；已完成的县记入 `iq_market_cache(iq360_ops_progress / lodes:<state>:<year>)`，下次同一 query string 的 cron 自动跳过；`budgetMs < 120 s` 时默认每次只加载一个县）、`refreshHubs({ metro, dryRun })` → `{ hubs_done, cuisines_written, cost_usd, warnings }`、`snapshotReviews({ metro, maxDetails?, budgetMs })` → `{ places, rows_upserted, cost_usd, calls }`。迁移复用 `runPendingMigrations`（`lib/iq/ops/migrate.ts`）。
- `vercel.json` crons：`hubs` 每月 1 日 09:00 UTC、`snapshots` 每月 1 日 10:00 UTC、`lodes`（ca / 2022 / 湾区五县）每周日 11:00 UTC；函数项 `app/api/iq/ops/route.ts: maxDuration 300`。**Vercel Hobby 仅允许每日一次的 cron（且触发时间不精确），上述月/周计划需要 Pro**；Hobby 上可改为每日触发（幂等，无额外成本：hubs/lodes 走缓存与进度记录）或手动 `curl -H "x-iq-worker-secret: …" https://app.restaurantiq.ai/api/iq/ops?task=all`。
- 环境变量：`CRON_SECRET`（可选；不设则 Bearer 通道关闭，只接受 worker 密钥）、`DATABASE_URL`（`task=migrate` 需要，Supabase → Settings → Database → URI）、`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（写库）、`GOOGLE_MAPS_API_KEY`（snapshots）。
- 未上 Vercel 的部分：Overture 月度落库 `scripts/load_overture.py`（DuckDB 扫描 S3 parquet，数十分钟、内存大）仍在本机 / 服务器执行；`scripts/refresh-cex.ts` 与 `scripts/backtest-golden.ts` 也保持手动。LODES 全州文件（CA ≈ 30 MB gz、数十万行）一次流式扫描通常在 1–3 分钟内完成湾区五县；若某次超预算，返回的 `counties_remaining` 会在下一周 cron 中继续。
- 测试（`npm run test:iq`，无网络 / 无 DB）：`lib/iq/ops/lodes-loader.test.ts`（注入 gzip 流与 upsert：解析、县过滤、分批、预算停止与 `counties_remaining`、单县模式、进度跳过、maxRows、dry run）、`auth.test.ts`（Bearer / worker 密钥 / 拒绝）、`run.test.ts`（参数解析、`all` 顺序与预算切分、错误收集、预算耗尽跳过）。

## 运行时配置表 `iq_settings`（2026-09-12）
- 新增迁移 `0010_iq_settings.sql` 与 `lib/server/runtime-config.ts`：允许名单内的 key（`GOOGLE_MAPS_API_KEY`、`MAPBOX_TOKEN`、`CRON_SECRET`、`TAVILY_API_KEY`、`BRAVE_SEARCH_API_KEY`、`CENSUS_API_KEY`、`IQ_PRINT_TOKEN`、`IQ360_AUTO`、`IQ_ENGINE`、`IQ_STRUCTURED_OUTPUT`、`RESEND_API_KEY`、`IQ_EMAIL_FROM`、`YELP_API_KEY`、`DATABASE_URL`）可存于 `public.iq_settings`（RLS deny-all，仅 service role），每个 serverless 实例启动时读取并**覆盖** `process.env`，5 分钟刷新——运营方无需登录 Vercel 也能更换失效的 key。
- 所有入口（免费分析、付费报告与 worker、360° 生成、ops、PDF、`/print`、Stripe webhook、健康探针）在处理前调用 `ensureRuntimeConfig()`；表不存在或 Supabase 未配置时静默沿用部署环境变量。
- 注意：Vercel Cron 发送的 `Authorization: Bearer` 取自 Vercel 自身的 `CRON_SECRET` 环境变量，表里的值只用于校验；要让定时任务通过鉴权，仍需在 Vercel 设同一个值。

## 360° 首次生产运行修正（2026-09-12）
- Google Places (New) 的 `bubble_tea_shop` / `hunan_restaurant` 等类型不在 Table A（返回 INVALID_ARGUMENT）：调用计划改为 `tea_house` + `dessert_shop`，直接竞品（L1）改用 **Text Search (New)**「<菜系> restaurant」偏置 5 英里（Nearby 每次最多 20 条会漏掉 L1）；Bootstrap 模式接受 Google `partial`。
- block group 级 C16001 中文使用者缺失时，中文家庭占比与 p_cn 回退到 B02018 华裔祖源 ÷ 人口（此前四圈层均为「未获取」）。
- 叙事守卫支持 `[src:a.b[3].c]` 引用；正文上限放宽到 200 / 560 字并要求点号路径；`precheck_reasons` 去重。新增 `.github/workflows/report360-trigger.yml`（手动 / 推送 `.github/report360-queue.txt` 触发生成）。
- 第二次生产运行修正：2023 ACS 的 B02018 / B02015 表布局已变（`_002E` = 华裔除台湾、`_008E` = 台湾；此前用的 `_007E` 是冲绳人），已改正；叙事模型输出上限降为 420 / 950 token 并在提示词中把 120 字设为硬上限；页面 JSON 片段新增 `_derived`（L1 数、L1+L2 合计、替代菜系数等派生计数），避免 NumberGuard 误拦合理的合计数。新增 `.github/workflows/census-probe.yml` 用于在有网的 runner 上核对 Census 变量。

## 360° 报告 · 客户反馈七项（2026-09-12）
- **去掉成本栏**：第 14 页数据来源表不再有「状态 / 获取 / 成本」列，页脚不再显示「报告成本 $x · 耗时」；面板与正文任何地方都不出现单份报告成本。
- **竞对去重与准确性**：`engines/competitor.ts` `dedupeCandidates` 三重合并——同一 `google_place_id`（任意距离）、同名 ≤ 100 m、中文名⇄英文名同点位 ≤ 60 m（保留英文为 `name`、中文为 `name_zh`）；第 7 页 `uniqueCompetitors` 再按中英名归一做展示级去重，每家店只出一张卡（中文名为主、英文小字同行）。
- **大白话专业用词**：`narrative/templates.ts` 全部模板与 `render/pages.tsx` 全部页面重写；`plainZh()` 在渲染时兜底替换旧叙事里的术语（walk10 / drive10 / L1 / L2 / Huff / P25 / HHI / β / coverage_ratio → 步行 10 分钟范围 / 开车 10 分钟范围 / 同菜系竞品 / 其他中餐 / 需求分流模型 / 低位·中位·高位 / 集中度 / 距离衰减参数 / 需求覆盖率），每个必要术语只在首次出现时用括号解释一次；`SYSTEM_ZH` 提示词加入「写给餐饮老板看」的受众规则，`paramNotes('zh')` 把每个 id 的白话说法告诉模型。
- **真实地图**：新增 `render/static-map.ts`（Google Maps Static API 路线图、淡色样式、四个可达范围多段线、与第 7 页顺序一致的编号竞品标记、轨道站点；`resolveStaticMaps` 服务端抓图转 data URL，失败或无 key 时回退 SVG）；`render/map.tsx` 新增 `MapFigure`（`<img>` 真实底图 + 白话图例），`app/print/[reportId]/page.tsx` 把 `staticMaps` 传给 `ReportDocument`（第 1 页缩略图、第 3 页主图）。
- **付费补充信息表单**：新增 `components/iq/PaidIntakeForm.tsx`（全部选填、一分钟填完；`embedded` 模式嵌在免费结果页解锁按钮上方，`standalone` 模式在 360° 面板「补充信息并重新生成」）与 `POST /api/funnel/report-inputs`（`lib/funnel/iq-report-inputs.ts` zod 校验、合并写入 `market_data_json.user_inputs`：租金、面积、座位、堂食/外卖客单价、外卖占比、开办投入、车位、已有门店、你知道的竞品 ≤ 10、房源链接、营业时段、备注）。`SiteInput.known_competitors` 驱动 ≤ 3 次额外 Google Text Search（`buildGooglePlacesRequest`）并在去重后预分类为同菜系竞品；提交后强制重新生成并轮询到新模型落地。
- **数据源补全 agent**：新增 `lib/iq/ops/source-gap-agent.ts` 与 ops 任务 `source_gaps`（`vercel.json` 每周一 12:00 UTC）：扫描近 60 天付费报告中 partial / failed 的数据源 → 若缺口由未加载的表（LODES / iq_poi / 快照）造成且现已加载，则重跑报告并只在 `ok` 数据源增多且不降级为预检时落库（30 天冷却）→ 对无内部修复的缺口（可达范围、客流、租金、公交客流、开发管线、华人社区信号）每次 ≤ 3 次联网搜索，把政府 / 开放数据 / 许可明确的候选写入新表 `iq_source_candidates`（状态 `new`，绝不自动采用）。迁移 `0011_iq_source_candidates.sql`（含 `iq_source_gap_runs` 运行记录，RLS deny-all）。
- **第 14 页改为数据溯源**：标题「每个数字都可追溯到公开数据来源」，列：数据源 / 内容 / 更新日期 / 来源机构 / 许可；降级与缺口以「数据说明」脚注用白话列出（不再出现「12 个数据源中 9 个完整」和红色「未获取」徽章）；数据完整度仍在参数框以「85/100」小字展示。
- **第 15 页 总结与建议**：新增 `page_15`（结论徽章 + 一段话结论、决定成败的三个数字：需求覆盖率 / 租金占比 / 综合分、签约前必须做的事（逐字来自 `score.conditions`）、更适合的替代菜系 Top 3、下一步三条）；叙事层把 `page_2` 与 `page_15` 同作 summary 级并最后生成；QA gates、`smoke-print.ts`（新增 no_jargon / no_cost_line / no_source_count_title / page_15_is_summary 断言）与页脚均按 15 页。
- 其他：`charts.tsx` 份额条为 0 时标签改画在条外（对比度）；ops 路由注释补充 `source_gaps`；360° 面板文案更新为 15 页。
- **封面页**：付费报告新增独立封面（不计页码）：品牌栏、「商圈选址分析报告 · 360° Site Selection Report」、版本标签（付费专业版 / 预检版）、地址与拟开业态、真实地图、报告编号 / 生成日期 / 数据截止 / 编制方与免责声明；原第 1 页改名「报告概览 · At a Glance」；PDF 共 16 页（封面 + 15 页分析），`smoke-print.ts` 断言 16 页 PDF、15 个正文标题。
- **第三次生产运行修正**：候选池按 §3.1 限制在 max(3 英里, 开车 15 分钟) = 5 英里内（Text Search 只是「偏置」5 英里，曾把全旧金山的湘菜馆都算成直接竞品）；NumberGuard 接受把 >1 的比率写成百分数（需求覆盖率 1.72 → 「172%」），此前会误判为「数字不在 JSON 中」并把报告降为预检版。
- **「没有同菜系竞品」是发现不是缺失**：`competitors.pool_radius_mi` 与 `competitors.l1_nearest_outside_pool`（候选池外最近的同菜系门店）写入模型；第 7 页在 L1 为空且竞品守卫通过时显示「N 英里内没有同菜系门店，最近一家在 X 英里外」及空档解释，只有竞品数据源失败时才写「未获取」；模板与叙事提示词同步（比率一律写百分数；L1 为空且守卫通过时不得写「未获取」）。集聚曲线标注改为「本址步行 10 分钟内 N 家」；第 6 页表格行距微调以免溢出。
- **生产 PDF 修复**：线上下载 PDF 报「Browser was not found at /usr/bin/google-chrome-stable」——Vercel 运行时未暴露 `VERCEL=1`，Fluid Compute 也没有 `AWS_LAMBDA_FUNCTION_NAME`，启动器误走本地分支并回退到系统 Chrome。`lib/iq/render/chromium.ts` 现按 `VERCEL_ENV / VERCEL_REGION / LAMBDA_TASK_ROOT / AWS_EXECUTION_ENV / /var/task` 判定无服务器环境；打包的 `bin/` 缺失时自动下载对应版本的 release pack 到 `/tmp`（每实例一次，本地模拟 3 秒）；无服务器环境不再回退到系统 Chrome，错误信息给出真实原因。`next.config.ts` 追踪键补上转义的 `[id]`。报告页「打印 / 在线预览」改为打开浅色打印版 `/print/<id>`（有 360° 模型时），不再打印深色网页；触发工作流在报告就绪后探测一次服务端 PDF。
- 补充：线上探测后仍报 `libnspr4.so` 缺失——`@sparticuz/chromium` 在模块加载时只有看到 `AWS_EXECUTION_ENV` 含 Node 20+ 或 `VERCEL` 变量才会解压 Amazon Linux 2023 共享库并设置 `LD_LIBRARY_PATH`。启动器改为延迟 import，并在判定为无服务器环境时先设置 `VERCEL=1`；本地模拟确认 `/tmp/al2023/lib` 被解压且启动成功。

## 首页重设计（2026-09-14）
- `app/iq/page.tsx` 按 Owner.com / DoorDash 的产品型落地页范式重做：白底、单一粗标题、地址「搜索卡」作为唯一主动作（地址 + 菜系并排，橙色主按钮，租金 / 面积折叠为选填），信任条（60 秒出结论 · 数据来源 · 免费不注册）；接着是四张真实渲染的报告页（封面 / 商圈地图 / 直接竞品 / 总结，来自 golden Millbrae 夹具，存于 `public/marketing/iq/`）、三步流程、「报告里有什么」六格、样例数字（夹具数据，标明假设输入）、免费 vs 专业版价格（读取 `NEXT_PUBLIC_STRIPE_PRICE_USD`，默认 $19）、适用人群、FAQ 折叠、账户入口与免责声明页脚。中英文一键切换，默认中文；导航锚点平滑滚动；手机端单列，无横向滚动。品牌色沿用 `--brand-orange`，Logo 改用透明 SVG。
- 首页主标题改为「固定前半句 + 打字机动态后半句」：`签 lease 前，先算清楚` + 橙色逐字输入的轮换短语（这个铺位能不能赚钱 / 附近有多少华人家庭 / 同菜系竞品有几家 / 每月做多少才保本 / 租金占营收多少），桌面端保持单行（`clamp` 字号 + `md:whitespace-nowrap`），手机端前半句与动态短语各占一行；预留最长短语的宽度避免抖动；首屏 SSR 先完整显示第一句，`prefers-reduced-motion` 时不动画。

## 品牌配色系统 · Midnight Navy + Signal Green + Warm White（2026-09-14）
- 定色：Midnight Navy `#0B1220`（主品牌 / 深色背景）、Signal Green `#22C55E`（CTA / 机会 / 好位置）、Emerald `#16C784`、Warm White `#F7F8F4`（浅底）、Slate `#334155`（正文）、Amber `#F59E0B`（谨慎）、Red `#EF4444`（风险）、IQ Lime `#A3FF4F`（仅广告）。`app/globals.css` 暴露为 `--brand-navy / --brand-green / --brand-emerald / --brand-lime / --brand-canvas / --brand-slate / --brand-amber / --brand-red`（Tailwind `bg-brand-*` / `text-brand-*`），旧的 `--brand-orange` 仅供历史页面。
- 首页：导航与首屏改为 Midnight 深底、白色标题、绿色光标与绿色 CTA，白色搜索卡，暖白分区；主标题改为整句打字机，`签 lease 前，先通过数据了解该商圈是否适合` 固定首句，其余 5 句每次访问随机顺序轮换（Fisher–Yates），桌面单行、手机两行。`/iq` 布局底色改为 Midnight；360° 面板改用绿色 CTA。
- 报告（`/print` + PDF）：`print.css` 与 `render/format.ts` 调色板改为 Midnight 墨色、Signal Green 强调、暖白面板；判定徽章按结果着色（可做 绿 / 有条件 琥珀 / 不建议 红，深色字保证对比度）；地图站点标记改绿、可达范围改 Midnight、华人锚点改蓝以区分站点；对比度 4.5:1 与 16 页溢出检查通过（golden 夹具）。首页四张报告截图同步刷新。
- **中文字体改为专业报告排版**：标题用思源宋体（Noto Serif SC 700 / 900：封面大标题、每页行动标题、章节 h2），正文与表格用思源黑体（Noto Sans SC），数字用 Inter——即国内咨询 / 券商研报的常见搭配；`/print` 与 `/iq` 布局通过 Google Fonts 加载，系统字体（PingFang / 微软雅黑 / 宋体）作回退。首页大标题与各节标题同样使用思源宋体。触发工作流把探测到的线上 PDF 作为 artifact 上传（7 天），便于核对真实字体渲染。
- 首页：去掉「报告页截图」展示区与对应导航项（`public/marketing/iq` 截图删除）；主标题改为页面加载后从空白逐字打出第一句（光标闪烁），停顿后擦除、随机换下一句，不再因系统「减少动态效果」而停用；SEO / 无 JS 读者通过 sr-only 文本获得完整标题。
- 首页地址输入框占位文案改为通用示例「123 Main St, San Francisco, CA 94105」（含邮编），不再展示真实客户地址。

## 在线客服气泡（2026-09-14）
- `components/iq/SupportBubble.tsx` 挂在 `/iq` 布局右下角，所有漏斗页（首页、免费结果、付费生成中、报告页）都有；脚本化对话，不接大模型。核心场景：付费后刷新 / 后退丢失页面——生成页与报告页把报告 id 写入 `localStorage`（`iq:last_paid_report`，30 天），气泡通过 `POST /api/iq/support/recover` 核对该报告已付费后直接给出「回到报告页」链接（生成中 / 已生成状态）；没有记录时让用户输入付款邮箱，按 `customer_email / notify_email` 查已付费报告（最多 5 条），只返回已付费的。另有「生成要多久 / 怎么下载 PDF / 付款有问题」三条固定回答。
- 「转人工客服」小按钮：跳转 `https://wa.me/<号码>`（WhatsApp），预填报告编号与地址；号码取自运行时配置 `SUPPORT_WHATSAPP`（`iq_settings`，国际区号纯数字），未配置时退回 `SUPPORT_EMAIL` 的 mailto，两者都没有则提示暂未接入。`GET /api/iq/support/config` 提供这两项。默认中文，`?lang=en` 或面板内切换英文。
- 付费报告生成页：进度条下方的「已用时 N 秒」改为 `components/iq/GenerationTicker.tsx`——按真实进度分 8 个阶段、每阶段五句按序轮换（每 5 秒换一句，本阶段说完后借用后两个阶段的句子，一分钟内至少 10 句不同文案，绝不连续重复）的地址相关动态标语（如「正在获取该地址过往商家的经营情况…」「正在分析 San Francisco 周边的人口结构与华人家庭数量…」，城市从地址解析）；15 秒后在右侧出现倒计时「预计还需约 2 分 30 秒」，以典型 3 分钟为基准逐秒递减、只减不增：不足 1 分钟时改为「预计还需不到 1 分钟」，超过 3 分钟后显示「比平时慢一些，正在收尾…」（不再放宽到 5 分钟往回跳）；开始时间按报告 id 记在 localStorage（30 分钟有效），刷新页面、切换语言都接着原来的倒计时继续，只有手动重试才重新计时，进度 ≥ 90% 显示「正在收尾，马上就好」，绝不出现负数。进度条组件新增 `statusLine` 插槽；免费结果页不受影响。

## 三语站点 · 英文默认 / 中文 / 西班牙文（2026-09-14）
- 语言契约 `lib/i18n/locale.ts`：`Locale = 'en' | 'zh' | 'es'`，默认 **标准美国英文**；`toLocale()` 归一化任意输入，`pick(lang, {en, zh, es?})` 取文案（缺西文时回退英文，绝不回退中文），`LOCALE_TAG`（en-US / zh-CN / es-US）用于 `<html lang>` / `<main lang>`。
- 语言解析（`lib/i18n/resolve.ts`、`server-locale.ts`、`use-locale.ts`）：服务端页面按 `?lang=` → 报告行的 `language` 列（报告页 / 支付成功页）→ `iq_lang` cookie（1 年）→ `Accept-Language` → `en`；客户端按 `?lang=` → localStorage / cookie → `navigator.language` → `en`。选定后同时写入 cookie 与 localStorage，之后每个链接、表单、邮件链接、Stripe 结账 `success_url / cancel_url`、PDF / 打印链接都带 `?lang=`，Stripe 托管结账页与商品名也随语言切换。
- 漏斗 UI 全部三语：首页（`components/iq/IqLanding.tsx`，EN / 中文 / ES 三段切换，六句西班牙文打字标题）、免费结果页、付费生成页与进度标语 / 倒计时、报告页、成功 / 取消 / 登录 / 仪表盘页、客服气泡、分享组件、社会证明数字、报告就绪邮件。所有文案字典改为 `Record<Locale, …>`，漏掉一种语言即编译报错；英文按标准美国英文润色。
- 旧版 LLM 报告（`lib/funnel/**`）：所有提示词按 `LANGUAGE_INSTRUCTION[lang]` 输出对应语言（en：standard U.S. English；es：中性西班牙文）；富化器同时输出 `_es` 字段，组件与 PDF 通过 `competitorTakeaway / demographicNarrativeParagraph / siteHistorySummary / financeArchetypeLabel` 等辅助函数取值，西文缺失时回退英文。旧版 HTML→PDF 下载同样三语。
- 360° 报告（`lib/iq/**`）：`meta.language` 支持 `es`，`narrative_language` 记录实际叙述语言；`lib/iq/render/i18n.ts` 集中 15 页所有标签、图例、图表、封面、数据来源表、免责声明与判定词（GO / CONDITIONAL GO / NO GO ↔ 可做 / 有条件可做 / 不建议 ↔ VIABLE / VIABLE CON CONDICIONES / NO VIABLE）；叙述模板 `templateZh/En/Es` 数字与引用完全一致，LLM 叙述有 `SYSTEM_ES` 提示词、西文数字守卫与禁用词表；`lib/iq/narrative/plain.ts` 把引擎的驱动因子 / 风险 / 条件短语翻成三语。`/print/<id>?lang=` 与 `/api/iq/report/<id>/pdf?lang=` 可覆盖存储语言；存储叙述语言与请求不一致时自动回退到该语言的模板叙述。英文 / 西文版去掉中文页的英文副标题，并通过 `[data-lang]` CSS 压缩版式，三种语言 15 页均无溢出（smoke `--lang en|zh|es` 全部通过）。
- 未覆盖：n8n 工作流内的提示词仍只有中英文分支；站点其他产品模块（外卖、运营等）仍为中英双语。

## 360° 报告 · 不再假设租金 / 付费前补充信息 / 报告页即 PDF（2026-09-14）
- **不假设租金**：`lib/iq/engines/finance.ts` 删除了「面积 × 对标 $/sf」与「面积 × 档位 $/sf」两条估算分支。用户没填月租时 `fixed_cost.rent = null`、`rent_source = 'not_provided'`、`finance.rent_excluded = true`；固定成本合计、保本线、安全线、情景 vs 保本、回收期一律按**不含租金**计算并在每处标注「（不含租金）」（页 2 / 7 / 9 / 10 / 15、双柱图、覆盖率仪表、敏感度瀑布、模板叙述与 LLM 提示词三语同步）；占用成本比为空，租金风险不再出现，改为一条「未提供月租：占用成本比无法评估」高概率风险；敏感度中的「租金 +10%」换成「月租每 +$1,000 → 保本线 +$X」。新增 `finance.max_rent_for_10pct_usd`（捕获需求 × 10%）作为**租金上限**关键数字出现在页 10 与页 15，签约前条件固定加入「补充实际月租后重新生成…月租上限约 $X」，财务维度按中性 50 分，判定最高只到「有条件可做」（替代菜系同样封顶）。页 10 租金行显示「未提供 · 请在“补充信息”里填写月租后重新生成」。`scripts/smoke-print.ts --no-rent` 复现该形态并断言：夹具租金 $17,000 全文不出现、不含租金与租金上限标签在页 10 / 15、无 GO 徽章、无溢出。已存储的旧报告仍按原数字渲染，重新生成后才生效。
- **付费前补充信息**：`components/iq/PaidIntakeForm.tsx` 新增月租（`monthly_rent_usd`）与面积（`sqft`）字段，与座位数组成置顶的「核心三项」，每项一行后果说明（如「不填则报告不假设任何租金：只给不含租金的保本线和租金上限」）。免费结果页付费卡片改为两步：**第 1 步 · 填 3 个数字，报告更准（30 秒，可跳过）** 常驻展开（其余可选项折叠在「更多可选信息」里），**第 2 步 · 解锁完整风险审计 — $19**。首页已填的租金 / 面积自动带入并标「已提供 ✓」。月租为空时第一次点解锁只弹一条提示（「未填月租：报告将不假设租金…」，附「填一下 / 直接付费」），再点即付款，绝不阻断。
- **报告页 = PDF 排版**：`/iq/report/[id]` 有 360° 模型时直接渲染与 `/print` 完全相同的 `ReportDocument`（封面 + 15 页，白纸落在 Midnight Navy 背景上），`components/iq/Report360Document.tsx` 按容器宽度等比缩放（390 px 手机约 0.46 倍，无横向滚动，桌面 1:1）。最后一页下方是 `Report360Footer`：下载 360° PDF、分享、打印版、EN / 中文 / ES 切换、补充信息并重新生成（保存后强制重算并自动刷新）、再分析一个地址。删除了旧版「下载正式报告 / 打印另存为 PDF」区块与「升级为专业深度版」区块（`ReportActions.tsx` 已移除）；模型未生成时仍显示旧版内容 + `Report360Panel`，生成完成自动刷新进入新文档。非生产环境可用 `?fixture=millbrae` 预览。

## 评审 Spec v2 · 单一结论源 / 竞对检索 / 文本质量（2026-09-17）
- **单一结论源（P0-A）**：网页版与 PDF 此前各算各的，同一份报告的总分、判定、保本线、安全线、固定成本、水电 / 保险 / POS、占用成本比、数据置信度都对不上。新增 `lib/iq/conclusion/**`：`conclusion.ts` 的 `conclusionFromModel(model)` 是**唯一**推导判定与保本线的地方（`verdictFromScore`，阈值 `go: 70 / conditional: 55` 从 `defaults.yaml` 读取，页 11 的规则文案由同一常量生成）；`display.ts` 为客户端组件提供不读文件系统的那一半；`reconcile.ts` 挂在 `reportModelSchema.transform` 上，**每次解析**都把模型对齐到已存结论，打印 / PDF 通道因此在物理上无法渲染出与结论不一致的数字；`schema.ts` 提供与接口编译期对齐的 zod 校验。
- **单一档位成本表**：`defaults.yaml` 新增 `cost_scale`（hcol / mcol / lcol 三档的工资、乘数、收入门槛，`hcol_states`、`labor`、`split`，以及按业态原型分组的 `concepts`）。两套财务引擎（`lib/funnel/iq-finance-model.ts` 与 `lib/iq/engines/finance.ts`）的工资 / 水电 / 保险 / POS / 市场费 / 杂费硬编码全部删除，改读同一张表；菜系→业态原型由 `archetypeIdFor` 统一解析（此前 `skewers`、`middle_eastern` 在两套引擎里落到不同原型）。网页引擎同时删掉了第四档 `hcol_metro`、按原型的安全系数与**租金估算**，与「不假设租金」的既定规则一致。
- **生成顺序**：`stageDraft` 先 `ensureConclusion()`（复用已存结论，否则以 150 秒预算跑一次 `generateReport360ForRow(id, { narrative: false })`），把结论注入起草提示词与终稿；超时或失败则标记 `conclusion_pending` 并退回旧的 `applyFinanceModelOverride`。之后的 360° 只负责叙述（`generateReport360Narratives()`，`meta.narrative_pass` 保证只跑一次、绝不重算）。网页侧 `applyConclusionOverride` 用结论覆盖总分、判定档位、各层得分、保本线、安全线、成本结构、置信度、占用成本比、决策矩阵与三档情景，大模型只保留文字。
- **竞争强度与竞对计数**：`dashboard.competition_intensity`、`risk_audit.competition_pressure_score` 与决策矩阵改由结论里的 `competitive_position` 维度给出；网页竞对地图不再打印自己的白名单长度，改用 `competitors.counts` / `market_data.summary.counts`，与 PDF 一致。
- **菜系分类修正**：`cuisine_taxonomy.yaml` 的粤式烧腊条目删除裸 `BBQ` 与 `Roast` 关键词——它们会把「Seoul Garden Korean BBQ」「American BBQ」与咖啡 `Roastery` 误判为烧腊；只保留限定形式（烧腊 / 叉烧 / Roast Duck / Cantonese BBQ 等）。`lib/iq/engines/competitor.ts` 的 Layer 1 判定补上「店名自带本菜系关键词即成立」一条，排在查询来源门槛之前：名字里写着「金门蛋挞」的店，不该因为 Layer 1 查询没返回它、而分类规则只看到通用 `bakery` 类型就被剔除。
- **报告文本质量守卫（P1-g）**：新增 `lib/funnel/iq-text-quality.ts`，两级严重度——`corrupt`（U+FFFD、私用区、兼容汉字、CJK 扩展 A/B、控制字符，以及夹在汉字中间的拉丁片段）与 `suspect`（不在词表内的生僻汉字，只告警不改字，避免误伤真实店名）。词表由 `scripts/build-cjk-vocabulary.mjs` 扫描全仓生成（`lib/funnel/iq-cjk-vocabulary.json`，511 个文件 1475 字）。`scrubCorruptedReportText()` 折叠进 `stripInternalIqReportFields`，所有出口自动获得句级清洗；QA 门禁新增 `text_quality`（`lib/iq/qa/gates.ts`），把地址、菜系名与 L1/L2/L4 竞对店名作为合法上下文，仅 `corrupt` 判失败。

## 评审 Spec v2 · 等待体验（P1-f）（2026-09-17）
- **分档 ETA（§4.7）**：生成页不再对两档相差数分钟的报告统一显示「通常 3–5 分钟」。新增 `lib/funnel/iq-eta.ts` 承载纯 ETA 计算；`iqRecentGenerationDurationsMs()` 读取**同档位**最近已完成任务的墙钟耗时（`generation_started_at` → `generation_updated_at`，按 `generation_state_json->>mode` 过滤），`tierEtaFromHistory()` 取**最近 30 次的 P50**；样本不足 30 次时回落到静态默认值——标准档 4 分钟、专业档（360°）12 分钟——并按整分钟取整、下限 1 分钟，绝不显示「0 分钟」。状态接口以 `etaSeconds` / `etaSource` 返回，按档位缓存 10 分钟，保证 3 秒一次的轮询仍只读一行。**倒计时单调**：等待页自己持有计时器，并把剩余秒数与上一次展示值取小（`monotonicRemainingSec`），因此中途到达的更长档位 ETA 只能把数字往下拉——从 1 分钟跳回 2 分钟的老 bug 不会再现。滚动文案在自身词条不足时向后（末尾阶段则向前）借用相邻阶段的说法，凑满至少 12 条，长阶段不会只在两句话之间循环。
- **邮箱捕获常开**：`emailEnabled` 改为无条件为真（邮箱地址无论如何都会存到行上），另用 `emailWillSend` 表示当前是否真能发信，界面不会承诺发不出去的邮件。等待超过**5 分钟**后，卡片从旁注变为主动询问——「留个邮箱，完成后把 PDF 发给你」/ "Leave your email and we'll send the PDF when it's ready" / "Déjanos tu correo y te enviamos el PDF cuando esté listo"——复用既有链路 `/api/funnel/full-report/notify` → `notify_email` → `sendReportReadyEmail`（Resend），未引入新的邮件服务商。
- **单阶段卡死检测与降级**：`STAGE_STALL_MS`（5 分钟）高于单个阶段约 250 秒的预算，`runReportGenerationStage` 为每个阶段加上看门狗超时，因此静默超过该窗口的任务一定是实例已死而非只是慢。`deriveUiStages` 依据任务心跳（而非该行的开始时间——「撰写」行本就跨 draft + verify 两次调用）标记当前行 `stalled`，清单明确显示「这一步超时，正在自动重试」而不是一直转圈，状态接口同时从上一个检查点重新拉起 worker。某阶段重试次数用尽后由 `canDegradeStage()` 判断能否绕过：`enrich` 降级为沿用已存市场数据、`verify` 降级为未复核的草稿、`draft` 仅在此前已存检查点时可跳过；`finalize` 无可降级，仍按失败处理。被降级的阶段记录在 `generation_state_json.degraded`。

## 辖区数据代理 · 证据阶梯与排烟结论（2026-09-17）
- **问题**：报告曾用住宅房源数据描述商铺——「1912 年建、8 卧 6 卫 Multi-Family、4,685 sqft」实际是楼上的公寓。BrightData 的 Zillow 通路（`web_data_zillow_properties_listing`、`fetchZillowListing`、`real_estate_data` 及其提示词锚点段落）已整体删除，并有回归测试扫描 `lib/iq/jurisdiction/**` 与 `lib/funnel/external-data/**`，出现 `zillow / zestimate / bedrooms / real_estate_data` 等字样即失败。LoopNet 商业房源（E5，只供租金对标）保留，测试同时证明它无法进入 `property_facts`。
- **证据阶梯 E1–E5**：E1 餐饮许可 / 卫生检查、E2 建筑与机械排烟许可、E3 前租户业态（由 `site-history.ts` 的 `priorTenantSignal` 按店名 + 类目判定 `hot_kitchen / limited_food / non_food`）、E4 估价册（建成年份、用途代码）、E5 商业房源。`hood_permit_found` **只**能由 E2 置位；E4 的建成年份在代码结构上无法触碰任何排烟结论。`HOOD_INFERENCE_GUARD` 三语写明「不得由建成年份、卧室数、房源描述推断排烟条件」。
- **辖区登记表**：`lib/iq/jurisdiction/**`（类型 / 地址解析与 SoQL 注入转义 / 登记表 / socrata 与 arcgis_rest 适配器 / 归一化 / 结论 / 发现 / 入口）+ 迁移 `supabase/migrations/0012_jurisdiction_registry.sql`（RLS 全拒，种子行 `ON CONFLICT DO NOTHING`）。解析路径：地址 → Census 地理编码 → 县 FIPS → 登记行 → 适配器按 E1→E2→E4 顺序执行 → 归一化；响应走既有市场缓存的新来源 `iq360_jurisdiction`（7 天 TTL），成本记在同一账本（开放数据 $0）。
- **未登记辖区不发请求**：`resolveJurisdictionFacts` 对陌生辖区**零次 fetch**（有测试断言），返回 `jurisdiction_coverage: 0`、所有事实为 `null` 并附 `fallback_reason`。`discoverJurisdiction` 是独立的异步入口，绝不在报告路径上调用。
- **已接入**：06075 旧金山三个真实 Socrata 数据集（餐饮检查 `pyih-qa8i`、DBI 建筑许可 `i98e-djp9`（按 type i hood / grease interceptor / kitchen exhaust / ansul 等关键词过滤）、估价册 `wv5m-vpq2`）。06081 圣马刁 / 06085 圣塔克拉拉 / 06001 阿拉米达**已登记但未接入**：数据集 id 未经核实，宁可不填也不臆造，`coverage_score` 0.15，页面显示「本辖区许可数据未接入」。后续批次是数据行，不是代码。
- **结论三态**（三语）：有许可记录 → 「该址持有 / 曾持有餐饮许可，含机械排烟许可记录，改造风险低」，签约前清单改为核验 hood 型号与现状；仅前租户证据 → 「前租户为热厨餐饮，大概率已具备商用厨房条件，但未经许可记录证实，请现场验房」；无数据 → 「本辖区许可数据未接入，排烟 / 电力条件无法远程判定」并把「索取 DBI 许可记录」列为必查项。`data_confidence_input` 给出置信度增减（许可记录 +4…+10、前租户 +2、未接入 −8）与三语的已获取 / 缺失数据清单，缺失项附各自的 gap 原因。

## PDF 交付质量 · 风险定价 / 稀疏折叠 / 字体自托管（2026-09-17）
- **每条风险都有金额或理由（P1-c）**：`lib/iq/engines/risk.ts` 保证每条风险要么带月度金额与其算式，要么带一句「为什么算不出」，绝不两者皆无。新增 `impact_formula_zh/_en` 与 `unquantified_zh/_en` 两个字段（仅 risks 块，默认 `null`，旧模型照常解析）。已定价的包括：未提供租金（捕获需求 × 10% = 可承受租金上限）、占用成本超 10%、客单价 −12.5% 即跌破保本、闭店率 × 月固定成本、冷启动（基准营收 × 60%）、饱和集群价格战、高评分门槛、覆盖率不足。仅三条（半径型商圈、周边施工、缺 CapEx）保留文字理由。每条算式都是带模型自身数字的白话句子，NumberGuard 能直接读回校验，读者也能自己复核。
- 页 12 的风险表只列有金额的行，金额下方附算式；第三个关键数字由「N 项未获取」改为**单项最大影响**，且只在确有已定价行时出现。未定价的风险折进页 13 的签约前清单，写成「风险 — 理由。应对：…」。夹具报告的页 13 由 $0 / 「4 项未获取」变为 **已算出的影响合计/月 $137,483 · 3 项已算出金额**、单项最大影响 $108,555。
- **稀疏区块折叠（P1-d）**：新增 `lib/iq/render/sparse.ts`（`collapseIfSparse`、`keepPopulated`、`missingShare`，阈值 `SPARSE_MISSING_LIMIT = 0.5`）。判据是**可打印单元格**而非行数——八行只有店名没有数字，按值算就是 100% 缺失；恰好 50% 仍然打印，只有**超过**一半才折叠。应用于页 7 评论数分布与品牌锚点表、页 8「谁还在卖」、页 4 环带表（**按指标行**判定，全文最大的未获取面，60 个单元格）、页 5 时段与客群基准。折叠后打印一行三语提示指向页 14 的数据说明。
- **两个偏空的页面补足内容，不合并、不改页码**（15/16 页契约与叙述标题的对应关系不变）：页 7 在同菜系可对标同行不足 4 家时，改用**周边中餐客流基准**（按评论数前 5，含距离 / 评分 / 评论数 / 价位）并声明自己的覆盖度，本身也过一遍折叠判定，填充率 55% → 93%；页 8 在「谁还在卖」折叠时把替代菜系排名从前 3 扩到前 8，填充率约 60% → 83%。新增 smoke 断言 `no_blank_page`：测量 `.page-body` 内最低已绘制元素的底边（`scrollHeight` 无用——它是永远撑满的 flex 子元素），任何页低于 50% 即失败，当前全文最低 56%。
- **PDF 体积从 5.8 MB 降到 1.3 MB**：`/print` 不再从 Google Fonts 取字体，改为自托管（`@fontsource/inter`、`@fontsource/noto-sans-sc`、`@fontsource/noto-serif-sc`，每个字重一个 `chinese-simplified` 面）。Google Fonts 的 CSS API 会把每个中文字族切成约 100 个 `unicode-range` 子集，文档碰到哪个子集 Chromium 就单独内嵌一个 Type3 字体——中文版因此内嵌了 **464 个** Type3 字体（约 4 MB），越过 5 MB 的 smoke 上限，而只碰拉丁子集的英文版只有 1.35 MB。改为每字重一个字体面后，Chromium 内嵌的是实际用到字形的单一子集：中文 5831 KB → **1306 KB**，英文 1388 KB → **687 KB**，Type3 字体由 464 个降到 40 个。三语 × 含租金 / 不含租金共 6 种组合的 smoke 首次全部通过。
- **拉丁版式收紧**：英文页 2、西班牙文页 6 / 14 / 15（不含租金版）此前会溢出 243 mm 版心——此前的核验在字体 CDN 被屏蔽的沙箱里跑，用的是回退系统字体，量出来的高度偏小，换成真实 Noto / Inter 字形后才暴露。按既有 `[data-lang]` 收紧惯例逐页处理：页 2 列表行距、页 6 表格内距与趋势图宽度、页 14 溯源表行距与面板内距、页 15 结论段与后续步骤内距。

## 底层重构 · S1 竞品池完整性与证据上限（2026-09-17）
- **截断检测（§3.1）**：Google Places (New) 单次最多返回 20 条，而唐人街 / 圣盖博谷 / 法拉盛 / Sunset 这些核心市场里，检索被截断是常态而非例外——系统此前把截断后的池子当成全集。`lib/iq/data/google-places.ts` 的调用计划改成队列：任一调用返回条数触及 `PLACES_PER_CALL_CAP`，即按四象限细分重查（`subdivideCall`，子格半径取 0.71×父半径，恰好覆盖四角），最多两层、受 `google_places_max_calls` 预算约束；细分后仍触顶的调用记入 `pool_truncated` / `truncated_calls`，并在来源说明里写明「该范围未穷尽」。子格按自身中心检索，距离仍以真实站点计算。
- **INV-1 否定命题**：`assessCategoryGap` 新增 `pool_truncated` 判据，排在「两级半径都搜过」之前——池子没穷尽时，品类空白一律判 `unknown`，绝不出 `true`。「没找到」是关于检索的事实，不是关于世界的事实。
- **INV-2 数据源失败必须传导**：`computeConfidence` 此前用 `max(q(D5), q(D6))` 合并底图与 Places，于是「餐饮门店底图未获取」的报告仍能拿到竞品项满分 1.00。改为 Overture 底图作主源加权 0.6、Google 补充 0.4；池子截断时该项直接为 0。
- **§4.3 完整度 → 判定硬联动**：新增 `verdictCap()`。完整度 ≥ 80 且无降级才允许 GO；55–79 或任一核心源降级 → 上限「有条件可做」；< 55 或竞品池截断未解决 → 证据不支持任何判定。`verdictFromScore` 只下调不上调，且从不下调 NO_GO——「数字不成立」不需要额外证据。现网「completeness = 75 + 底图未获取 → GO」这条链路就此封死。
- **尚未落地**：§4.3 第三档「数据不足，不予判定」目前退到「有条件可做」——它需要报告新增第四种判定徽章（网页 + PDF × 三语），是独立的一块工作。

## 底层重构 · GF-001 根因：关键词检索只搜了一种语言（2026-09-18）
- **实测根因**：在 900 Grant Ave（旧金山唐人街）以 800 m 偏置实测 Google Text Search —— `"egg tart"` 返回 **0** 条，`"蛋挞"` 返回 **11** 条且 Golden Gate Bakery **排第一**，`"pastel de nata"` 返回 6 条。Text Search 匹配的是店名、并且按语言匹配；Golden Gate Bakery 的店名里没有任何蛋挞字样的英文，所以英文关键词永远找不到它。此前 `latinQueryWord()` 只取第一个拉丁关键词作为 Layer 1 查询，这就是「1 英里内 0 家葡挞店」的真正成因——不是分类器错，也不是半径错（`葡挞、甜点` 正确归到 `egg_tart`，两级半径也确实被执行）。
- **修复（§3.2 step 1）**：`conceptQueries()` 给出中英双脚本别名集（最多 3 条，中文受众概念以中文打头），`ConceptSearchProfile.queries` 承载；Layer 1 改为「每别名 × 每半径」各发一次检索，`direct@800:蛋挞` 这样的标签记录实际搜了哪条别名。`google_places_max_calls` 由 8 提到 14 以容纳新的直接层。
- **GF-001 实测通过**：Golden Gate Bakery 距站点 194 m，`layers=[direct, substitute]`，直接竞品数由 **0 → 14**。同一次运行里 §3.1 截断检测也确认了 spec 的判断：11 个子检索在四象限细分后仍触顶（唐人街的 Layer 2 / L3 范围确实无法用单次调用穷尽）。
