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
