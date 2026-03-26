# 部署 app.restaurantiq.ai（独立 Supabase + Vercel）

本文档说明如何把 **本仓库**（与 `restaurantiq-amazon` 分离的新项目）部署到 **新 Supabase 项目**、**新 Vercel 项目**，并用自定义域名 **`app.restaurantiq.ai`** 对外提供服务。

> **隔离**：请勿把本项目的 `SUPABASE_*` 指到正在生产运行的 `restaurantiq-amazon` 数据库，避免互相影响。

## 0. Vercel 构建时自动跑 IQ 表迁移（可选但推荐）

本仓库根目录 `vercel.json` 使用：

- `buildCommand`: `npm run build:vercel`  
  会先执行 `scripts/apply-iq-migration.cjs`（对 `0002_iq_location_reports.sql`），再 `next build`。

在 Vercel **Environment Variables** 中增加：

- `DATABASE_URL` = Supabase **Project Settings → Database → Connection string → URI**（需数据库密码）

若未设置 `DATABASE_URL`，脚本会跳过迁移并继续构建（适合本地或未启用自动迁移的环境）；此时你仍需在 Supabase SQL Editor **手动执行** `supabase/migrations/0002_iq_location_reports.sql`。

> 若 Vercel 项目里曾手动改过 **Build Command**，请改为与 `vercel.json` 一致，或删除 Dashboard 里的覆盖。

## 1. Supabase（新建项目）

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)，**New project**（建议区域靠近用户）。
2. 记录 **Project URL** → `SUPABASE_URL`  
3. **Settings → API → service_role**（保密）→ `SUPABASE_SERVICE_ROLE_KEY`
4. 在 **SQL Editor** 中依次执行 `supabase/migrations/` 下所有 `.sql`（至少包含 `0002_iq_location_reports.sql` 以及你需要的旧表迁移；若只做 IQ 漏斗，可只跑与 `iq_location_reports` 相关的迁移，但需与代码中其它 API 是否依赖表一致）。
5. 更推荐本地：`npx supabase link` 后 `npx supabase db push`（需安装 Supabase CLI）。

## 2. Stripe

1. [Stripe Dashboard](https://dashboard.stripe.com/) → Developers → API keys → `STRIPE_SECRET_KEY`
2. 本地调试 Webhook：`stripe listen --forward-to localhost:3000/api/funnel/stripe/webhook`，把 CLI 打印的 secret 写入 `STRIPE_WEBHOOK_SECRET`
3. 生产：在 Stripe 添加 endpoint  
   `https://app.restaurantiq.ai/api/funnel/stripe/webhook`  
   事件至少勾选 **`checkout.session.completed`**，复制 **Signing secret** → Vercel 环境变量 `STRIPE_WEBHOOK_SECRET`

## 3. Vercel（新建项目）

1. [Vercel](https://vercel.com/) → **Add New Project** → Import 你的 Git 仓库（`app-restaurantiq`）
2. **Environment Variables**：把 `.env.example` 中变量全部在 Vercel 里配置（Production / Preview 按需）
3. Deploy

### 自定义域名 `app.restaurantiq.ai`

1. Vercel 项目 → **Settings → Domains** → 添加 `app.restaurantiq.ai`
2. 在 **DNS**（Cloudflare / Route53 等）为 **`app`** 子域添加 **CNAME** 指向 Vercel 提示的目标（常见为 `cname.vercel-dns.com` 或项目专用 CNAME）
3. 等待证书签发（通常数分钟）

### 必配环境变量摘要

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_APP_URL` | `https://app.restaurantiq.ai` |
| `NEXT_PUBLIC_FUNNEL_HOST` | `app.restaurantiq.ai`（根路径跳转 `/iq`） |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 新 Supabase 项目 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe |
| `OPENAI_API_KEY` 或 n8n Webhook 系列 | 分析/全文报告 |

## 4. Clerk（若本部署仍启用 Dashboard）

在 [Clerk Dashboard](https://dashboard.clerk.com/) → **Domains**，把 **`app.restaurantiq.ai`** 加入允许域名，并配置生产 **Authorized redirect URLs**（含 `https://app.restaurantiq.ai/*`）。

若本环境 **不配置** Clerk，中间件在缺少 Clerk key 时会放行（与现有逻辑一致），但 Dashboard 相关路由将无法正式用于生产登录。

## 5. 验收清单

- [ ] 打开 `https://app.restaurantiq.ai` 自动进入 `/iq`
- [ ] 走通：分析 → 结账（测试卡）→ Webhook 后报告页解锁
- [ ] Stripe Dashboard 中 Webhook 无持续 4xx/5xx

## 6. 与 restaurantiq-amazon 的关系

- Git：`REMOTE_SETUP.txt` 说明勿向 `upstream`（amazon）误推送。
- 基础设施：**独立** Supabase 项目 + **独立** Vercel 项目 + **独立** Stripe Webhook endpoint（可使用同一 Stripe 账号不同 endpoint）。
