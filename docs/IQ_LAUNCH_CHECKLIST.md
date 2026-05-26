# LocationIQ / RestaurantIQ 上线检查清单

面向「餐饮选址风险审计」产品（六层评分 + 五档决策 + 付费 PDF）。

## 1. 环境变量（三处必须一致）

应用（Vercel / `.env.local`）的 `N8N_IQ_WEBHOOK_SECRET` 必须与 n8n 凭证 **RestaurantIQ IQ Webhook Bearer**（`httpHeaderAuth`，Header `Authorization: Bearer …`）一致。生产工作流 Webhook 节点已启用 `headerAuth`，不再依赖 Code 节点读取 `$env.N8N_IQ_WEBHOOK_SECRET`（避免与 Docker 里旧 env 冲突）。

| 变量 | 用途 |
|------|------|
| `NEXT_PUBLIC_APP_URL` | Clerk 回调、Stripe success URL |
| `OPENAI_API_KEY` | 免费/付费分析 OpenAI 回退 |
| `GOOGLE_MAPS_API_KEY` | 地理编码、Places 竞品、PDF 静态地图 |
| `N8N_IQ_ANALYZE_WEBHOOK_URL` | `https://n8n.c8geek.cloud/webhook/iq-analyze` |
| `N8N_IQ_FULL_REPORT_WEBHOOK_URL` | `https://n8n.c8geek.cloud/webhook/iq-full-report` |
| `N8N_IQ_WEBHOOK_SECRET` | 与 n8n 实例相同的随机串；请求头 `Authorization: Bearer <secret>` |

**本地**：根目录 `.env.local` 已按上表配置（含别名 `N8N_ANALYZE_WEBHOOK_URL` / `N8N_FULL_REPORT_WEBHOOK_URL`，`lib/n8n.ts` 两种命名都读）。

**Vercel**（任选其一）：

```bash
# A) CLI（需 vercel login + 项目已 link）
./scripts/sync-iq-n8n-env-to-vercel.sh

# B) REST API（需 VERCEL_TOKEN + 项目 ID，见 Vercel → Project → Settings → General）
VERCEL_TOKEN=xxx node scripts/set-vercel-iq-n8n-env.mjs <project-id>
```

三项变量写入后 **Redeploy** 生产（或推 main）。`NEXT_PUBLIC_APP_URL` 等其它变量见 `docs/DEPLOY_APP_RESTAURANTIQ.md`。

**n8n**：Bearer 由凭证 **RestaurantIQ IQ Webhook Bearer** 校验（已创建）；无需再改 Docker `N8N_IQ_WEBHOOK_SECRET`，除非你还跑旧版 Code 校验。

冒烟：

```bash
node scripts/test-n8n-analyze-webhook.cjs
```

应返回含 `verdict` / `headline` / `reason` 的 JSON；若 HTTP 200 但 body 为空，检查工作流 **Respond to Webhook** 节点与实例是否已加载上述环境变量。
| Stripe（`STRIPE_*`） | 结账与 webhook |
| Clerk（`NEXT_PUBLIC_CLERK_*`） | 登录与报告归属 |
| Supabase | 报告存储 |
| `TAVILY_API_KEY`（可选） | 深度市场研究 |
| `YELP_API_KEY` / `YELP_FUSION_API_KEY`（可选） | n8n 竞品 enrichment |

## 2. n8n 工作流

从仓库根目录：

```bash
npx --yes n8nac list
npx --yes n8nac push "RestaurantIQ - Analyze.workflow.ts" --verify
npx --yes n8nac push "RestaurantIQ - Full Report.workflow.ts" --verify
npx --yes n8nac workflow activate <analyze-id>
npx --yes n8nac workflow activate <full-report-id>
```

确认远程工作流已包含 `decision_tier`、`risk_audit_preview`（Analyze）与 `risk_audit`（Full Report）。

## 3. 部署应用

```bash
npm run build
# 或推送到 Vercel 主分支
```

## 4. 冒烟测试（生产或 Preview）

1. 打开 `/iq`，输入真实北美地址 + 业态（可选月租/面积）。
2. 免费结果页：应出现五档决策徽章 + `RiskAuditScorecard`（六层/雷达）。
3. 完成 Stripe 测试支付 → `/iq/success` → `/iq/report/{id}`。
4. 付费报告：一句话结论、打平额/安全营收、竞品地图、签租清单、PDF 下载。
5. `GET /api/iq/report/{id}/pdf?lang=zh` 返回 PDF，含风险审计与地图（需 `GOOGLE_MAPS_API_KEY`）。

## 5. 已有报告升级

修改 prompt 或管道后，对已购报告需强制重生成：

```http
POST /api/funnel/full-report
{ "reportId": "<uuid>", "force": true, "language": "zh" }
```

## 6. 已知限制

- 竞品地图坐标依赖 Google Places `geometry`；旧 `market_data` 无 lat/lng 时回退 SVG 示意或仅文字分层说明。
- n8n 与 OpenAI 回退并行存在时，以 webhook 配置为准；未 push 工作流则生产仍可能返回旧 JSON 形状（前端有 normalize 回退）。

## 7. 回滚

- 应用：Vercel 上一部署提升。
- n8n：`npx --yes n8nac pull <workflow-id>` 恢复远程版本或 Git 历史 workflow 文件后 `push`。
