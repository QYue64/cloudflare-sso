<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import MarkdownIt from "markdown-it";
import AppModal from "../components/AppModal.vue";
import AppPagination from "../components/AppPagination.vue";
import EmptyState from "../components/EmptyState.vue";
import FormActions from "../components/FormActions.vue";
import SecretLine from "../components/SecretLine.vue";
import { issuer, postJson } from "../api";
import { handleError, toast } from "../store";
import { consoleData, loadClients } from "../useConsoleData";
import { splitLines, splitWords } from "../utils/format";
import type { Client } from "../types";

const editorOpen = ref(false);
const detailOpen = ref(false);
const docOpen = ref(false);
const editingId = ref("");
const busy = ref(false);
const revealedSecret = ref("");
const docMode = ref<"withUserTable" | "withoutUserTable" | "vpcWorker">("withUserTable");
const selectedClient = ref<Client | null>(null);
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, breaks: false });
const currentPage = ref(1);
const pageSize = ref(10); // 2 行 × 5 列 = 10 个应用
const form = reactive({
  id: "",
  name: "",
  appUrl: "",
  logoUrl: "",
  redirectUris: "",
  allowedScopes: "openid profile email sub",
  pkceRequired: false,
  returnRoles: false,
  allowRegistration: true
});

const endpoints = computed(() => ({
  issuer,
  discovery: `${issuer}/.well-known/openid-configuration`,
  authorize: `${issuer}/oauth/authorize`,
  token: `${issuer}/oauth/token`,
  userinfo: `${issuer}/oauth/userinfo`,
  logout: `${issuer}/oauth/logout`
}));

const markdown = computed(() => {
  const client = selectedClient.value;
  if (!client) return "";
  if (docMode.value === "vpcWorker") {
    return vpcWorkerMarkdown(client);
  }
  return docMode.value === "withUserTable" ? userTableMarkdown(client) : statelessOidcMarkdown(client);
});
const renderedMarkdown = computed(() => markdownRenderer.render(markdown.value));

function oidcBase(client: Client) {
  const redirectUri = client.redirectUris[0] || `https://${client.id}.example.com/auth/callback`;
  const redirectOrigin = safeOrigin(redirectUri) || "https://example.com";
  const appHost = safeHost(client.appUrl || redirectUri) || `${client.id}.example.com`;
  const scopes = client.allowedScopes.join(" ") || "openid profile email sub";
  const authorizationUrl = `${endpoints.value.authorize}?client_id=${encodeURIComponent(client.id)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=YOUR_STATE&nonce=YOUR_NONCE`;
  return { redirectUri, redirectOrigin, appHost, scopes, authorizationUrl };
}

function introBlock(client: Client, modeText: string, description: string, bestFor: string): string {
  return `# ${client.name} ${modeText}接入文档

> ${bestFor}

${description}

| 项目 | 内容 |
| --- | --- |
| 应用名称 | ${client.name} |
| Client ID | \`${client.id}\` |
| Client Secret | \`${clientSecretText(client)}\` |
| 接入模式 | ${modeText} |
| 标准协议 | OIDC Authorization Code + PKCE |
| 用户唯一标识 | \`sub\` |
| 返回用户角色 | ${client.returnRoles ? "是，返回 `roles`" : "否"} |
| 推荐 Scope | \`${oidcBase(client).scopes}\` |`;
}

function clientSecretText(client: Client): string {
  if (revealedSecret.value) return revealedSecret.value;
  return client.secretRevealable ? "请在应用接入配置中点击 Client Secret 显示后复制" : "旧应用需先轮换密钥后再复制";
}

function oidcConfigBlock(client: Client, modeText: string): string {
  const base = oidcBase(client);
  return `## 1. OIDC 配置

| 配置项 | 值 |
| --- | --- |
| 接入模式 | ${modeText} |
| Issuer | \`${issuer}\` |
| Discovery | \`${endpoints.value.discovery}\` |
| Client ID | \`${client.id}\` |
| Client Secret | \`${clientSecretText(client)}\` |
| Redirect URI | \`${base.redirectUri}\` |
| Scope | \`${base.scopes}\` |
| 返回用户角色 | ${client.returnRoles ? "是，返回 `roles` claim" : "否"} |
| Authorization Endpoint | \`${endpoints.value.authorize}\` |
| Token Endpoint | \`${endpoints.value.token}\` |
| UserInfo Endpoint | \`${endpoints.value.userinfo}\` |
| End Session Endpoint | \`${endpoints.value.logout}\` |
| JWKS | \`${issuer}/.well-known/jwks.json\` |`;
}

function architectureBlock(rows: Array<[string, string]>): string {
  return `## 2. 架构目标

| 步骤 | 说明 |
| --- | --- |
${rows.map(([step, description]) => `| ${step} | ${description} |`).join("\n")}`;
}

