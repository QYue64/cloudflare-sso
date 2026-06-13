# SSO + VPC Worker 网关接入标准

本文档是“无用户表 + 内网 HTTP 服务 + Cloudflare Worker 网关”的标准接入方式。

> 适合场景：已有内网 HTTP 服务，不方便改造后端登录逻辑，只希望在公网入口增加统一登陆平台认证，并在登录后代理到 VPC 内部服务。

该模式下，后端 HTTP 应用不需要自己实现 SSO，也不需要维护账号密码。Cloudflare Worker 作为公网入口，负责 OIDC 登录、业务 Cookie、退出登录、VPC 转发和可选的页面退出按钮注入。

## 1. 总体架构

| 环节 | 说明 |
| --- | --- |
| 公网入口 | Cloudflare Worker 绑定业务域名 |
| 登录协议 | OIDC Authorization Code + PKCE |
| 统一登录 | 统一登陆平台 `https://sso.aiku.qzz.io` |
| 业务登录态 | Worker 自己签发业务 Cookie |
| 后端访问 | Worker 通过 Cloudflare VPC HTTP Service 访问内网 HTTP 服务 |
| 用户标识 | 使用 OIDC `sub` 作为统一用户唯一标识 |

标准访问链路：

| 步骤 | 说明 |
| --- | --- |
| 1 | 用户访问业务域名，例如 `https://hermes.uai.qzz.io/` |
| 2 | Worker 检查业务 Cookie |
| 3 | 未登录时跳转统一登陆平台 |
| 4 | 统一登陆平台完成登录并回调 Worker |
| 5 | Worker 用 code 换 token，并调用 UserInfo |
| 6 | Worker 签发自己的业务 Cookie |
| 7 | 已登录请求通过 VPC Service 转发到内网 HTTP 服务 |
| 8 | HTML 页面可由 Worker 注入“退出登录”按钮 |

## 2. Hermes 示例配置

`hermes` 是当前已接入示例。其它应用复制该方案时，替换应用名、域名、Client ID、Redirect URI、VPC Service、VPC Origin 和 Cookie 前缀即可。

### 2.1 OIDC

| 配置项 | 值 |
| --- | --- |
| Issuer | `https://sso.aiku.qzz.io` |
| Client ID | `hermes` |
| Client Secret | 在统一登陆平台应用详情中点击 `Client Secret` 显示后复制 |
| Redirect URI | `https://hermes.uai.qzz.io/auth/callback` |
| Scope | `openid profile email sub` |
| Authorize Endpoint | `https://sso.aiku.qzz.io/oauth/authorize` |
| Token Endpoint | `https://sso.aiku.qzz.io/oauth/token` |
| UserInfo Endpoint | `https://sso.aiku.qzz.io/oauth/userinfo` |
| Logout Endpoint | `https://sso.aiku.qzz.io/oauth/logout` |

### 2.2 Worker Route

Hermes 使用 zone route，不使用 custom domain：

```jsonc
"workers_dev": false,
"routes": [
  {
    "pattern": "hermes.uai.qzz.io/*",
    "zone_name": "uai.qzz.io"
  }
]
```

### 2.3 VPC Service

```jsonc
"vpc_services": [
  {
    "binding": "VPC_SERVICE",
    "service_id": "019ebbae-76e8-71b0-9161-5b88e2ad4a4e",
    "remote": true
  }
]
```

当前 VPC Service 信息：

| 项目 | 值 |
| --- | --- |
| Name | `work-lan-9111` |
| Type | `http` |
| HTTP Port | `9111` |
| IPv4 | `192.168.31.9` |
| Tunnel ID | `3ddb2865-c28a-425c-81df-a549d6b832e7` |

Worker 里的 `VPC_ORIGIN` 用于构造转发请求 URL 和 `Host` 头：

```jsonc
"VPC_ORIGIN": "http://192.168.31.9:9111"
```

## 3. Secret

线上只通过 Wrangler Secret 设置敏感值，不写入代码或配置文件。

| Secret | 用途 |
| --- | --- |
| `SESSION_SECRET` | Worker 用于签发自己的业务 Cookie |
| `OIDC_CLIENT_SECRET` | 统一登陆平台分配给当前应用的客户端密钥 |

