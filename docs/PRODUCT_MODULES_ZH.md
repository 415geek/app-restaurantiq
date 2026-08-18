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