function commonCodeFlow(client: Client): string {
  const base = oidcBase(client);
  return `## 3. 登录流程

### 3.1 发起授权

业务系统生成以下临时值后跳转到授权端点：

| 临时值 | 用途 |
| --- | --- |
| \`state\` | 防止 CSRF，回调时必须校验 |
| \`nonce\` | 防止 ID Token 重放 |
| \`code_verifier\` | PKCE 原始随机串 |
| \`code_challenge\` | PKCE S256 challenge |

授权地址模板：

\`\`\`text
${base.authorizationUrl}&code_challenge=PKCE_CHALLENGE&code_challenge_method=S256
\`\`\`

### 3.2 用户完成登录和授权

统一登陆平台会根据 \`client_id\` 识别当前业务系统，并在授权页展示应用信息和用户将授权的身份资料。

### 3.3 业务系统处理回调

| 顺序 | 动作 |
| --- | --- |
| 1 | 检查回调中的 \`code\` 和 \`state\` |
| 2 | 校验本地保存的临时登录状态 |
| 3 | 使用 \`code\` + \`code_verifier\` 请求 Token Endpoint |
| 4 | 校验 \`id_token\` 的签名、issuer、audience、nonce、过期时间 |
| 5 | 使用 \`access_token\` 请求 UserInfo Endpoint |
| 6 | 使用 \`sub\` 作为统一用户唯一标识 |`;
}

function logoutBlock(client: Client, postLogoutRedirectUri: string): string {
  return `## 6. 退出登录

业务系统退出时，先清理自己的业务 Cookie / Session，再跳转统一登陆平台 logout endpoint。

\`\`\`text
${endpoints.value.logout}?client_id=${encodeURIComponent(client.id)}&post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}&state=YOUR_STATE
\`\`\`

参数说明：

| 参数 | 是否必填 | 说明 |
| --- | --- | --- |
| \`client_id\` | 推荐 | 当前业务系统的 Client ID。 |
| \`post_logout_redirect_uri\` | 推荐 | 登出后的回跳地址。 |
| \`id_token_hint\` | 可选 | 平台可从 id_token_hint 中识别 client_id。 |
| \`state\` | 可选 | 平台会在回跳时透传。 |

如果没有传 \`post_logout_redirect_uri\`，平台会优先根据当前会话关联的应用和最近授权记录回到业务系统；无法识别时才回到统一登陆平台。`;
}

function claimsBlock(): string {
  return `## 7. Claims 说明

统一登陆平台会返回以下常用字段：

\`\`\`json
{
  "sub": "统一用户 ID",
  "email": "user@example.com",
  "email_verified": true,
  "preferred_username": "user",
  "name": "用户名称",
  "nickname": "昵称",
  "picture": "头像 URL"
}
\`\`\`

如果应用开启“返回用户角色”，还会额外返回：

\`\`\`json
{
  "roles": ["admin"]
}
\`\`\`

| Claim | 用途 | 建议 |
| --- | --- | --- |
| \`sub\` | 统一用户 ID，唯一且稳定 | 必须作为绑定用户的主键 |
| \`preferred_username\` | 应用身份里的用户名 | 只用于展示或预填，不作为唯一标识 |
| \`email\` | 应用身份里的邮箱 | 可能和 SSO 主账号邮箱不同 |
| \`email_verified\` | 当前返回邮箱是否已验证 | 邮箱不同时必须关注该值 |
| \`name\` | 展示名 | 由昵称、用户名等自动生成 |
| \`nickname\` | 昵称 | 用于界面展示 |
| \`picture\` | 头像 URL | 用于头像展示 |
| \`roles\` | 用户角色数组，仅应用开启时返回 | 当前返回 \`admin\` 或 \`user\`，后续可扩展为应用内角色 |`;
}

function standardVerifyBlock(client: Client): string {
  const base = oidcBase(client);
  return `## 8. 验证步骤

| 验证项 | 命令或检查方式 | 预期 |
| --- | --- | --- |
| 授权端点 | \`curl -I '${base.authorizationUrl}'\` | 跳转到统一登陆平台登录或授权页 |
| 回调地址 | 检查应用配置中的 Redirect URI | 必须完全等于 \`${base.redirectUri}\` |
| UserInfo | \`curl -H "Authorization: Bearer <access_token>" ${endpoints.value.userinfo}\` | 返回内容至少包含 \`sub\` |`;
}

function standardTroubleshootingBlock(): string {
  return `## 9. 常见问题

| 问题 | 处理方式 |
| --- | --- |
| \`redirect_uri\` 未注册 | 检查请求里的 \`redirect_uri\` 是否和应用配置完全一致，包括协议、域名、路径和末尾斜杠 |
| \`Invalid OAuth state\` | 检查多个标签页登录、旧 callback 刷新、临时 Cookie 过期、Cookie 域名或 SameSite 配置 |
| scope 不被允许 | 检查应用授权范围是否包含业务系统请求的全部 scope，推荐 \`openid profile email sub\` |
| 用户信息不符合预期 | 统一登陆平台支持应用身份，不同应用可能返回不同用户名、邮箱、昵称和头像；业务系统必须用 \`sub\` 绑定用户 |`;
}

