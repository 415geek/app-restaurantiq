<!-- /autoplan restore point: /Users/c8geek/.gstack/projects/app-restaurantiq/no-branch-autoplan-restore-20260325-170711.md -->

# app-restaurantiq 升级计划（基于 fork restaurantiq-amazon）

## 目标摘要

1. 在 GitHub fork [415geek/restaurantiq-amazon](https://github.com/415geek/restaurantiq-amazon)，新建仓库 **`app-restaurantiq`**，以 fork 为基线。
2. 按桌面研发素材（`restaurantiq-app.md` 内嵌的 Stripe MVP 提示词 + 代码骨架）做**全量工程化升级**：转化漏斗（地址 → 部分结论 → Stripe $19 → Webhook 解锁完整报告）。
3. **保留**：现有 **n8n 编排** 与 **LLM 调用链**（可将分析/全文报告改为 n8n Webhook 触发，而非仅直连 OpenAI）。
4. **基础设施**：优先 **Supabase（Postgres + 可选 Auth）** 承载数据；**Vercel** 部署 Next.js（Vercel 本身不是数据库）。若团队更熟 Prisma，可用 `DATABASE_URL` 指向 Supabase Postgres，与上游 `supabase/migrations` 协调 schema。
5. **注意**：`restaurantiq-app.md` 当前为 **RTF**，正文中的 Markdown 提示词可读但建议导出为纯 `.md` 便于版本管理与 CI。

---

## Phase 0 上下文

- **工作区** `/Users/c8geek/app-restaurantiq`：当前为空目录，需在 clone/fork 后初始化。
- **本地参考克隆** `/Users/c8geek/restaurantiq-amazon`：`package.json` 显示 Next 16、Clerk、Supabase、无根级 Prisma；与 MVP 提示词中的「无鉴权、Prisma-only」存在**产品形态差异**。
- **基线分支**：无 PR 时假定 `main`。

---

## 0A 前提（Premises）— 需你人工确认

| ID | 前提 | 若不成立的影响 |
|----|------|----------------|
| P1 | **`app-restaurantiq` 定位为「在现有 SaaS 上增加 B2C 付费报告漏斗」**，而非删除 Dashboard/Clerk | 若改为纯 MVP，将产生大规模删功能与数据模型收缩 |
| P2 | **Stripe $19 漏斗** 与 **现有登录用户体系（Clerk）** 可并存：未登录访客可走漏斗；可选后续把 `reportId` 与 `userId` 关联 | 若强制无 Auth，需隐藏或拆分 Clerk 路由 |
| P3 | **n8n** 作为 `/api/analyze` 与「全文报告」的可信执行器，Next 仅作编排与验签 | 需约定 n8n URL、密钥、超时与幂等 |
| P4 | **支付真相来源** 仅为 Stripe Webhook（与提示词一致），Success 页只做 UX | 避免前端「假解锁」 |

**请回复确认或修正以上 4 条前提后再进入「执行/落地」阶段。**

---

## 0B 子问题 → 现有代码映射（What already exists）

| 子问题 | restaurantiq-amazon 中已有 | MVP 提示词要求 | 差距 |
|--------|---------------------------|----------------|------|
| Next App Router | 有 | 有 | 对齐 Next 16 |
| 数据库 | Supabase 客户端 + `supabase/migrations` | Prisma + Postgres | 选型：Prisma 指 Supabase 或继续 Supabase SDK + 新表 |
| 鉴权 | Clerk | MVP 文档写「不要 auth」 | **并存策略**见上 |
| LLM | 分散在 app/lib/agents | OpenAI Route Handlers | 抽象 `llmProvider` + n8n 适配器 |
| Stripe | 需新增 | Checkout + Webhook | 全新 `app/api/stripe/*` |
| n8n | 可能为外部工作流 | 保留 | 文档化 env 与契约 |

---

## 0C 愿景图（CURRENT → 本计划 → 12 个月）

```
[CURRENT: B2B SaaS + Supabase + Clerk]
        → 本计划：+ B2C 付费报告漏斗 + n8n 深度集成 + 工程规范
        → 12M：统一数据模型、多租户报告、A/B 定价、合规与可观测性
```

---

## 0C-bis 方案对比

| 方案 | 做法 | 人力 | CC+gstack | 风险 |
|------|------|------|-----------|------|
| A 推荐 | 在单仓内新增 `/report-funnel`（或 route group）+ 新表 `paid_reports`，Clerk 可选 | ~2–3 周 | ~2–4 h | 路由与中间件需仔细隔离公开页 |
| B | Monorepo：子包 `apps/funnel` 独立部署 | ~3–4 周 | ~4–6 h | 双部署、双 env |
| C | 放弃 SaaS，按提示词删成纯 MVP | ~1–2 周 | ~1–2 h | 与「全面优化 fork」语义冲突 |

**自动决策（原则 P1+P5）**：选 **A** — 完整度高、复用现有组件与设计系统。

---

## 0D 模式：SELECTIVE EXPANSION — 范围决策

- 纳入：Stripe 全流程、报告表、Webhook 幂等、n8n 调用封装、E2E 关键路径测试、`.env.example` 与部署文档。
- 不纳入本迭代：Uber Eats 深度改造、大规模 Dashboard 重构（记入 TODOS）。

---

## 0E 时间线（首日 → 一周后）

- **H1–H6**：Fork → 新 remote → Stripe 沙箱 → 单测通 analyze → Checkout 通 → Webhook 本地 CLI。
- **Week1**：Supabase migration、staging、Vercel 预览、n8n 生产 URL、错误监控。

---

## 0F 模式确认

**SELECTIVE EXPANSION** 已选定。

---

## Section 1–10 核心结论（CEO 压缩版）

- **市场叙事冲突**：提示词强调「非 Dashboard」；fork 是完整 SaaS。**结论**：用 **独立营销/漏斗路由** 满足转化 KPI，不拆除 SaaS。
- **KPI**：提示词 KPI 为「付费 $19 人数」；SaaS 可保留原北极星。**结论**：双 KPI 分渠道埋点。
- **合规**：餐饮建议属信息产品，需免责声明与地域法规检查（非法律建议）。

---

## Error & Rescue Registry

| 错误场景 | 检测 | 恢复 |
|----------|------|------|
| Webhook 验签失败 | 400 + Stripe 重试 | 日志 + Dashboard 密钥轮换手册 |
| n8n 超时 | 504/499 | 降级直连 OpenAI 或队列重试（可配置） |
| 重复 `checkout.session.completed` | DB 唯一约束 session id | 幂等 update |

---

## Failure Modes Registry

| 模式 | 严重度 | 缓解 |
|------|--------|------|
| Success 页先到、Webhook 未到 | 中 | UI 轮询或短延迟刷新 + 明确文案 |
| LLM JSON 解析失败 | 高 | schema 校验 + 一次 repair 调用 |
| 价格 env 错误 | 高 | 启动时校验 `STRIPE_PRICE_ID` 或 `NEXT_PUBLIC_STRIPE_PRICE_USD` |

---

## NOT in scope（本迭代不做）

- 删除 Clerk / Dashboard
- 替换 Uber Eats 整条链路
- 自建支付通道（非 Stripe）

---

## Dream state delta

本计划完成后：具备**可上线的 B2C 付费报告路径**且与现有 SaaS **共存**；n8n 成为可替换 LLM 编排层；12 个月理想态还需统一用户身份与报告权限模型。

---

## Phase 2 Design（UI 维度摘要）

| 维度 | 分 | 说明 |
|------|----|------|
| 清晰层级 | 8/10 | 漏斗页用高对比独立布局，避免与 Dashboard 混用侧栏 |
| 状态 | 8/10 | loading / error / locked / paid 四态 |
| 信任 | 7/10 | Stripe 官方 Checkout + 安全文案 |
| 可达 | 7/10 | 表单 label、焦点顺序 |
| 系统一致性 | 6/10 | 可与主站 tokens 对齐或刻意「落地页风格」— **Taste** |

---

## Phase 3 Eng

### 架构 ASCII

```
[Browser]
   → Next.js (Vercel)
        → Route Handlers: /api/analyze, /api/create-checkout-session, /api/stripe/webhook, /api/full-report
        → [n8n] ---webhook--→ 外部工作流 → LLM
        → Supabase Postgres (paid_reports 或扩展现有 schema)
        → Stripe API
```

### 测试映射（Section 3）

| 路径/分支 | 测试类型 | 现状 | 缺口 |
|-----------|----------|------|------|
| analyze 输入校验 | API unit | 无 | 新增 |
| Webhook 验签失败 | API unit | 无 | 新增 |
| 幂等重复事件 | integration | 无 | 新增 |
| E2E 漏斗 | Playwright | 无 | 新增（可选 Vercel preview） |

### 性能

- analyze：限制 prompt 长度；n8n 设超时；避免 N+1（单 report 查询）。

---

## TODOS.md（建议条目）

- [ ] 将 `restaurantiq-app.md` 导出为仓库内 `docs/prompts/RestaurantIQ-Stripe-*.md`
- [ ] 评估 Clerk 与匿名漏斗的 middleware 匹配规则
- [ ] 生产 Stripe Webhook 与 Vercel 域名配置清单

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | 单仓内新增漏斗路由，不删 SaaS | P1 完整性 | 同时满足「fork 全面升级」与 MVP 转化路径 | 纯 MVP 删库方案 |
| 2 | CEO | 双 KPI（漏斗付费 + SaaS 原指标） | P6 行动 | 可落地衡量，不虚构单一北极星 | 仅保留其一 |
| 3 | Eng | DB 用 Supabase Postgres；Next 部署 Vercel | P3+P4 | 与上游一致；Vercel 作宿主非 DB | 仅用 Vercel KV 存报告 |
| 4 | Eng | Prisma 可选；若上 Prisma 则 migrate 与 SQL migration 二选一并文档化 | P5 显式 | 避免双源 schema 漂移 | 静默混用 |
| 5 | Eng | n8n 为首选执行器，OpenAI 为 fallback | P1 | 满足用户保留 n8n | 仅直连 OpenAI |
| 6 | Design | 漏斗视觉可独立或对齐 Design tokens | Taste | 转化优先时常独立更优 | — |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | SaaS vs MVP 张力已消解为双轨路由 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | CLI 未安装 |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | clean | 见测试映射与架构图 |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 四态与信任文案已列 |

**VERDICT:** Codex 未运行 — 若需要第二意见请本地安装 Codex CLI 后重跑本计划相关章节。

---

## Completion Summary

| 维度 | 状态 |
|------|------|
| 战略 | SELECTIVE EXPANSION，B2C 漏斗 + 保留 SaaS |
| 技术 | Supabase + Vercel + Stripe + n8n 编排 |
| 风险 | 前提 P1–P4 待用户确认 |
| 下一步 | 用户确认前提 → `git init` / clone fork → 实现 API 与 migration |