设置命令：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OIDC_CLIENT_SECRET
```

生成 `SESSION_SECRET`：

```bash
openssl rand -base64 48
```

本地开发可创建 `.dev.vars`，但不要提交：

```ini
SESSION_SECRET="dev-only-change-me"
OIDC_CLIENT_SECRET="当前应用的 OIDC client secret"
```

## 4. 路由约定

Worker 预留以下路径：

| 路径 | 用途 |
| --- | --- |
| `/auth/login` | 发起 OIDC 登录 |
| `/auth/callback` | 接收统一登陆平台回调 |
| `/auth/logout` | 清理业务 Cookie 并跳转统一登陆平台 logout endpoint |
| `/api/auth/status` | 返回当前登录状态，方便前端或探活使用 |

其它路径全部认为是后端业务路径。登录成功后，原始 path 和 query 会原样转发到 VPC HTTP 服务。

| 访问地址 | 转发地址 |
| --- | --- |
| `https://hermes.uai.qzz.io/dashboard?tab=jobs` | `http://192.168.31.9:9111/dashboard?tab=jobs` |

## 5. 登录流程

### 5.1 未登录访问业务路径

| 请求类型 | Worker 返回 |
| --- | --- |
| 接受 HTML 的请求 | `302 Location: /auth/login?return_to=原路径` |
| 非 HTML 请求 | `401 {"authenticated":false}` |

### 5.2 `/auth/login`

Worker 生成临时 OIDC 状态：

| 值 | 用途 |
| --- | --- |
| `state` | 防止 CSRF |
| `nonce` | 防止 ID Token 重放 |
| `code_verifier` | PKCE 原始随机串 |
| `code_challenge` | PKCE S256 challenge |

临时状态写入 `hermes_oidc_state` Cookie：

```text
Path=/auth
Max-Age=600
HttpOnly
Secure
SameSite=Lax
```

然后跳转到统一登陆平台：

```text
https://sso.aiku.qzz.io/oauth/authorize
```

携带参数：

| 参数 | 值 |
| --- | --- |
| `client_id` | `hermes` |
| `redirect_uri` | `https://hermes.uai.qzz.io/auth/callback` |
| `response_type` | `code` |
| `scope` | `openid profile email sub` |
| `state` | 随机值 |
| `nonce` | 随机值 |
| `code_challenge` | PKCE challenge |
| `code_challenge_method` | `S256` |

### 5.3 `/auth/callback`

SSO 回调后，Worker 执行：

| 顺序 | 动作 |
| --- | --- |
| 1 | 检查 `code` 和 `state` |
| 2 | 读取并校验 `hermes_oidc_state` 签名和过期时间 |
| 3 | 常量时间比较回调 `state` 和 Cookie 内 `state` |
| 4 | 使用 `code` + `code_verifier` 请求 token endpoint |
| 5 | 从 token 响应读取 `access_token` |
| 6 | 使用 `access_token` 请求 userinfo endpoint |
| 7 | 要求 userinfo 至少包含 `sub` |
| 8 | 签发 `hermes_session` Cookie |
| 9 | 清理 `hermes_oidc_state` |
| 10 | 跳回登录前的 `return_to` |

业务登录态 Cookie：

```text
hermes_session=base64url(payload).signature
Path=/
Max-Age=604800
HttpOnly
Secure
SameSite=Lax
```

Payload 示例：

```json
{
  "exp": 1780000000,
  "user": {
    "sub": "统一用户 ID",
    "email": "user@example.com",
    "preferredUsername": "user",
    "name": "用户名称",
    "picture": "头像 URL"
  }
}
```

签名算法为 HMAC-SHA256，密钥来自 `SESSION_SECRET`。

## 6. 退出登录

Worker 提供：

```text
GET /auth/logout
```

该接口会：

| 顺序 | 动作 |
| --- | --- |
| 1 | 清理 `hermes_session` |
| 2 | 清理 `hermes_oidc_state` |
| 3 | 跳转统一登陆平台 logout endpoint |

当前退出跳转：

```text
https://sso.aiku.qzz.io/oauth/logout?client_id=hermes&post_logout_redirect_uri=https%3A%2F%2Fhermes.uai.qzz.io%2Fauth%2Flogin&state=随机值
```

退出后回到本应用 `/auth/login`，再由 Worker 发起新的授权请求。这样可以减少旧授权请求或浏览器历史回退导致的旧 callback 被再次访问。

## 7. 页面退出按钮

如果后端 HTTP 应用没有退出按钮，可以由 Worker 注入：

| 项目 | 说明 |
| --- | --- |
| 处理范围 | 只处理 `content-type` 包含 `text/html` 的响应 |
| 注入方式 | 使用 `HTMLRewriter` 在 `<body>` 末尾追加链接 |
| 展示位置 | 固定在页面左下角 |
| 链接 | `/auth/logout` |

注入不会影响 JS、CSS、图片、接口等非 HTML 响应。

## 8. 转发给后端的用户头

Worker 可以把登录用户信息透传给 VPC 后端。