function statelessOidcMarkdown(client: Client): string {
  const base = oidcBase(client);
  const ssoLoginUri = `${issuer}/login?client_id=${encodeURIComponent(client.id)}`;
return `${introBlock(
  client,
  "常规无用户表",
  "该模式下，业务系统不保存密码、不维护本地账号资料，只使用统一登陆平台返回的 `sub` 和 claims 建立自己的业务登录态。",
  "适合：自研前后端、有自己的 Session / Cookie 处理能力，但不想维护账号密码和用户资料。"
)}

${oidcConfigBlock(client, "常规无用户表")}

${architectureBlock([
  ["1", "用户访问业务系统"],
  ["2", "未登录时业务系统跳转统一登陆平台"],
  ["3", "统一登陆平台完成登录和授权"],
  ["4", "业务系统用 code 换取 token"],
  ["5", "业务系统校验 token，并调用 UserInfo"],
  ["6", "业务系统签发自己的 Session / Cookie"],
  ["7", "业务数据使用 `sub` 关联统一账号"]
])}

${commonCodeFlow(client)}

## 4. 本地登录态建议

业务系统可以保存一份轻量 Session，不需要保存用户密码。

\`\`\`json
{
  "sub": "统一用户 ID",
  "email": "user@example.com",
  "preferredUsername": "user",
  "name": "用户名称",
  "picture": "头像 URL",
  "expiresAt": 1780000000
}
\`\`\`

业务数据建议字段：

| 字段 | 用途 |
| --- | --- |
| \`owner_sub\` | 数据归属用户 |
| \`created_by_sub\` | 创建人 |
| \`updated_by_sub\` | 最近更新人 |

不要使用 email 作为唯一用户标识，因为同一个 SSO 主账号可以针对不同应用配置不同邮箱。

## 5. 回跳地址建议

没有自己的用户表时，推荐 \`post_logout_redirect_uri\` 回到统一登陆平台应用登录入口。

| 场景 | 推荐地址 |
| --- | --- |
| 退出后重新登录当前应用 | \`${ssoLoginUri}\` |
| 用户直接访问业务系统 | 业务系统未登录页或首页 |

该页面带 \`client_id\`，用户重新登录后会继续进入 ${client.name} 的 OIDC 授权流程。

${logoutBlock(client, ssoLoginUri)}

${claimsBlock()}

${standardVerifyBlock(client)}

${standardTroubleshootingBlock()}`;
}

function userTableMarkdown(client: Client): string {
  const base = oidcBase(client);
return `${introBlock(
  client,
  "有用户表",
  "该模式下，本地系统不再保存或校验密码，只保留业务用户表、角色、组织、套餐、权限等业务字段，并通过 `sso_sub` 绑定统一账号。",
  "适合：已有用户、组织、角色、权限等业务表，希望保留业务数据结构，只把认证交给统一登陆平台。"
)}

${oidcConfigBlock(client, "有自己的用户表")}

${architectureBlock([
  ["1", "用户访问业务系统"],
  ["2", "未登录时业务系统跳转统一登陆平台"],
  ["3", "统一登陆平台完成登录和授权"],
  ["4", "业务系统用 code 换取 token"],
  ["5", "业务系统校验 token，并调用 UserInfo"],
  ["6", "业务系统使用 `sub` 查找或创建本地用户"],
  ["7", "本地用户表继续保存业务角色、组织关系、权限等字段"]
])}

${commonCodeFlow(client)}

## 4. 本地用户表改造

推荐在本地 \`users\` 表新增统一身份字段：

\`\`\`sql
ALTER TABLE users ADD COLUMN sso_sub TEXT;
CREATE UNIQUE INDEX idx_users_sso_sub ON users(sso_sub);
\`\`\`

推荐同步字段：

| 本地字段 | 来源 Claim | 说明 |
| --- | --- | --- |
| \`sso_sub\` | \`sub\` | 统一用户 ID，唯一绑定字段 |
| \`email\` | \`email\` | 应用身份邮箱，可能不同于主账号邮箱 |
| \`username\` | \`preferred_username\` | 应用身份用户名 |
| \`display_name\` | \`name\` | 展示名 |
| \`nickname\` | \`nickname\` | 昵称 |
| \`avatar_url\` | \`picture\` | 头像 |

不建议使用 email 绑定账号。邮箱可能按应用单独配置，真正稳定的绑定字段是 \`sub\`。

## 5. 首次登录处理

回调后按 \`sub\` 查找本地用户：

| 场景 | 处理方式 |
| --- | --- |
| 找到本地用户 | 更新展示资料，签发本地 Session |
| 找不到本地用户 | 自动创建本地用户，或进入补充资料 / 绑定组织流程 |

示例用户映射：

\`\`\`json
{
  "sso_sub": "统一用户 ID",
  "email": "user@example.com",
  "username": "preferred_username",
  "display_name": "name",
  "avatar_url": "picture"
}
\`\`\`

${logoutBlock(client, `${base.redirectOrigin}/login`)}

有自己的用户表时，推荐退出后回到业务系统自己的登录页或登出完成页，再由业务系统重新发起 OIDC 登录。

${claimsBlock()}

${standardVerifyBlock(client)}

${standardTroubleshootingBlock()}`;
}

