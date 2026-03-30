# Clerk 控制台：重定向与路径（Restaurant IQ）

我无法代替你登录 [Clerk Dashboard](https://dashboard.clerk.com)。请在本机打开控制台，按下面清单粘贴保存。

## 生产主域名（与 `.env.example` 一致）

`https://app.restaurantiq.ai`

若你使用其他生产域名，把下文中的 `app.restaurantiq.ai` 全部替换为你的域名。

---

## 1. Paths（路径）

**Configure → Paths**（或 **Authentication → URL & paths**，以当前 Clerk UI 为准）

建议：

| 设置项 | 值 |
|--------|-----|
| Sign-in URL | `https://app.restaurantiq.ai/sign-in` |
| Sign-up URL | `https://app.restaurantiq.ai/sign-up` |
| After sign-in / home（若单独配置） | `https://app.restaurantiq.ai/dashboard` 或 `https://app.restaurantiq.ai/iq`（按产品默认落地页选其一） |
| After sign-up | 同上或与 sign-in 一致 |

---

## 2. Allowed redirect URLs（允许的回跳地址）

**Configure → Redirect URLs**（或 **Allowed redirect URLs**）

至少加入（每行一条，可含通配）：

```
https://app.restaurantiq.ai
https://app.restaurantiq.ai/*
https://app.restaurantiq.ai/sign-in
https://app.restaurantiq.ai/sign-in/*
https://app.restaurantiq.ai/sign-up
https://app.restaurantiq.ai/sign-up/*
https://app.restaurantiq.ai/iq
https://app.restaurantiq.ai/iq/*
https://app.restaurantiq.ai/iq/report/*
https://app.restaurantiq.ai/iq/dashboard
https://app.restaurantiq.ai/iq/success
https://app.restaurantiq.ai/dashboard
```

若有 **Vercel Preview**（`*.vercel.app`），在测试环境额外添加对应预览域名，例如：

```
https://你的项目名-xxx.vercel.app/*
```

---

## 3. 与本仓库代码的配合

- 环境变量 **`NEXT_PUBLIC_APP_URL=https://app.restaurantiq.ai`** 应在 Vercel Production 中设置。  
- 登录/注册页会使用该变量把 `redirect_url=/iq/report/...` 解析为 **绝对 URL**，便于通过 Clerk 校验。

---

## 4. Google OAuth（若使用）

**Configure → SSO connections → Google**：在 Google Cloud Console 的 OAuth **Authorized redirect URIs** 中，使用 Clerk 提供的回调地址（Dashboard 里可复制），不要手写应用内的 `/iq/...`。

---

保存后等待 1～2 分钟再测：从报告页点「免费注册」→ Google → 应回到带 `redirect_url` 的报告页并完成关联（见 `ReportContent` 内自动 `link-report` 逻辑）。
