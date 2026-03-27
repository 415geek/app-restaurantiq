# RestaurantIQ 项目架构文档

## 1. 产品概述

### 1.1 愿景

**"餐饮 AI 的下一站，不是洞察，是执行。"**

RestaurantIQ 不只是分析报表，而是直接给出建议并安全执行。这是一个面向北美餐饮经营者的智能运营 Agent 平台，适用于堂食、外卖与多门店场景。

### 1.2 核心价值主张

| 痛点 | RestaurantIQ 解决方案 |
|------|----------------------|
| **数据分散** - POS、外卖平台、社媒、评论分散在多个系统 | 多源数据统一整合监控 |
| **决策滞后** - 等月底财报才发现问题 | AI 发现趋势并主动推送建议 |
| **执行低效** - 人工操作费时且易出错 | 一键授权，Agent 自动执行改价/活动 |

### 1.3 目标用户

- 北美华人餐厅经营者
- 多平台外卖餐厅（DoorDash / UberEats / Grubhub / 熊猫外卖 / 饭团外卖）
- 连锁餐饮品牌与多门店管理者

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              客户端层 (Client Layer)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Marketing Site    │    IQ Funnel    │    Dashboard App    │    BO Admin    │
│  (营销官网)         │   (选址漏斗)     │    (运营后台)         │   (管理后台)    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              应用层 (Application Layer)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                           Next.js 16 (App Router)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ API Routes   │  │ Server       │  │ React Server │  │ Middleware   │     │
│  │ /api/*       │  │ Actions      │  │ Components   │  │ Auth/i18n    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              服务层 (Service Layer)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ AI/LLM Engine   │  │ Agent Runtime   │  │ Ops Copilot     │              │
│  │ OpenAI/Anthropic│  │ Multi-Agent     │  │ Command Engine  │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Social Radar    │  │ Delivery Ops    │  │ Analysis Engine │              │
│  │ 社媒监控         │  │ 外卖订单管理     │  │ 数据分析引擎     │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              集成层 (Integration Layer)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│  │UberEats│ │DoorDash│ │Grubhub │ │  Yelp  │ │ Google │ │  Meta  │         │
│  │  API   │ │  API   │ │  API   │ │  API   │ │Business│ │  API   │         │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘         │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                                │
│  │ Stripe │ │  n8n   │ │Weather │ │ Clerk  │                                │
│  │Payment │ │Workflow│ │  API   │ │  Auth  │                                │
│  └────────┘ └────────┘ └────────┘ └────────┘                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据层 (Data Layer)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐  ┌─────────────────────────┐                   │
│  │       Supabase          │  │    NestJS Backend       │                   │
│  │  (PostgreSQL + Auth)    │  │    (微服务 + Redis)      │                   │
│  └─────────────────────────┘  └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | Next.js 16, React 19, TypeScript, Tailwind CSS | App Router, Server Components |
| **UI/UX** | Framer Motion, Lucide Icons, Sonner | 动画、图标、Toast 通知 |
| **认证** | Clerk | 用户认证、OAuth、多租户 |
| **支付** | Stripe | 订阅、一次性支付、Webhook |
| **数据库** | Supabase (PostgreSQL) | 主数据存储、实时订阅 |
| **后端服务** | NestJS | 微服务架构、外卖平台集成 |
| **缓存** | Redis | 会话、队列、实时数据 |
| **AI/LLM** | OpenAI, Anthropic | GPT-4o, Claude, 多模型路由 |
| **工作流** | n8n | 复杂业务流程编排 |
| **部署** | Vercel | 边缘计算、Serverless |

---

## 3. 核心模块

### 3.1 IQ Funnel（选址分析漏斗）

**路径**: `/app/iq/*`

这是一个独立的产品漏斗，为潜在客户提供免费选址分析，通过付费解锁完整报告。

```
Landing Page (/iq)
      │
      ▼ 输入地址 + 业态
Free Analysis (/iq/result)
      │
      ▼ 显示初步判断 + 风险提示 + 付费锁定内容
Stripe Checkout
      │
      ▼ 支付成功
Full Report (/iq/report/[id])
      │
      ▼ 完整分析 + PDF下载 + 账户关联
```

**关键文件**:
- `app/iq/page.tsx` - 选址入口页面
- `app/iq/result/page.tsx` - 免费分析结果
- `app/iq/report/[id]/page.tsx` - 完整付费报告
- `lib/funnel/iq-llm.ts` - LLM 分析引擎
- `lib/funnel/iq-repository.ts` - 报告数据存储

**特性**:
- 中英双语支持（包括 AI 生成内容）
- Stripe 支付集成，支持优惠码
- 客户端 PDF 下载（window.print）
- 社交分享 + 微信 JSSDK
- 用户账户关联

### 3.2 Dashboard（运营后台）

**路径**: `/app/(dashboard)/*`

为已注册用户提供完整的运营管理功能。

| 模块 | 路径 | 功能 |
|------|------|------|
| **Dashboard** | `/dashboard` | 运营概览、每日简报、KPI 卡片 |
| **Analysis** | `/analysis` | 深度分析、AI 建议、执行预览 |
| **Delivery** | `/delivery` | 外卖订单管理、看板视图、实时通知 |
| **Menu** | `/menu-management` | 菜单管理、多分店同步 |
| **Social Radar** | `/social-radar` | 社媒监控、评论聚合、AI 回复 |
| **Ops Copilot** | `/ops-copilot` | 对话式运营助手 |
| **Settings** | `/settings` | 集成管理、执行策略、模型配置 |

### 3.3 AI Agent 系统

**路径**: `lib/server/agents/*`

多 Agent 协作架构，实现复杂分析任务的分解与执行。

```
┌────────────────────────────────────────────────────┐
│              Agent Orchestrator (主控)              │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │         │
│  │ Ops Data │  │ Analyzer │  │ Macro    │         │
│  │ 运营数据  │  │ 深度分析  │  │ 宏观信号  │         │
│  └──────────┘  └──────────┘  └──────────┘         │
│       │             │             │               │
│       └─────────────┴─────────────┘               │
│                     │                             │
│  ┌──────────────────▼──────────────────┐          │
│  │           Agent D (Synthesis)        │          │
│  │          综合建议 + 执行计划           │          │
│  └─────────────────────────────────────┘          │
└────────────────────────────────────────────────────┘
```

**Agent 类型**:
- **Agent A (Ops)**: 收集运营数据（销售、订单、库存）
- **Agent B (Analyzer)**: 深度分析、趋势识别、异常检测
- **Agent C (Macro)**: 宏观信号（天气、事件、竞争）
- **Agent D (Synthesis)**: 综合建议、优先级排序、执行计划

### 3.4 执行引擎

**路径**: `lib/server/orchestration/*`

安全可控的自动化执行系统，核心理念是"人在回路中"(Human-in-the-Loop)。

```
AI 建议生成
     │
     ▼
执行策略检查 (Policy Gate)
     │
     ├─ 低风险 → 自动执行
     │
     ├─ 中风险 → 需要确认
     │
     └─ 高风险 → 滑动确认 + 预览
            │
            ▼
        执行 → 记录 → 回滚窗口
```

**关键组件**:
- `policy-gate.ts` - 风险评估与策略执行
- `execution-planner.ts` - 执行计划生成
- `supervisor.ts` - 执行监督与回滚

### 3.5 外卖平台集成

**路径**: `restaurantiq-backend/src/*`

NestJS 微服务架构，处理外卖平台的实时数据。

| 模块 | 功能 |
|------|------|
| `ubereats/` | UberEats OAuth、订单同步、店铺操作 |
| `doordash/` | DoorDash 集成 |
| `grubhub/` | Grubhub 集成 |
| `delivery/` | 统一订单管理、WebSocket 实时推送 |

**数据流**:
```
外卖平台 Webhook
       │
       ▼
NestJS Backend (订单标准化)
       │
       ▼
Redis (实时队列)
       │
       ▼
Next.js API (订单查询)
       │
       ▼
WebSocket → 前端实时更新
```

### 3.6 Social Radar（社媒雷达）

**路径**: `lib/server/social-radar/*`

跨平台社媒监控与互动管理。

**数据源**:
- Yelp 评论
- Google Business 评价
- Instagram 提及
- 博主/KOL 追踪

**功能**:
- 实时监控新评论/提及
- 情感分析与分类
- AI 生成回复草稿
- 一键发送回复

---

## 4. 数据模型

### 4.1 核心表结构

```sql
-- 选址分析报告
iq_location_reports (
  id UUID PRIMARY KEY,
  location TEXT NOT NULL,
  business_type TEXT,
  verdict TEXT,
  headline TEXT,
  reason TEXT,
  full_report_json JSONB,
  market_data_json JSONB,
  paid BOOLEAN DEFAULT FALSE,
  stripe_session_id TEXT,
  customer_email TEXT,
  user_id TEXT,
  language TEXT DEFAULT 'en',
  share_count INTEGER DEFAULT 0,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- 用户组织
organizations (
  id UUID PRIMARY KEY,
  name TEXT,
  owner_id TEXT,
  subscription_tier TEXT,
  settings JSONB
)

-- 外卖订单
delivery_orders (
  id UUID PRIMARY KEY,
  organization_id UUID,
  platform TEXT, -- ubereats, doordash, grubhub
  platform_order_id TEXT,
  status TEXT,
  items JSONB,
  total_amount DECIMAL,
  created_at TIMESTAMPTZ
)

-- AI 建议
recommendations (
  id UUID PRIMARY KEY,
  organization_id UUID,
  type TEXT,
  priority INTEGER,
  title TEXT,
  description TEXT,
  impact_score DECIMAL,
  execution_plan JSONB,
  status TEXT,
  created_at TIMESTAMPTZ
)
```

---

## 5. 安全与合规

### 5.1 认证与授权

- **Clerk**: 用户认证、OAuth 社交登录、多租户
- **Row Level Security (RLS)**: Supabase 行级安全策略
- **API 密钥管理**: 环境变量、Vercel 密钥存储

### 5.2 数据安全

- 敏感数据加密存储
- OAuth Token 安全刷新机制
- Webhook 签名验证
- HTTPS 强制

### 5.3 隐私合规

- CCPA 加州隐私条款
- 用户数据删除请求支持
- 数据保留策略

---

## 6. 部署架构

### 6.1 生产环境

```
                    ┌─────────────┐
                    │   Vercel    │
                    │  (Next.js)  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   Supabase    │  │     n8n       │  │   NestJS      │
│  (Database)   │  │  (Workflow)   │  │  (Backend)    │
└───────────────┘  └───────────────┘  └───────────────┘
```

### 6.2 环境变量

| 变量 | 用途 |
|------|------|
| `NEXT_PUBLIC_APP_URL` | 应用公开 URL |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 数据库连接 |
| `OPENAI_API_KEY` | OpenAI API |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 支付 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | 认证 |
| `N8N_IQ_ANALYZE_WEBHOOK_URL` | n8n 工作流 |

---

## 7. 商业模式

### 7.1 收入模式

1. **IQ Report 单次购买** ($19/份)
   - 选址分析完整报告
   - 一次性付费，终身访问

2. **订阅 SaaS** (Contact Us)
   - **Starter**: 基础数据看板、每日 10 次分析
   - **Pro**: 全套 Agent、不限次分析、自动执行
   - **Agency**: 多门店管理、专属架构师、定制模型

### 7.2 增长漏斗

```
Marketing Site (流量入口)
       │
       ▼
IQ Funnel (免费分析 → 付费转化)
       │
       ▼
Account Registration (账户注册)
       │
       ▼
Dashboard Trial (后台试用)
       │
       ▼
Subscription Upgrade (付费订阅)
```

### 7.3 差异化竞争力

| 竞品 | RestaurantIQ 优势 |
|------|------------------|
| 传统 BI 工具 | 不只是分析，还能执行 |
| 外卖平台自带分析 | 跨平台统一视图 |
| 通用 AI 助手 | 餐饮行业专业知识 |
| 点评监控工具 | 全链路闭环（监控→分析→执行） |

---

## 8. 路线图

### 已完成 ✅
- [x] IQ 选址分析漏斗
- [x] 多语言支持（中/英）
- [x] Stripe 支付集成
- [x] 基础 Dashboard
- [x] UberEats 集成
- [x] Social Radar 基础版

### 进行中 🚧
- [ ] DoorDash / Grubhub 完整集成
- [ ] 多 Agent 协作优化
- [ ] 执行引擎回滚机制
- [ ] Ops Copilot 对话式交互

### 规划中 📋
- [ ] 供应链库存管理模块
- [ ] 多门店管理
- [ ] 移动端 App
- [ ] 微信小程序

---

## 9. 开发指南

### 9.1 本地开发

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env.local

# 启动开发服务器
pnpm dev
```

### 9.2 项目结构

```
app-restaurantiq/
├── app/                    # Next.js App Router
│   ├── (dashboard)/       # 运营后台页面
│   ├── (marketing)/       # 营销官网
│   ├── iq/                # 选址分析漏斗
│   ├── api/               # API 路由
│   └── layout.tsx         # 根布局
├── components/            # React 组件
├── lib/                   # 工具库
│   ├── server/           # 服务端逻辑
│   │   ├── agents/       # AI Agent
│   │   ├── orchestration/# 执行编排
│   │   └── social-radar/ # 社媒监控
│   └── funnel/           # IQ 漏斗逻辑
├── restaurantiq-backend/  # NestJS 后端服务
├── workflows/            # n8n 工作流定义
└── supabase/             # 数据库迁移
```

### 9.3 代码规范

- TypeScript 严格模式
- ESLint + Prettier
- 组件使用 Server Components 优先
- API 使用 Zod 验证输入

---

## 10. 联系方式

- **官网**: https://restaurantiq.ai
- **支持**: support@restaurantiq.ai
- **隐私**: privacy@restaurantiq.ai

---

*Build with ❤️ in San Francisco*