function vpcWorkerMarkdown(client: Client): string {
  const redirectUri = client.redirectUris[0] || `https://${client.id}.example.com/auth/callback`;
  const redirectOrigin = safeOrigin(redirectUri) || "https://example.com";
  const appHost = safeHost(client.appUrl || redirectUri) || `${client.id}.example.com`;
  const zoneName = appHost.split(".").slice(-2).join(".") || "example.com";
  const scopes = client.allowedScopes.join(" ") || "openid profile email sub";
  const cookiePrefix = client.id.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "app";
return `${introBlock(
  client,
  "VPC + Worker 网关",
  "Worker 作为公网入口和认证网关：未登录时跳转统一登陆平台，登录成功后由 Worker 签发业务 Cookie，并通过 Cloudflare VPC Service binding 代理到内网 HTTP 服务。",
  "适合：已有内网 HTTP 服务、不方便改代码、只需要在公网入口加一层 SSO 保护和代理。"
)}

## 1. 当前应用参数

| 参数 | 建议值 |
| --- | --- |
| 业务域名 | \`${appHost}\` |
| Worker route | \`${appHost}/*\` |
| Zone name | \`${zoneName}\` |
| Client Secret | \`${clientSecretText(client)}\` |
| 返回用户角色 | ${client.returnRoles ? "是，返回 `roles` claim" : "否"} |
| Redirect URI | \`${redirectUri}\` |
| Session Cookie | \`${cookiePrefix}_session\` |
| OIDC State Cookie | \`${cookiePrefix}_oidc_state\` |
| VPC Origin | \`http://内网地址:端口\` |

${architectureBlock([
  ["1", `用户访问业务域名，例如 \`https://${appHost}/\``],
  ["2", "Worker 检查本地业务 Cookie"],
  ["3", "未登录时跳转统一登陆平台 SSO"],
  ["4", "SSO 使用 OIDC Authorization Code + PKCE 回调 Worker"],
  ["5", "Worker 用 code 换取 token，再用 `access_token` 调用 UserInfo"],
  ["6", "Worker 签发自己的业务 Cookie"],
  ["7", "登录后通过 VPC Service binding 代理到内网 HTTP 服务"],
  ["8", "HTML 页面可由 Worker 注入退出登录按钮"]
])}

## 3. OIDC 配置

