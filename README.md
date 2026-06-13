# Cloudflare SSO

一个运行在 Cloudflare 上的自托管统一登录平台，前端使用 Cloudflare Pages，认证服务使用 Cloudflare Workers，数据存储使用 D1。系统提供常规 OIDC 接入能力，适合给支持 OIDC 的内部系统、管理后台和个人项目做统一登录。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/QYue64/cloudflare-sso)

## 功能

- OIDC Discovery：`/.well-known/openid-configuration`
- JWKS：`/.well-known/jwks.json`
- Authorization Code Flow：`/oauth/authorize`、`/oauth/token`
- Refresh Token 轮换、Token 撤销和 Introspection
- UserInfo：`/oauth/userinfo`
- OIDC Logout：`/oauth/logout`
- 用户名/邮箱 + 密码登录
- 邮箱验证码注册
- 用户授权管理和会话管理
- 管理员后台：用户、应用接入、邮件通道、审计日志
- 应用 Client Secret 可加密保存并回显
- 邮件通道支持 Resend API 和 SMTP
- 移动端使用 NutUI 优化
- D1 迁移和定时清理任务

## 架构

```text
Browser
  |
  | static pages
  v
Cloudflare Pages
  |
  | /api/* /oauth/* /.well-known/*
  v
Cloudflare Workers
  |
  v
Cloudflare D1
```

推荐正式部署时让 Pages 和 Workers 共用同一个域名，例如 `https://login.example.com`：

- Pages 承载 `/login`、`/register`、`/dashboard` 等页面
- Worker 路由承载 `/api/*`、`/oauth/*`、`/.well-known/*`

## 一键部署

点击上方 **Deploy to Cloudflare** 按钮可以把仓库导入到 Cloudflare。由于 D1 数据库、Worker Secret、OIDC 域名和邮件密钥必须由部署者自己创建或填写，导入后还需要完成下面的初始化步骤。

## Cloudflare 初始化

1. 安装依赖并登录 Cloudflare：

```bash
npm install
npx wrangler login
```

2. 创建 D1 数据库：

```bash
npx wrangler d1 create cloudflare-sso
```

把命令输出里的 `database_id` 填到 `wrangler.jsonc` 的 `d1_databases[0].database_id`。

3. 生成 OIDC 私钥：

```bash
node scripts/create-private-jwk.mjs
```

4. 写入 Worker Secrets：

```bash
npx wrangler secret put OIDC_PRIVATE_JWK
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
```

`OIDC_PRIVATE_JWK` 填上一步生成的完整 JSON。`ADMIN_BOOTSTRAP_TOKEN` 建议使用长随机字符串：

```bash
openssl rand -hex 32
```

如果使用 Resend API 发验证码邮件，再设置：

```bash
npx wrangler secret put RESEND_API_KEY
```

也可以部署后在后台切换到 SMTP。

5. 修改生产域名：

```jsonc
{
  "vars": {
    "ISSUER": "https://login.example.com",
    "PAGES_ORIGIN": "https://login.example.com",
    "EXTRA_CORS_ORIGINS": ""
  }
}
```

6. 执行远端迁移并部署：

```bash
npm run db:migrate:remote
npm run deploy:worker
npm run deploy:pages
```

7. 绑定同一个自定义域名后，在 Cloudflare 里为 Worker 配置路由：

```text
login.example.com/.well-known/*
login.example.com/oauth/*
login.example.com/api/*
```

Pages 绑定同一个域名，其他路径由 Pages 响应。

## 首次创建管理员

部署完成后，用 `ADMIN_BOOTSTRAP_TOKEN` 创建第一个管理员和一个测试应用：

```bash
curl -X POST https://login.example.com/api/admin/bootstrap \
  -H "content-type: application/json" \
  -H "x-bootstrap-token: replace-with-your-bootstrap-token" \
  -d '{
    "username": "admin",
    "email": "admin@example.com",
    "password": "change-me-now",
    "displayName": "Admin",
    "client": {
      "id": "demo-app",
      "name": "Demo App",
      "redirectUris": ["https://app.example.com/callback"],
      "allowedScopes": ["openid", "profile", "email"],
      "secret": "replace-with-client-secret"
    }
  }'
```

创建后打开：

```text
https://login.example.com/login
```

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
node scripts/create-private-jwk.mjs
```

把脚本输出填到 `.dev.vars` 的 `OIDC_PRIVATE_JWK`，再把 `ADMIN_BOOTSTRAP_TOKEN` 换成随机字符串。

```bash
npm run db:migrate:local
npm run dev:worker
```

另开一个终端：

```bash
npm run dev:pages
```

本地 Worker 地址是 `http://127.0.0.1:8787`，Pages 地址是 `http://127.0.0.1:8788`。

## OIDC 接入参数

在支持 OIDC 的系统里通常填写：

```text
Issuer: https://login.example.com
Authorization URL: https://login.example.com/oauth/authorize
Token URL: https://login.example.com/oauth/token
UserInfo URL: https://login.example.com/oauth/userinfo
JWKS URL: https://login.example.com/.well-known/jwks.json
Logout URL: https://login.example.com/oauth/logout
Scopes: openid profile email
Response Type: code
PKCE: S256
```

登出推荐跳转到：

```text
https://login.example.com/oauth/logout?client_id=YOUR_CLIENT_ID&post_logout_redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&state=YOUR_STATE
```

`post_logout_redirect_uri` 需要和应用回调地址同源。也可以传 `id_token_hint`，平台会从 `id_token_hint` 中识别 `client_id`。如果没有传 `post_logout_redirect_uri`，平台会优先根据当前会话关联的应用和最近授权记录回到业务系统；无法识别时才回到统一登陆平台。

也可以登录管理员后台，在“应用接入”里创建应用并复制配置。

## 常用命令

```bash
npm run typecheck
npm run db:migrate:local
npm run db:migrate:remote
npm run deploy:worker
npm run deploy:pages
```

## 安全说明

- 不要提交 `.dev.vars`、Cloudflare API Token、Resend API Key、SMTP 密码或私钥。
- 开源版本不会内置默认管理员账号，必须通过 Bootstrap API 创建第一个管理员。
- Bootstrap 完成后建议轮换或删除 `ADMIN_BOOTSTRAP_TOKEN`。
- Client Secret 只在创建或轮换时展示；启用可回显时会加密保存。

## License

MIT