| Header | 说明 |
| --- | --- |
| `x-hermes-user-sub` | 用户 `sub` |
| `x-hermes-user-email` | 用户 email，存在时才发送 |
| `x-hermes-user-name` | 用户 name，存在时才发送 |

如果后端不需要感知用户，可以忽略这些 header。其它应用复制该方案时，建议把 header 前缀改成自己的应用名，例如 `x-crm-user-sub`。

## 9. 新应用替换清单

假设新应用叫 `example`，域名为 `example.uai.qzz.io`，VPC service id 为 `xxxx`，需要替换：

| 类型 | Hermes 示例 | 新应用示例 |
| --- | --- | --- |
| Client ID | `hermes` | `example` |
| Client Secret | Hermes 应用详情中显示的密钥 | 新应用详情中显示的密钥 |
| Redirect URI | `https://hermes.uai.qzz.io/auth/callback` | `https://example.uai.qzz.io/auth/callback` |
| Route Pattern | `hermes.uai.qzz.io/*` | `example.uai.qzz.io/*` |
| Zone Name | `uai.qzz.io` | 按实际 zone 填写 |
| Session Cookie | `hermes_session` | `example_session` |
| OIDC State Cookie | `hermes_oidc_state` | `example_oidc_state` |
| VPC Service ID | 当前 Hermes service id | 新应用的 VPC service id |
| VPC Origin | `http://192.168.31.9:9111` | `http://后端地址:端口` |

Cookie 常量：

```ts
const SESSION_COOKIE_NAME = "example_session";
const OIDC_STATE_COOKIE_NAME = "example_oidc_state";
```

OIDC 环境变量：

```jsonc
"OIDC_CLIENT_ID": "example",
"OIDC_CLIENT_SECRET": "新应用详情中显示的 client secret",
"OIDC_REDIRECT_URI": "https://example.uai.qzz.io/auth/callback"
```

Route：

```jsonc
"routes": [
  {
    "pattern": "example.uai.qzz.io/*",
    "zone_name": "uai.qzz.io"
  }
]
```

VPC Service 与变量：

```jsonc
"vpc_services": [
  {
    "binding": "VPC_SERVICE",
    "service_id": "新应用的 VPC service id",
    "remote": true
  }
],
"vars": {
  "VPC_ORIGIN": "http://后端地址:端口"
}
```

Secret：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OIDC_CLIENT_SECRET
```

## 10. 部署步骤

```bash
npm install
npm run types
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy
```

每次修改 `wrangler.jsonc` 后都建议运行：

```bash
npm run types
```

## 11. 验证步骤

| 验证项 | 命令 | 预期 |
| --- | --- | --- |
| 未登录跳转 | `curl -I -H 'Accept: text/html' https://hermes.uai.qzz.io/` | `302` 到 `/auth/login?return_to=%2F` |
| 登录入口 | `curl -I 'https://hermes.uai.qzz.io/auth/login?return_to=%2F'` | 跳转到 SSO，包含 `client_id=hermes`、`redirect_uri`、`code_challenge_method=S256` |
| 状态接口 | `curl -i https://hermes.uai.qzz.io/api/auth/status` | 未登录返回 `{"authenticated":false}` |
| VPC 后端 | 浏览器访问 `https://hermes.uai.qzz.io/` | 登录后看到 VPC 后端页面 |
| 退出登录 | `curl -I https://hermes.uai.qzz.io/auth/logout` | 返回 `302`，清理 Cookie，跳转 SSO logout endpoint |

## 12. 常见问题

| 问题 | 检查方向 |
| --- | --- |
| 访问域名没有命中新 Worker | 确认部署输出包含 `hermes.uai.qzz.io/* (zone name: uai.qzz.io)` |
| `/auth/login` 返回 404 | 域名可能没路由到当前 Worker，或有更高优先级的旧 Worker / Pages 路由 |
| 登录回调失败 | 检查 SSO 登记的 Redirect URI、`OIDC_CLIENT_SECRET`、浏览器是否带回 `hermes_oidc_state` |
| `Invalid OIDC state` | 多标签页登录、旧 callback 刷新、退出后访问旧授权流程、临时 Cookie 超过 10 分钟都可能导致 |
| VPC 返回 503 | 检查 `service_id`、`VPC_ORIGIN`、后端 HTTP 服务、Cloudflare Tunnel 在线状态 |
| 页面没有退出按钮 | 检查后端响应头是否包含 `content-type: text/html`，Worker 只对 HTML 响应注入按钮 |

Worker 遇到缺失、过期或不匹配的 state 时，建议清理临时 Cookie 并重新跳到 `/auth/login`，避免用户卡在错误页。