| 配置项 | 值 |
| --- | --- |
| Issuer | \`${issuer}\` |
| Client ID | \`${client.id}\` |
| Client Secret | \`${clientSecretText(client)}\` |
| Redirect URI | \`${redirectUri}\` |
| Scope | \`${scopes}\` |
| 返回用户角色 | ${client.returnRoles ? "是，返回 `roles` claim" : "否"} |
| Authorize Endpoint | \`${endpoints.value.authorize}\` |
| Token Endpoint | \`${endpoints.value.token}\` |
| UserInfo Endpoint | \`${endpoints.value.userinfo}\` |
| Logout Endpoint | \`${endpoints.value.logout}\` |
| JWKS | \`${issuer}/.well-known/jwks.json\` |

## 4. Worker 配置

### 4.1 Route

\`\`\`jsonc
"workers_dev": false,
"routes": [
  {
    "pattern": "${appHost}/*",
    "zone_name": "${zoneName}"
  }
]
\`\`\`

### 4.2 VPC Service

\`\`\`jsonc
"vpc_services": [
  {
    "binding": "VPC_SERVICE",
    "service_id": "替换为当前应用的 VPC service id",
    "remote": true
  }
]
\`\`\`

### 4.3 环境变量

\`\`\`jsonc
"VPC_ORIGIN": "http://内网地址:端口"
\`\`\`

### 4.4 配置检查

\`\`\`bash
npx wrangler vpc service get <service-id>
\`\`\`

## 5. Secret

线上只通过 Wrangler Secret 设置敏感值，不写入代码或配置文件：

| Secret | 用途 |
| --- | --- |
| \`SESSION_SECRET\` | Worker 用于签发自己的业务 Cookie |
| \`OIDC_CLIENT_SECRET\` | 统一登陆平台分配给当前应用的客户端密钥 |

\`\`\`bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OIDC_CLIENT_SECRET
\`\`\`

生成 \`SESSION_SECRET\` 示例：

\`\`\`bash
openssl rand -base64 48
\`\`\`

本地开发可创建 \`.dev.vars\`，但不要提交：

\`\`\`ini
SESSION_SECRET="dev-only-change-me"
OIDC_CLIENT_SECRET="当前应用的 OIDC client secret"
\`\`\`

## 6. 路由约定

Worker 预留以下路径：

| 路径 | 用途 |
| --- | --- |
| \`/auth/login\` | 发起 OIDC 登录 |
| \`/auth/callback\` | 接收 SSO 回调 |
| \`/auth/logout\` | 清理业务 Cookie 并跳转 SSO logout |
| \`/api/auth/status\` | 给前端或探活使用的登录状态接口 |

其它路径全部认为是后端业务路径。登录成功后，原始 path 和 query 会原样转发到 VPC HTTP 服务，例如 \`https://${appHost}/dashboard?tab=jobs\` 会转发到 \`http://内网地址:端口/dashboard?tab=jobs\`。

## 7. 登录流程

### 7.1 未登录访问业务路径

| 请求类型 | 返回 |
| --- | --- |
| 接受 HTML | \`302 Location: /auth/login?return_to=原路径\` |
| 非 HTML 请求 | \`401 {"authenticated":false}\` |

### 7.2 \`/auth/login\`

Worker 生成：

| 值 | 用途 |
| --- | --- |
| \`state\` | 防止 CSRF |
| \`nonce\` | 防止 ID Token 重放 |
| \`code_verifier\` | PKCE 原始随机串 |
| \`code_challenge\` | PKCE S256 challenge |

并把临时状态写入 \`${cookiePrefix}_oidc_state\` Cookie：

\`\`\`text
Path=/auth
Max-Age=600
HttpOnly
Secure
SameSite=Lax
\`\`\`

然后跳转到 SSO：

\`\`\`text
${endpoints.value.authorize}
\`\`\`

携带参数：

\`\`\`text
client_id=${client.id}
redirect_uri=${redirectUri}
response_type=code
scope=${scopes}
state=随机值
nonce=随机值
code_challenge=PKCE challenge
code_challenge_method=S256
\`\`\`

### 7.3 \`/auth/callback\`

SSO 回调后，Worker 执行：

1. 检查 \`code\` 和 \`state\`。
2. 读取并校验 \`${cookiePrefix}_oidc_state\` 签名和过期时间。
3. 常量时间比较回调 \`state\` 和 Cookie 内 \`state\`。
4. 使用 \`code\` + \`code_verifier\` 请求 token endpoint。
5. 从 token 响应读取 \`access_token\`。
6. 使用 \`access_token\` 请求 userinfo endpoint。
7. 要求 userinfo 至少包含 \`sub\`。
8. 签发 \`${cookiePrefix}_session\` Cookie。
9. 清理 \`${cookiePrefix}_oidc_state\`。
10. 跳回登录前的 \`return_to\`。

业务登录态 Cookie：

\`\`\`text
${cookiePrefix}_session=base64url(payload).signature
Path=/
Max-Age=604800
HttpOnly
Secure
SameSite=Lax
\`\`\`

Payload 示例：

\`\`\`json
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
\`\`\`

签名算法为 HMAC-SHA256，密钥来自 \`SESSION_SECRET\`。

## 8. 退出登录

Worker 提供：

\`\`\`text
GET /auth/logout
\`\`\`

该接口会：

1. 清理 \`${cookiePrefix}_session\`。
2. 清理 \`${cookiePrefix}_oidc_state\`。
3. 跳转 SSO logout endpoint。

推荐退出跳转：

\`\`\`text
${endpoints.value.logout}?client_id=${encodeURIComponent(client.id)}&post_logout_redirect_uri=${encodeURIComponent(`${redirectOrigin}/auth/login`)}&state=随机值
\`\`\`

退出后回到本应用 \`/auth/login\`，再由 Worker 发起新的授权请求。这样可以减少 SSO 侧旧授权请求或浏览器历史回退导致的旧 callback 被再次访问。

## 9. 页面退出按钮

如果后端 HTTP 应用没有退出按钮，可以由 Worker 注入：

| 项目 | 说明 |
| --- | --- |
| 处理范围 | 只处理 \`content-type\` 包含 \`text/html\` 的响应 |
| 注入方式 | 使用 \`HTMLRewriter\` 在 \`<body>\` 末尾追加链接 |
| 展示位置 | 固定在左下角 |
| 链接 | \`/auth/logout\` |

注入不会影响 JS、CSS、图片、接口等非 HTML 响应。

## 10. 转发给后端的用户头

Worker 可以把登录用户信息透传给 VPC 后端：

| Header | 说明 |
| --- | --- |
| \`x-${cookiePrefix}-user-sub\` | 用户 \`sub\` |
| \`x-${cookiePrefix}-user-email\` | 用户 email，存在时才发送 |
| \`x-${cookiePrefix}-user-name\` | 用户 name，存在时才发送 |

后端如果不需要感知用户，可以忽略这些 header。

## 11. 需要替换的字段

| 类型 | 当前应用建议值 | 说明 |
| --- | --- | --- |
| Session Cookie | \`${cookiePrefix}_session\` | 业务登录态 |
| OIDC State Cookie | \`${cookiePrefix}_oidc_state\` | 临时 OIDC 状态 |
| Client ID | \`${client.id}\` | 统一登陆平台应用 ID |
| Redirect URI | \`${redirectUri}\` | SSO 回调地址 |
| Route Pattern | \`${appHost}/*\` | Worker 绑定业务域名 |
| Zone Name | \`${zoneName}\` | Cloudflare zone |
| VPC Origin | \`http://后端地址:端口\` | VPC 内 HTTP 服务 |

### Cookie 常量

\`\`\`ts
const SESSION_COOKIE_NAME = "${cookiePrefix}_session";
const OIDC_STATE_COOKIE_NAME = "${cookiePrefix}_oidc_state";
\`\`\`

避免多个系统共域时 Cookie 互相影响。

### OIDC 环境变量

\`\`\`jsonc
"OIDC_CLIENT_ID": "${client.id}",
"OIDC_CLIENT_SECRET": "${clientSecretText(client)}",
"OIDC_REDIRECT_URI": "${redirectUri}"
\`\`\`

如果 SSO 端点不变，其它 OIDC endpoint 可以保持一致。

### Worker Route

\`\`\`jsonc
"routes": [
  {
    "pattern": "${appHost}/*",
    "zone_name": "${zoneName}"
  }
]
\`\`\`

### VPC Service 与变量

\`\`\`jsonc
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
\`\`\`

### Secret

为每个应用单独设置：

\`\`\`bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OIDC_CLIENT_SECRET
\`\`\`

## 12. 部署步骤

\`\`\`bash
npm install
npm run types
npm run check
npx wrangler deploy --dry-run
npx wrangler deploy
\`\`\`

每次修改 \`wrangler.jsonc\` 后都建议运行：

\`\`\`bash
npm run types
\`\`\`

## 13. 验证步骤

| 验证项 | 命令 | 预期 |
| --- | --- | --- |
| 未登录跳转 | \`curl -I -H 'Accept: text/html' https://${appHost}/\` | \`302\` 到 \`/auth/login?return_to=%2F\` |
| 登录入口 | \`curl -I 'https://${appHost}/auth/login?return_to=%2F'\` | 跳转到 SSO，包含 \`client_id=${client.id}\` 和 \`code_challenge_method=S256\` |
| 状态接口 | \`curl -i https://${appHost}/api/auth/status\` | 未登录返回 \`{"authenticated":false}\` |
| VPC 后端 | 浏览器访问 \`https://${appHost}/\` | 登录后看到 VPC 后端页面 |
| 退出登录 | \`curl -I https://${appHost}/auth/logout\` | 返回 \`302\`，清理 Cookie，跳转 SSO logout endpoint |

## 14. 常见问题

| 问题 | 检查方向 |
| --- | --- |
| 访问域名没有命中新 Worker | 部署输出应包含 \`${appHost}/* (zone name: ${zoneName})\` |
| \`/auth/login\` 返回 404 | 域名可能没路由到当前 Worker，或有更高优先级的旧 Worker / Pages 路由 |
| 登录回调失败 | 检查 Redirect URI、\`OIDC_CLIENT_SECRET\`、浏览器是否带回 \`${cookiePrefix}_oidc_state\` |
| \`Invalid OIDC state\` | 多标签页登录、旧 callback 刷新、退出后访问旧授权流程、临时 Cookie 超过 10 分钟 |
| VPC 返回 503 | 检查 \`service_id\`、\`VPC_ORIGIN\`、后端 HTTP 服务、Cloudflare Tunnel 在线状态 |
| 页面没有退出按钮 | 检查后端响应头是否包含 \`content-type: text/html\`，Worker 只对 HTML 响应注入按钮 |`;
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

onMounted(() => loadClients(false, currentPage.value, pageSize.value).catch(handleError));

async function handlePageChange(page: number) {
  currentPage.value = page;
  await loadClients(true, page, pageSize.value).catch(handleError);
}

function openCreate() {
  editingId.value = "";
  revealedSecret.value = "";
  Object.assign(form, {
    id: "",
    name: "",
    appUrl: "",
    logoUrl: "",
    redirectUris: "",
    allowedScopes: "openid profile email sub",
    pkceRequired: false,
    returnRoles: false,
    allowRegistration: true
  });
  editorOpen.value = true;
}

function openEdit(client: Client) {
  editingId.value = client.id;
  revealedSecret.value = "";
  Object.assign(form, {
    id: client.id,
    name: client.name,
    appUrl: client.appUrl || "",
    logoUrl: client.logoUrl || "",
    redirectUris: client.redirectUris.join("\n"),
    allowedScopes: client.allowedScopes.join(" "),
    pkceRequired: client.pkceRequired,
    returnRoles: client.returnRoles,
    allowRegistration: client.allowRegistration
  });
  editorOpen.value = true;
}

function openDetail(client: Client) {
  selectedClient.value = client;
  revealedSecret.value = "";
  detailOpen.value = true;
}

function openDocs(client: Client) {
  selectedClient.value = client;
  docOpen.value = true;
}

async function submitClient() {
  busy.value = true;
  try {
    const payload = {
      id: form.id.trim(),
      name: form.name.trim(),
      appUrl: form.appUrl.trim(),
      logoUrl: form.logoUrl.trim(),
      redirectUris: splitLines(form.redirectUris),
      allowedScopes: splitWords(form.allowedScopes),
      confidential: true,
      pkceRequired: form.pkceRequired,
      returnRoles: form.returnRoles,
      allowRegistration: form.allowRegistration
    };
    const result = await postJson<{ client?: Client; clientSecret?: string }>(
      editingId.value ? `/api/admin/clients/${encodeURIComponent(editingId.value)}` : "/api/admin/clients",
      payload
    );
    await loadClients(true, currentPage.value, pageSize.value);
    editorOpen.value = false;
    if (result.client) {
      selectedClient.value = result.client;
      revealedSecret.value = result.clientSecret || "";
      detailOpen.value = true;
    }
    toast(editingId.value ? "应用已保存" : "应用已创建");
  } finally {
    busy.value = false;
  }
}

async function revealSecret() {
  if (!selectedClient.value) return;
  if (revealedSecret.value) {
    await navigator.clipboard?.writeText(revealedSecret.value);
    toast("client secret 已复制");
    return;
  }
  const result = await postJson<{ clientSecret: string }>(`/api/admin/clients/${encodeURIComponent(selectedClient.value.id)}/secret/reveal`);
  revealedSecret.value = result.clientSecret;
  toast("client secret 已显示，再点一次可复制");
}

async function copyValue(value: string) {
  await navigator.clipboard?.writeText(value);
  toast("已复制");
}

async function toggleClient(client: Client) {
  await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/status`, { active: !client.active });
  await loadClients(true, currentPage.value, pageSize.value);
  toast(client.active ? "应用已停用" : "应用已启用");
}

async function rotateClient(client: Client) {
  const result = await postJson<{ clientSecret: string }>(`/api/admin/clients/${encodeURIComponent(client.id)}/secret/rotate`);
  selectedClient.value = client;
  revealedSecret.value = result.clientSecret;
  detailOpen.value = true;
  await loadClients(true, currentPage.value, pageSize.value);
  toast("新密钥已生成");
}

async function deleteClient(client: Client) {
  if (!window.confirm(`确定删除应用 ${client.name}？`)) return;
  await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/delete`);
  await loadClients(true, currentPage.value, pageSize.value);
  toast("应用已删除");
}

function downloadMarkdown() {
  const blob = new Blob([markdown.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${selectedClient.value?.id || "client"}-oidc.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function fillFaviconUrl() {
  const domain = resolveIconDomain(form.appUrl, splitLines(form.redirectUris)[0]);
  if (!domain) {
    toast("请先填写应用网址或回调地址。");
    return;
  }
  form.logoUrl = `https://favicon.im/${domain}?larger=true`;
  toast("已填入应用图标地址");
}

function resolveIconDomain(appUrl: string, redirectUri?: string): string {
  for (const value of [appUrl, redirectUri || ""]) {
    const text = value.trim();
    if (!text) continue;
    try {
      const url = new URL(text.startsWith("http") ? text : `https://${text}`);
      return url.hostname;
    } catch {
      // 继续尝试下一个地址
    }
  }
  return "";
}
</script>

<template>
  <section class="page-stack">
    <div class="client-page-hero">
      <div>
        <span>OIDC 应用</span>
        <strong>{{ consoleData.clientsTotal }} 个接入应用</strong>
        <small>集中管理 Client ID、回调地址、授权范围与接入文档。</small>
      </div>
      <el-button type="primary" @click="openCreate">创建应用</el-button>
    </div>
    <EmptyState v-if="consoleData.clientsTotal === 0" title="暂无应用" description="创建 OIDC 应用后会显示在这里。" />
    <div v-else class="client-grid">
      <article v-for="client in consoleData.clients" :key="client.id" class="client-card" @click="openDetail(client)">
        <div class="client-card-head">
          <div class="client-title-line">
            <span class="client-avatar" :class="{ 'has-image': Boolean(client.logoUrl) }">
              <img v-if="client.logoUrl" :src="client.logoUrl" alt="" />
              <template v-else>{{ client.name.slice(0, 1).toUpperCase() }}</template>
            </span>
            <div>
              <strong>{{ client.name }}</strong>
              <span>{{ client.id }}</span>
            </div>
          </div>
          <el-switch
            :model-value="client.active"
            size="small"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
            :active-value="true"
            :inactive-value="false"
            @click.stop
            @change="toggleClient(client).catch(handleError)"
          />
        </div>
        <div class="client-card-main">
          <span>{{ client.appUrl ? "应用网址" : "授权范围" }}</span>
          <a v-if="client.appUrl" class="app-link" :href="client.appUrl" target="_blank" rel="noreferrer" @click.stop>{{ client.appUrl }}</a>
          <small v-else>{{ `${client.allowedScopes.length} scopes · ${client.returnRoles ? "返回角色" : "不返回角色"}` }}</small>
        </div>
        <div class="client-scope-list">
          <el-tag v-for="scope in client.allowedScopes" :key="scope" size="small" effect="plain" round>{{ scope }}</el-tag>
        </div>
        <div class="client-card-actions" @click.stop>
          <el-button size="small" type="primary" plain @click="openDocs(client)">接入文档</el-button>
          <el-button size="small" @click="openEdit(client)">编辑</el-button>
          <el-button size="small" @click="rotateClient(client).catch(handleError)">轮换密钥</el-button>
          <el-button size="small" type="danger" plain @click="deleteClient(client).catch(handleError)">删除</el-button>
        </div>
      </article>
    </div>

    <AppPagination
      v-if="consoleData.clientsTotal > pageSize"
      v-model:current-page="currentPage"
      :page-size="pageSize"
      :total="consoleData.clientsTotal"
      @update:current-page="handlePageChange"
    />

    <AppModal v-model="editorOpen" :title="editingId ? '编辑应用' : '创建应用'" wide>
      <form class="modal-form two-col" @submit.prevent="submitClient().catch(handleError)">
        <label>应用 ID<input v-model="form.id" :readonly="Boolean(editingId)" placeholder="例如 my-app" /></label>
        <label>应用名称<input v-model="form.name" placeholder="请输入应用名称" /></label>
        <label class="span-two">应用网址<input v-model="form.appUrl" type="url" placeholder="https://app.example.com，可先留空" /></label>
        <label class="span-two">
          Logo URL
          <div class="inline-input-action">
            <input v-model="form.logoUrl" type="url" placeholder="https://example.com/logo.png，可先留空" />
            <el-button type="primary" plain @click.prevent="fillFaviconUrl">获取图标</el-button>
          </div>
        </label>
        <label class="span-two">回调地址<textarea v-model="form.redirectUris" placeholder="每行一个 redirect_uri"></textarea></label>
        <label>Scope<input v-model="form.allowedScopes" placeholder="openid profile email sub" /></label>
        <div class="form-switches span-two">
          <label class="switch-line">
            <span>返回用户角色</span>
            <el-switch v-model="form.returnRoles" />
          </label>
          <label class="switch-line">
            <span>开放注册（允许新用户通过该应用注册）</span>
            <el-switch v-model="form.allowRegistration" />
          </label>
        </div>
        <FormActions class="span-two" :busy="busy" @cancel="editorOpen = false" />
      </form>
    </AppModal>

    <AppModal v-model="detailOpen" title="应用接入配置" wide>
      <div v-if="selectedClient" class="client-detail">
        <div class="copy-grid">
          <SecretLine label="Client ID" :value="selectedClient.id" />
          <a v-if="selectedClient.appUrl" class="copy-line app-link-line" :href="selectedClient.appUrl" target="_blank" rel="noreferrer">
            <span class="copy-line-label">应用网址</span>
            <code class="copy-line-value">{{ selectedClient.appUrl }}</code>
          </a>
          <SecretLine v-else label="应用网址" value="-" />
          <button v-if="selectedClient.confidential" type="button" class="copy-line" @click="revealSecret().catch(handleError)">
            <span class="copy-line-label">Client Secret</span>
            <code class="copy-line-value">{{ revealedSecret || (selectedClient.secretRevealable ? "********" : "旧应用需先轮换密钥") }}</code>
          </button>
          <SecretLine label="Issuer" :value="issuer" />
          <SecretLine label="Discovery" :value="endpoints.discovery" />
          <SecretLine label="Authorize" :value="endpoints.authorize" />
          <SecretLine label="Token" :value="endpoints.token" />
          <SecretLine label="UserInfo" :value="endpoints.userinfo" />
          <SecretLine label="Redirect URI" :value="selectedClient.redirectUris[0] || '-'" />
          <SecretLine label="返回用户角色" :value="selectedClient.returnRoles ? '是，返回 roles' : '否'" />
        </div>
      </div>
    </AppModal>

    <AppModal v-model="docOpen" title="接入文档" doc>
      <div v-if="selectedClient" class="client-detail">
        <div class="doc-mode">
          <el-button :type="docMode === 'withUserTable' ? 'primary' : 'default'" :plain="docMode !== 'withUserTable'" @click="docMode = 'withUserTable'">有自己的用户表</el-button>
          <el-button :type="docMode === 'withoutUserTable' ? 'primary' : 'default'" :plain="docMode !== 'withoutUserTable'" @click="docMode = 'withoutUserTable'">没有自己的用户表</el-button>
          <el-button :type="docMode === 'vpcWorker' ? 'primary' : 'default'" :plain="docMode !== 'vpcWorker'" @click="docMode = 'vpcWorker'">VPC + Worker</el-button>
        </div>
        <section class="markdown-doc" v-html="renderedMarkdown"></section>
        <div class="form-actions">
          <el-button @click="copyValue(markdown)">复制 Markdown</el-button>
          <el-button type="primary" @click="downloadMarkdown">下载 Markdown</el-button>
        </div>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.form-switches {
  display: flex;
  gap: 32px;
  align-items: center;
  padding: 16px 0;
}

.switch-line {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  color: #334155;
  cursor: pointer;
  user-select: none;
}

.switch-line span {
  flex: 1;
}

@media (max-width: 768px) {
  .form-switches {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
}
</style>
