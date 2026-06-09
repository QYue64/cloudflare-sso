import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, importJWK, jwtVerify, type JWK } from "jose";
import { connect } from "cloudflare:sockets";

type Bindings = {
  DB: D1Database;
  ISSUER: string;
  PAGES_ORIGIN: string;
  EXTRA_CORS_ORIGINS?: string;
  ENVIRONMENT: string;
  OIDC_PRIVATE_JWK: string;
  ADMIN_BOOTSTRAP_TOKEN: string;
  RESEND_API_KEY?: string;
};

type AppContext = Context<{ Bindings: Bindings }>;
type TokenRequestBody = Record<string, FormDataEntryValue | File | string>;

type User = {
  id: string;
  username: string | null;
  email: string;
  display_name: string;
  email_verified: number;
  is_admin: number;
  is_active: number;
};

type Client = {
  id: string;
  name: string;
  redirect_uris: string;
  allowed_scopes: string;
  secret_hash: string | null;
  client_secret_encrypted: string | null;
  pkce_required: number;
  is_active: number;
  created_at?: string;
};

type Session = {
  id: string;
  user_id: string;
  client_id?: string | null;
  expires_at: number;
  created_at?: string;
  ip?: string | null;
  user_agent?: string | null;
  last_seen_at?: string | null;
};

type AuthorizationCode = {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  nonce: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
};

type RefreshTokenRecord = {
  id: string;
  user_id: string;
  client_id: string;
  scope: string;
  expires_at: number;
  revoked_at: string | null;
};

type RevokedAccessToken = {
  token_hash: string;
  client_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: string;
};

type ClientAuthentication = {
  method: "client_secret_basic" | "client_secret_post" | "none";
  clientId: string;
  clientSecret: string;
};

type OAuthGrantRow = {
  id: string;
  client_id: string;
  client_name: string;
  scope: string;
  last_redirect_uri: string;
  granted_at: string;
  updated_at: string;
};

type EmailPurpose = "register" | "bind_email" | "smtp_test";

type EmailCode = {
  id: string;
  purpose: EmailPurpose;
  email: string;
  code_hash: string;
  user_id: string | null;
  return_to: string | null;
  attempts: number;
  consumed_at: string | null;
  expires_at: number;
};

type SmtpConfigInput = {
  provider?: "resend" | "smtp";
  host?: string;
  port?: number;
  secureMode?: "ssl" | "starttls";
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
};

type SmtpConfigUpdateInput = SmtpConfigInput & {
  testEmail?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secureMode: "ssl" | "starttls";
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
};

type EmailDeliverySettings = {
  provider: "resend" | "smtp";
  resendFromEmail: string;
  resendFromName: string;
};

type EmailDeliveryConfig =
  | { provider: "resend"; apiKey: string; fromEmail: string; fromName: string }
  | ({ provider: "smtp" } & SmtpConfig);

const app = new Hono<{ Bindings: Bindings }>();
const sessionCookie = "sso_session";
const sessionMaxAgeSeconds = 60 * 60 * 12;
const codeMaxAgeSeconds = 60 * 5;
const tokenMaxAgeSeconds = 60 * 15;
const refreshTokenMaxAgeSeconds = 60 * 60 * 24 * 30;
const emailCodeMaxAgeSeconds = 60 * 10;
const emailCodeCooldownSeconds = 60;
const emailCodeHourlyLimit = 5;

app.options("*", (c) => withCors(c, new Response(null, { status: 204 })));

app.get("/.well-known/openid-configuration", (c) => {
  return c.json(oauthServerMetadata(c.env.ISSUER));
});

app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json(oauthServerMetadata(c.env.ISSUER));
});

function oauthServerMetadata(issuerInput: string) {
  const issuer = normalizedIssuer(issuerInput);

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    introspection_endpoint: `${issuer}/oauth/introspect`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    end_session_endpoint: `${issuer}/oauth/logout`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_modes_supported: ["query"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256"],
    scopes_supported: ["openid", "profile", "email"],
    prompt_values_supported: ["none", "login", "consent"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    introspection_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["id", "sub", "email", "email_verified", "name"]
  };
}

app.get("/.well-known/jwks.json", async (c) => {
  const privateJwk = parsePrivateJwk(c.env.OIDC_PRIVATE_JWK);
  const publicJwk = toPublicJwk(privateJwk);

  return c.json({ keys: [publicJwk] });
});

app.get("/oauth/authorize", async (c) => {
  const url = new URL(c.req.url);
  const params = url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type") ?? "";
  const scope = params.get("scope") ?? "openid";
  const state = params.get("state") ?? "";
  const prompt = normalizePrompt(params.get("prompt"));
  const nonce = params.get("nonce");
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  const client = await getClient(c.env.DB, clientId);
  const validationError = validateAuthorizeRequest(client, {
    responseType,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod
  });
  if (validationError) {
    return c.text(validationError, 400);
  }

  const session = prompt.has("login") ? null : await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    if (prompt.has("none")) {
      return c.redirect(createAuthorizeErrorRedirect(redirectUri, "login_required", "需要用户登录。", state));
    }
    const loginUrl = new URL("/login", normalizedIssuer(c.env.ISSUER));
    loginUrl.searchParams.set("return_to", `${url.pathname}${url.search}`);
    return c.redirect(loginUrl.toString());
  }

  if (!prompt.has("consent") && (await hasActiveOAuthGrant(c.env.DB, session.user_id, clientId, scope))) {
    const result = await createAuthorizationRedirect(c.env.DB, url, session.user_id);
    if ("error" in result) {
      return c.text(result.error, 400);
    }
    await touchOAuthGrant(c.env.DB, {
      userId: session.user_id,
      clientId,
      redirectUri
    });
    await markSessionClient(c.env.DB, session.id, session.user_id, clientId);
    await recordAuditEvent(c, {
      actorType: "user",
      actorId: session.user_id,
      eventType: "oauth_authorization_auto_granted",
      targetType: "client",
      targetId: clientId,
      metadata: { redirectUri, scope }
    });
    return c.redirect(result.redirectTo);
  }

  if (prompt.has("none")) {
    return c.redirect(createAuthorizeErrorRedirect(redirectUri, "consent_required", "需要用户确认授权。", state));
  }

  const consentUrl = new URL("/authorize", normalizedOrigin(c.env.PAGES_ORIGIN));
  consentUrl.searchParams.set("request", encodeRequestPath(`${url.pathname}${url.search}`));
  return c.redirect(consentUrl.toString());
});

app.get("/api/oauth/authorize/context", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const requestPath = decodeRequestPath(new URL(c.req.url).searchParams.get("request"));
  if (!requestPath) {
    return withCors(c, c.json({ error: "授权请求无效。" }, 400));
  }

  const authorizeUrl = new URL(requestPath, normalizedIssuer(c.env.ISSUER));
  const params = authorizeUrl.searchParams;
  const client = await getClient(c.env.DB, params.get("client_id") ?? "");
  const validationError = validateAuthorizeRequest(client, {
    responseType: params.get("response_type") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    scope: params.get("scope") ?? "openid",
    codeChallenge: params.get("code_challenge") ?? "",
    codeChallengeMethod: params.get("code_challenge_method") ?? ""
  });
  if (validationError || !client) {
    return withCors(c, c.json({ error: validationError ?? "客户端无效。" }, 400));
  }

  const user = await getUserById(c.env.DB, session.user_id);
  return withCors(
    c,
    c.json({
      client: {
        id: client.id,
        name: client.name,
        redirectUri: params.get("redirect_uri"),
        scopes: normalizeScopes(params.get("scope") ?? "openid")
      },
      user: user
        ? {
            email: user.email,
            displayName: user.display_name
          }
        : null
    })
  );
});

app.post("/api/oauth/authorize/confirm", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const { request } = await c.req.json<{ request?: string }>();
  const requestPath = decodeRequestPath(request);
  if (!requestPath) {
    return withCors(c, c.json({ error: "授权请求无效。" }, 400));
  }

  const authorizeUrl = new URL(requestPath, normalizedIssuer(c.env.ISSUER));
  const result = await createAuthorizationRedirect(c.env.DB, authorizeUrl, session.user_id);
  if ("error" in result) {
    return withCors(c, c.json({ error: result.error }, 400));
  }
  await upsertOAuthGrant(c.env.DB, {
    userId: session.user_id,
    clientId: authorizeUrl.searchParams.get("client_id") ?? "",
    scope: authorizeUrl.searchParams.get("scope") ?? "openid",
    redirectUri: authorizeUrl.searchParams.get("redirect_uri") ?? ""
  });
  await markSessionClient(c.env.DB, session.id, session.user_id, authorizeUrl.searchParams.get("client_id") ?? "");

  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "oauth_authorization_granted",
    targetType: "client",
    targetId: authorizeUrl.searchParams.get("client_id") ?? undefined,
    metadata: { redirectUri: authorizeUrl.searchParams.get("redirect_uri"), scope: authorizeUrl.searchParams.get("scope") }
  });
  return withCors(c, c.json({ ok: true, redirectTo: result.redirectTo }));
});

app.post("/api/oauth/authorize/deny", async (c) => {
  const { request } = await c.req.json<{ request?: string }>();
  const requestPath = decodeRequestPath(request);
  if (!requestPath) {
    return withCors(c, c.json({ error: "授权请求无效。" }, 400));
  }
  const authorizeUrl = new URL(requestPath, normalizedIssuer(c.env.ISSUER));
  const params = authorizeUrl.searchParams;
  const client = await getClient(c.env.DB, params.get("client_id") ?? "");
  const validationError = validateAuthorizeRequest(client, {
    responseType: params.get("response_type") ?? "",
    redirectUri: params.get("redirect_uri") ?? "",
    scope: params.get("scope") ?? "openid",
    codeChallenge: params.get("code_challenge") ?? "",
    codeChallengeMethod: params.get("code_challenge_method") ?? ""
  });
  if (validationError) {
    return withCors(c, c.json({ error: validationError }, 400));
  }
  const redirectUri = authorizeUrl.searchParams.get("redirect_uri") ?? "";
  const deniedUrl = new URL(redirectUri);
  deniedUrl.searchParams.set("error", "access_denied");
  const state = authorizeUrl.searchParams.get("state");
  if (state) {
    deniedUrl.searchParams.set("state", state);
  }
  return withCors(c, c.json({ ok: true, redirectTo: deniedUrl.toString() }));
});

async function createAuthorizationRedirect(
  db: D1Database,
  url: URL,
  userId: string
): Promise<{ redirectTo: string } | { error: string }> {
  const params = url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type") ?? "";
  const scope = params.get("scope") ?? "openid";
  const state = params.get("state") ?? "";
  const nonce = params.get("nonce");
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  const client = await getClient(db, clientId);
  const validationError = validateAuthorizeRequest(client, {
    responseType,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod
  });
  if (validationError) {
    return { error: validationError };
  }

  const code = createToken(32);
  await db.prepare(
    `INSERT INTO authorization_codes
      (code, client_id, user_id, redirect_uri, scope, nonce, code_challenge, code_challenge_method, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      code,
      clientId,
      userId,
      redirectUri,
      normalizeScopes(scope).join(" "),
      nonce,
      codeChallenge,
      codeChallengeMethod,
      nowSeconds() + codeMaxAgeSeconds,
      new Date().toISOString()
    )
    .run();

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return { redirectTo: redirectUrl.toString() };
}

app.post("/oauth/token", async (c) => {
  const body = await c.req.parseBody();
  const grantType = String(body.grant_type ?? "");
  const clientAuth = parseClientAuthentication(c.req.header("authorization"), body);
  if ("error" in clientAuth) {
    return oauthError(c, clientAuth.error, clientAuth.description, clientAuth.status);
  }

  const client = await getClient(c.env.DB, clientAuth.clientId);
  if (!client || !client.is_active) {
    return oauthError(c, "invalid_client", "客户端不存在或已禁用。", 401);
  }

  if (client.secret_hash) {
    if (!clientAuth.clientSecret || !(await verifyPassword(clientAuth.clientSecret, client.secret_hash))) {
      return oauthError(c, "invalid_client", "客户端密钥错误。", 401);
    }
  } else if (clientAuth.method !== "none") {
    return oauthError(c, "invalid_client", "公共客户端不应提交 client secret。", 401);
  }

  if (grantType === "authorization_code") {
    return handleAuthorizationCodeGrant(c, body, client);
  }
  if (grantType === "refresh_token") {
    return handleRefreshTokenGrant(c, body, client);
  }

  return oauthError(c, "unsupported_grant_type", "只支持 authorization_code 和 refresh_token。", 400);
});

app.post("/oauth/revoke", async (c) => {
  const body = await c.req.parseBody();
  const clientAuth = parseClientAuthentication(c.req.header("authorization"), body);
  if ("error" in clientAuth) {
    return oauthError(c, clientAuth.error, clientAuth.description, clientAuth.status);
  }
  const client = await authenticateOAuthClient(c, clientAuth);
  if ("response" in client) {
    return client.response;
  }

  const token = String(body.token ?? "");
  if (!token) {
    return oauthError(c, "invalid_request", "缺少 token。", 400);
  }
  await revokeOAuthToken(c.env.DB, c.env, token, client.client.id);
  return new Response(null, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache"
    }
  });
});

app.post("/oauth/introspect", async (c) => {
  const body = await c.req.parseBody();
  const clientAuth = parseClientAuthentication(c.req.header("authorization"), body);
  if ("error" in clientAuth) {
    return oauthError(c, clientAuth.error, clientAuth.description, clientAuth.status);
  }
  const client = await authenticateOAuthClient(c, clientAuth);
  if ("response" in client) {
    return client.response;
  }

  const token = String(body.token ?? "");
  if (!token) {
    return oauthError(c, "invalid_request", "缺少 token。", 400);
  }
  return oauthJson(await introspectOAuthToken(c.env.DB, c.env, token, client.client.id));
});

app.get("/oauth/userinfo", async (c) => {
  const token = getBearerToken(c.req.header("authorization"));
  if (!token) {
    return oauthError(c, "invalid_token", "缺少 Bearer Token。", 401);
  }

  try {
    const privateJwk = parsePrivateJwk(c.env.OIDC_PRIVATE_JWK);
    const publicKey = await importJWK(toPublicJwk(privateJwk), "ES256");
    const { payload } = await jwtVerify(token, publicKey, { issuer: normalizedIssuer(c.env.ISSUER) });
    if (await isAccessTokenRevoked(c.env.DB, token)) {
      return oauthError(c, "invalid_token", "Token 已撤销。", 401);
    }
    return c.json({
      id: payload.sub,
      sub: payload.sub,
      email: payload.email,
      email_verified: true,
      name: payload.name
    });
  } catch {
    return oauthError(c, "invalid_token", "Token 无效。", 401);
  }
});

app.get("/oauth/logout", async (c) => handleOidcLogout(c));
app.post("/oauth/logout", async (c) => handleOidcLogout(c));

async function handleOidcLogout(c: AppContext): Promise<Response> {
  const url = new URL(c.req.url);
  const sessionId = getCookie(c, sessionCookie);
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  deleteCookie(c, sessionCookie, { path: "/" });

  const redirectTo = await safePostLogoutRedirect(c.env.DB, {
    clientId: url.searchParams.get("client_id") ?? undefined,
    postLogoutRedirectUri: url.searchParams.get("post_logout_redirect_uri") ?? undefined,
    issuer: c.env.ISSUER
  });
  return c.redirect(redirectTo);
}

async function handleAuthorizationCodeGrant(
  c: AppContext,
  body: TokenRequestBody,
  client: Client
): Promise<Response> {
  const code = String(body.code ?? "");
  const redirectUri = String(body.redirect_uri ?? "");
  const codeVerifier = String(body.code_verifier ?? "");

  const authCode = await c.env.DB.prepare("SELECT * FROM authorization_codes WHERE code = ?")
    .bind(code)
    .first<AuthorizationCode>();
  if (!authCode || authCode.expires_at < nowSeconds()) {
    return oauthError(c, "invalid_grant", "授权码无效或已过期。", 400);
  }

  if (authCode.client_id !== client.id || authCode.redirect_uri !== redirectUri) {
    return oauthError(c, "invalid_grant", "授权码请求参数不匹配。", 400);
  }

  if (authCode.code_challenge) {
    if (!codeVerifier || !(await verifyPkce(codeVerifier, authCode.code_challenge))) {
      return oauthError(c, "invalid_grant", "PKCE 校验失败。", 400);
    }
  } else if (client.secret_hash && client.pkce_required !== 1) {
    // 兼容部分传统 OAuth 接入方：机密客户端可由后台开关允许不使用 PKCE。
  } else {
    return oauthError(c, "invalid_grant", "授权码缺少 PKCE 绑定。", 400);
  }

  await c.env.DB.prepare("DELETE FROM authorization_codes WHERE code = ?").bind(code).run();

  const user = await getUserById(c.env.DB, authCode.user_id);
  if (!user || !user.is_active) {
    return oauthError(c, "invalid_grant", "用户不存在或已禁用。", 400);
  }

  const tokens = await issueOidcTokens({
    env: c.env,
    user,
    clientId: client.id,
    scope: authCode.scope,
    nonce: authCode.nonce ?? undefined
  });
  const refreshToken = await createRefreshToken(c.env.DB, user.id, client.id, authCode.scope);

  return oidcTokenResponse({
    ...tokens,
    refreshToken,
    scope: authCode.scope
  });
}

async function handleRefreshTokenGrant(
  c: AppContext,
  body: TokenRequestBody,
  client: Client
): Promise<Response> {
  const refreshToken = String(body.refresh_token ?? "");
  if (!refreshToken) {
    return oauthError(c, "invalid_grant", "缺少 refresh_token。", 400);
  }

  const tokenHash = await hashToken(refreshToken);
  const tokenRecord = await c.env.DB.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .bind(tokenHash)
    .first<RefreshTokenRecord>();
  if (
    !tokenRecord ||
    tokenRecord.client_id !== client.id ||
    tokenRecord.revoked_at ||
    tokenRecord.expires_at < nowSeconds()
  ) {
    return oauthError(c, "invalid_grant", "refresh_token 无效或已过期。", 400);
  }

  const user = await getUserById(c.env.DB, tokenRecord.user_id);
  if (!user || !user.is_active) {
    return oauthError(c, "invalid_grant", "用户不存在或已禁用。", 400);
  }

  const newRefreshToken = await rotateRefreshToken(c.env.DB, tokenRecord);
  const tokens = await issueOidcTokens({
    env: c.env,
    user,
    clientId: client.id,
    scope: tokenRecord.scope
  });

  return oidcTokenResponse({
    ...tokens,
    refreshToken: newRefreshToken,
    scope: tokenRecord.scope
  });
}

app.post("/api/login", async (c) => {
  try {
    const { identifier, email, username, password, returnTo } = await c.req.json<{
      identifier?: string;
      email?: string;
      username?: string;
      password?: string;
      returnTo?: string;
    }>();
    const loginId = String(identifier ?? email ?? username ?? "").trim();

    if (!loginId || !password) {
      return withCors(c, c.json({ error: "请输入邮箱或用户名，以及密码。" }, 400));
    }

    const normalizedLoginId = loginId.toLowerCase();
    const row = await c.env.DB.prepare(
      "SELECT id, username, email, display_name, password_hash, email_verified, is_admin, is_active FROM users WHERE email = ? OR username = ?"
    )
      .bind(normalizedLoginId, normalizedLoginId)
      .first<User & { password_hash: string }>();

    if (!row || !row.is_active || !(await verifyPassword(password, row.password_hash))) {
      return withCors(c, c.json({ error: "账号或密码错误。" }, 401));
    }

    await createSession(c.env.DB, row.id, c, c.env.ENVIRONMENT);
    return withCors(c, c.json({ ok: true, redirectTo: safeReturnTo(returnTo, c.env.ISSUER) }));
  } catch (error) {
    console.error(JSON.stringify({ message: "login failed unexpectedly", error: String(error) }));
    return withCors(c, c.json({ error: "登录服务异常。", detail: String(error) }, 500));
  }
});

app.post("/api/auth/email/start", async (c) => {
  const { email, username } = await c.req.json<{ email?: string; username?: string }>();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedEmail) {
    return withCors(c, c.json({ error: "请输入有效邮箱。" }, 400));
  }
  if (username && !normalizedUsername) {
    return withCors(c, c.json({ error: "用户名需为 3-32 位字母、数字、下划线或短横线。" }, 400));
  }
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalizedEmail).first<{ id: string }>();
  if (existing) {
    return withCors(c, c.json({ error: "该邮箱已注册，请直接登录。" }, 409));
  }
  if (normalizedUsername) {
    const usernameExists = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?")
      .bind(normalizedUsername)
      .first<{ id: string }>();
    if (usernameExists) {
      return withCors(c, c.json({ error: "用户名已被使用。" }, 409));
    }
  }

  const rateLimitError = await checkEmailCodeRateLimit(c.env.DB, "register", normalizedEmail);
  if (rateLimitError) {
    await recordAuditEvent(c, {
      actorType: "anonymous",
      eventType: "email_code_rate_limited",
      targetType: "email",
      targetId: normalizedEmail,
      metadata: { purpose: "register", reason: rateLimitError }
    });
    return withCors(c, c.json({ error: rateLimitError }, 429));
  }

  const emailDelivery = await getEmailDeliveryConfig(c.env);
  if (!emailDelivery) {
    return withCors(c, c.json({ error: "邮件发送尚未配置，请先在设置页配置邮件通道。" }, 400));
  }

  const code = createNumericCode();
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO email_verification_codes
      (id, purpose, email, code_hash, return_to, expires_at, created_at)
      VALUES (?, 'register', ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      normalizedEmail,
      await hashEmailCode(code),
      null,
      nowSeconds() + emailCodeMaxAgeSeconds,
      nowIso
    )
    .run();

  const deliveryResult = await sendVerificationEmail(emailDelivery, normalizedEmail, code, "注册验证码");
  await recordAuditEvent(c, {
    actorType: "anonymous",
    eventType: "email_code_sent",
    targetType: "email",
    targetId: normalizedEmail,
    metadata: { purpose: "register", provider: emailDelivery.provider, deliveryId: deliveryResult.id }
  });
  return withCors(c, c.json({ ok: true, expiresIn: emailCodeMaxAgeSeconds }));
});

app.post("/api/auth/email/verify", async (c) => {
  const { username, password, email, code, returnTo } = await c.req.json<{
    username?: string;
    password?: string;
    email?: string;
    code?: string;
    returnTo?: string;
  }>();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  const normalizedCode = normalizeCode(code);
  const passwordError = validatePassword(password);
  if (!normalizedUsername) {
    return withCors(c, c.json({ error: "用户名需为 3-32 位字母、数字、下划线或短横线。" }, 400));
  }
  if (passwordError) {
    return withCors(c, c.json({ error: passwordError }, 400));
  }
  if (!normalizedEmail || !normalizedCode) {
    return withCors(c, c.json({ error: "请输入邮箱和 6 位验证码。" }, 400));
  }

  const emailCode = await getActiveEmailCode(c.env.DB, "register", normalizedEmail);
  if (!emailCode) {
    await recordAuditEvent(c, {
      actorType: "anonymous",
      eventType: "user_registration_failed",
      targetType: "email",
      targetId: normalizedEmail,
      metadata: { reason: "missing_or_expired_code" }
    });
    return withCors(c, c.json({ error: "验证码不存在或已过期。" }, 400));
  }
  if (emailCode.attempts >= 5) {
    return withCors(c, c.json({ error: "验证码尝试次数过多，请重新发送。" }, 429));
  }
  if (!(await verifyEmailCode(normalizedCode, emailCode.code_hash))) {
    await c.env.DB.prepare("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(emailCode.id)
      .run();
    await recordAuditEvent(c, {
      actorType: "anonymous",
      eventType: "user_registration_failed",
      targetType: "email",
      targetId: normalizedEmail,
      metadata: { reason: "wrong_code" }
    });
    return withCors(c, c.json({ error: "验证码错误。" }, 400));
  }

  const [existingEmail, existingUsername] = await Promise.all([
    c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalizedEmail).first<{ id: string }>(),
    c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(normalizedUsername).first<{ id: string }>()
  ]);
  if (existingEmail) {
    return withCors(c, c.json({ error: "该邮箱已注册，请直接登录。" }, 409));
  }
  if (existingUsername) {
    return withCors(c, c.json({ error: "用户名已被使用。" }, 409));
  }

  const user = await createVerifiedUser(c.env.DB, {
    username: normalizedUsername,
    email: normalizedEmail,
    password: password ?? ""
  });
  await c.env.DB.prepare("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), emailCode.id)
    .run();
  await createSession(c.env.DB, user.id, c, c.env.ENVIRONMENT);
  await recordAuditEvent(c, {
    actorType: "user",
    actorId: user.id,
    eventType: "user_registered",
    targetType: "email",
    targetId: normalizedEmail,
    metadata: { username: normalizedUsername }
  });
  return withCors(c, c.json({ ok: true, redirectTo: safeReturnTo(returnTo ?? emailCode.return_to ?? undefined, c.env.ISSUER) }));
});

app.get("/api/me", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ authenticated: false }));
  }
  const user = await getUserById(c.env.DB, session.user_id);
  if (!user) {
    return withCors(c, c.json({ authenticated: false }));
  }
  return withCors(
    c,
    c.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        emailVerified: Boolean(user.email_verified),
        isAdmin: Boolean(user.is_admin)
      }
    })
  );
});

app.post("/api/account/email/start", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }
  const { email } = await c.req.json<{ email?: string }>();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return withCors(c, c.json({ error: "请输入有效邮箱。" }, 400));
  }
  const rateLimitError = await checkEmailCodeRateLimit(c.env.DB, "bind_email", normalizedEmail, session.user_id);
  if (rateLimitError) {
    await recordAuditEvent(c, {
      actorType: "user",
      actorId: session.user_id,
      eventType: "email_code_rate_limited",
      targetType: "email",
      targetId: normalizedEmail,
      metadata: { purpose: "bind_email", reason: rateLimitError }
    });
    return withCors(c, c.json({ error: rateLimitError }, 429));
  }
  const emailDelivery = await getEmailDeliveryConfig(c.env);
  if (!emailDelivery) {
    return withCors(c, c.json({ error: "邮件发送尚未配置。" }, 400));
  }

  const code = createNumericCode();
  await c.env.DB.prepare(
    `INSERT INTO email_verification_codes
      (id, purpose, email, code_hash, user_id, expires_at, created_at)
      VALUES (?, 'bind_email', ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      normalizedEmail,
      await hashEmailCode(code),
      session.user_id,
      nowSeconds() + emailCodeMaxAgeSeconds,
      new Date().toISOString()
    )
    .run();

  const deliveryResult = await sendVerificationEmail(emailDelivery, normalizedEmail, code, "绑定邮箱验证码");
  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "email_code_sent",
    targetType: "email",
    targetId: normalizedEmail,
    metadata: { purpose: "bind_email", provider: emailDelivery.provider, deliveryId: deliveryResult.id }
  });
  return withCors(c, c.json({ ok: true, expiresIn: emailCodeMaxAgeSeconds }));
});

app.post("/api/account/email/verify", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }
  const { email, code } = await c.req.json<{ email?: string; code?: string }>();
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeCode(code);
  if (!normalizedEmail || !normalizedCode) {
    return withCors(c, c.json({ error: "请输入邮箱和 6 位验证码。" }, 400));
  }

  const emailCode = await getActiveEmailCode(c.env.DB, "bind_email", normalizedEmail, session.user_id);
  if (!emailCode) {
    return withCors(c, c.json({ error: "验证码不存在或已过期。" }, 400));
  }
  if (emailCode.attempts >= 5) {
    return withCors(c, c.json({ error: "验证码尝试次数过多，请重新发送。" }, 429));
  }
  if (!(await verifyEmailCode(normalizedCode, emailCode.code_hash))) {
    await c.env.DB.prepare("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(emailCode.id)
      .run();
    return withCors(c, c.json({ error: "验证码错误。" }, 400));
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
    .bind(normalizedEmail, session.user_id)
    .first<{ id: string }>();
  if (existing) {
    return withCors(c, c.json({ error: "该邮箱已绑定其他账号。" }, 409));
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET email = ?, display_name = ?, email_verified = 1, updated_at = ? WHERE id = ?").bind(
      normalizedEmail,
      normalizedEmail,
      new Date().toISOString(),
      session.user_id
    ),
    c.env.DB.prepare("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?").bind(
      new Date().toISOString(),
      emailCode.id
    )
  ]);
  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "email_bound",
    targetType: "email",
    targetId: normalizedEmail
  });

  return withCors(c, c.json({ ok: true }));
});

app.post("/api/account/password", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return withCors(c, c.json({ error: passwordError }, 400));
  }

  const user = await getUserPasswordById(c.env.DB, session.user_id);
  if (!user || !(await verifyPassword(currentPassword ?? "", user.password_hash))) {
    return withCors(c, c.json({ error: "当前密码不正确。" }, 401));
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?").bind(
      await hashPassword(newPassword ?? ""),
      "embedded",
      nowIso,
      session.user_id
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(session.user_id, session.id),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
      nowIso,
      session.user_id
    )
  ]);
  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "password_changed",
    targetType: "user",
    targetId: session.user_id
  });

  return withCors(c, c.json({ ok: true }));
});

app.get("/api/account/grants", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
      oauth_grants.id,
      oauth_grants.client_id,
      clients.name AS client_name,
      oauth_grants.scope,
      oauth_grants.last_redirect_uri,
      oauth_grants.granted_at,
      oauth_grants.updated_at
    FROM oauth_grants
    JOIN clients ON clients.id = oauth_grants.client_id
    WHERE oauth_grants.user_id = ? AND oauth_grants.revoked_at IS NULL
    ORDER BY oauth_grants.updated_at DESC`
  )
    .bind(session.user_id)
    .all<OAuthGrantRow>();

  return withCors(
    c,
    c.json({
      grants: results.map((grant) => ({
        id: grant.id,
        clientId: grant.client_id,
        clientName: grant.client_name,
        scopes: normalizeScopes(grant.scope),
        lastRedirectUri: grant.last_redirect_uri,
        grantedAt: grant.granted_at,
        updatedAt: grant.updated_at
      }))
    })
  );
});

app.post("/api/account/grants/:id/revoke", async (c) => {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const grantId = c.req.param("id");
  const grant = await c.env.DB.prepare("SELECT id, client_id FROM oauth_grants WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(grantId, session.user_id)
    .first<{ id: string; client_id: string }>();
  if (!grant) {
    return withCors(c, c.json({ error: "授权记录不存在。" }, 404));
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE oauth_grants SET revoked_at = ?, updated_at = ? WHERE id = ?").bind(
      new Date().toISOString(),
      new Date().toISOString(),
      grantId
    ),
    c.env.DB.prepare("DELETE FROM authorization_codes WHERE user_id = ? AND client_id = ?").bind(
      session.user_id,
      grant.client_id
    ),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL").bind(
      new Date().toISOString(),
      session.user_id,
      grant.client_id
    )
  ]);
  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "oauth_grant_revoked",
    targetType: "client",
    targetId: grant.client_id
  });

  return withCors(c, c.json({ ok: true }));
});

app.get("/api/account/sessions", async (c) => {
  const currentSessionId = getCookie(c, sessionCookie);
  const session = await getCurrentSession(c.env.DB, currentSessionId);
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
       sessions.id,
       sessions.ip,
       sessions.user_agent,
       sessions.created_at,
       sessions.last_seen_at,
       sessions.expires_at,
       sessions.client_id,
       clients.name AS client_name
     FROM sessions
     LEFT JOIN clients ON clients.id = sessions.client_id
     WHERE sessions.user_id = ?
       AND sessions.expires_at > ?
       AND (
         sessions.id = ?
         OR (
           COALESCE(sessions.user_agent, '') NOT LIKE 'curl/%'
           AND COALESCE(sessions.user_agent, '') != 'node'
           AND COALESCE(sessions.user_agent, '') NOT LIKE 'PostmanRuntime/%'
           AND COALESCE(sessions.user_agent, '') NOT LIKE 'HTTPie/%'
         )
       )
     ORDER BY COALESCE(sessions.last_seen_at, sessions.created_at) DESC`
  )
    .bind(session.user_id, nowSeconds(), currentSessionId)
    .all<{
      id: string;
      ip: string | null;
      user_agent: string | null;
      created_at: string;
      last_seen_at: string | null;
      expires_at: number;
      client_id: string | null;
      client_name: string | null;
    }>();

  return withCors(
    c,
    c.json({
      sessions: results.map((item) => ({
        id: item.id,
        current: item.id === currentSessionId,
        ip: item.ip,
        userAgent: item.user_agent,
        sourceId: item.client_id,
        sourceName: item.client_name ?? "控制台",
        createdAt: item.created_at,
        lastSeenAt: item.last_seen_at,
        expiresAt: item.expires_at
      }))
    })
  );
});

app.post("/api/account/sessions/:id/revoke", async (c) => {
  const currentSessionId = getCookie(c, sessionCookie);
  const session = await getCurrentSession(c.env.DB, currentSessionId);
  if (!session) {
    return withCors(c, c.json({ error: "请先登录。" }, 401));
  }

  const sessionId = c.req.param("id");
  if (sessionId === currentSessionId) {
    return withCors(c, c.json({ error: "当前会话请使用退出登录。" }, 400));
  }

  const result = await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, session.user_id)
    .run();
  if (result.meta.changes === 0) {
    return withCors(c, c.json({ error: "会话不存在。" }, 404));
  }

  await recordAuditEvent(c, {
    actorType: "user",
    actorId: session.user_id,
    eventType: "account_session_revoked",
    targetType: "session",
    targetId: sessionId
  });
  return withCors(c, c.json({ ok: true }));
});

app.get("/api/admin/smtp", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const publicConfig = await getPublicSmtpConfig(c.env.DB, c.env.OIDC_PRIVATE_JWK);
  const deliverySettings = await getEmailDeliverySettings(c.env.DB);
  return withCors(
    c,
    c.json({
      configured: deliverySettings.provider === "resend" ? Boolean(c.env.RESEND_API_KEY) : Boolean(publicConfig),
      provider: deliverySettings.provider,
      resendConfigured: Boolean(c.env.RESEND_API_KEY),
      resend: {
        fromEmail: deliverySettings.resendFromEmail,
        fromName: deliverySettings.resendFromName
      },
      smtp: publicConfig
    })
  );
});

app.post("/api/admin/smtp", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const body = await c.req.json<SmtpConfigUpdateInput>();
  const provider = body.provider === "smtp" ? "smtp" : "resend";
  const deliverySettings = validateEmailDeliverySettings(body, provider);
  if ("error" in deliverySettings) {
    return withCors(c, c.json({ error: deliverySettings.error }, 400));
  }
  let smtpConfig: SmtpConfig | null = null;
  if (provider === "smtp") {
    const existingConfig = await getSmtpConfig(c.env.DB, c.env.OIDC_PRIVATE_JWK);
    const nextSmtpConfig = validateSmtpConfig(body, existingConfig ?? undefined);
    if ("error" in nextSmtpConfig) {
      return withCors(c, c.json({ error: nextSmtpConfig.error }, 400));
    }
    smtpConfig = nextSmtpConfig;
    await saveSmtpConfig(c.env.DB, c.env.OIDC_PRIVATE_JWK, nextSmtpConfig);
  } else if (!c.env.RESEND_API_KEY) {
    return withCors(c, c.json({ error: "Resend API Key 尚未配置到 Worker Secret。" }, 400));
  }

  await saveEmailDeliverySettings(c.env.DB, deliverySettings);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "email_delivery_config_updated",
    targetType: "email_delivery",
    metadata: { provider, smtpHost: smtpConfig?.host, smtpPort: smtpConfig?.port, smtpSecureMode: smtpConfig?.secureMode }
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/smtp/test", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const { testEmail } = await c.req.json<{ testEmail?: string }>();
  const normalizedTestEmail = normalizeEmail(testEmail);
  if (!normalizedTestEmail) {
    return withCors(c, c.json({ error: "请输入有效测试邮箱。" }, 400));
  }

  const emailDelivery = await getEmailDeliveryConfig(c.env);
  if (!emailDelivery) {
    return withCors(c, c.json({ error: "邮件发送尚未配置，请先保存设置。" }, 400));
  }

  let deliveryResult: { id?: string };
  try {
    deliveryResult = await sendVerificationEmail(emailDelivery, normalizedTestEmail, createNumericCode(), "邮件通道测试验证码");
  } catch (error) {
    console.error(JSON.stringify({ message: "email delivery test failed", error: String(error), provider: emailDelivery.provider }));
    return withCors(c, c.json({ error: "测试邮件发送失败。", detail: normalizeErrorMessage(error) }, 502));
  }
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "email_delivery_test_sent",
    targetType: "email",
    targetId: normalizedTestEmail,
    metadata: { provider: emailDelivery.provider, deliveryId: deliveryResult.id }
  });
  return withCors(c, c.json({ ok: true }));
});

app.get("/api/admin/clients", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
      id,
      name,
      redirect_uris,
      allowed_scopes,
      secret_hash,
      client_secret_encrypted,
      COALESCE(pkce_required, 1) AS pkce_required,
      is_active,
      created_at
     FROM clients
     ORDER BY created_at DESC`
  ).all<Client>();
  return withCors(
    c,
    c.json({
      clients: results.map((client) => ({
        id: client.id,
        name: client.name,
        redirectUris: parseJsonArray(client.redirect_uris),
        allowedScopes: parseJsonArray(client.allowed_scopes),
        confidential: Boolean(client.secret_hash),
        secretRevealable: Boolean(client.client_secret_encrypted),
        pkceRequired: client.pkce_required === 1,
        active: Boolean(client.is_active),
        createdAt: client.created_at
      }))
    })
  );
});

app.post("/api/admin/clients", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const body = await c.req.json<{
    id?: string;
    name?: string;
    redirectUris?: string[];
    allowedScopes?: string[];
    confidential?: boolean;
    pkceRequired?: boolean;
  }>();
  const clientId = normalizeClientId(body.id);
  const name = body.name?.trim();
  const redirectUris = normalizeRedirectUris(body.redirectUris);
  const allowedScopes = normalizeAllowedScopes(body.allowedScopes);
  if (!clientId || !name || redirectUris.length === 0) {
    return withCors(c, c.json({ error: "请填写应用 ID、名称和至少一个回调地址。" }, 400));
  }

  const existing = await c.env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first<{ id: string }>();
  if (existing) {
    return withCors(c, c.json({ error: "应用 ID 已存在。" }, 409));
  }

  const clientSecret = body.confidential === false ? null : createToken(32);
  const pkceRequired = clientSecret ? body.pkceRequired !== false : true;
  await c.env.DB.prepare(
    "INSERT INTO clients (id, name, redirect_uris, allowed_scopes, secret_hash, client_secret_encrypted, pkce_required, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      clientId,
      name,
      JSON.stringify(redirectUris),
      JSON.stringify(allowedScopes),
      clientSecret ? await hashPassword(clientSecret) : null,
      clientSecret ? await encryptSecret(c.env.OIDC_PRIVATE_JWK, clientSecret) : null,
      pkceRequired ? 1 : 0,
      new Date().toISOString()
    )
    .run();

  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_created",
    targetType: "client",
    targetId: clientId,
    metadata: { name, redirectUris, allowedScopes, confidential: Boolean(clientSecret), pkceRequired }
  });
  return withCors(
    c,
    c.json({
      ok: true,
      client: {
        id: clientId,
        name,
        redirectUris,
        allowedScopes,
        confidential: Boolean(clientSecret),
        secretRevealable: Boolean(clientSecret),
        pkceRequired,
        active: true
      },
      clientSecret
    })
  );
});

app.post("/api/admin/clients/:id", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const clientId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    redirectUris?: string[];
    allowedScopes?: string[];
    pkceRequired?: boolean;
  }>();
  const name = body.name?.trim();
  const redirectUris = normalizeRedirectUris(body.redirectUris);
  const allowedScopes = normalizeAllowedScopes(body.allowedScopes);
  if (!name || redirectUris.length === 0) {
    return withCors(c, c.json({ error: "请填写应用名称和至少一个回调地址。" }, 400));
  }

  const client = await getClient(c.env.DB, clientId);
  if (!client) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }
  const pkceRequired = client.secret_hash ? body.pkceRequired !== false : true;
  const result = await c.env.DB.prepare(
    "UPDATE clients SET name = ?, redirect_uris = ?, allowed_scopes = ?, pkce_required = ? WHERE id = ?"
  )
    .bind(name, JSON.stringify(redirectUris), JSON.stringify(allowedScopes), pkceRequired ? 1 : 0, clientId)
    .run();
  if (result.meta.changes === 0) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }

  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_updated",
    targetType: "client",
    targetId: clientId,
    metadata: { name, redirectUris, allowedScopes, pkceRequired }
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/clients/:id/status", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const { active } = await c.req.json<{ active?: boolean }>();
  const clientId = c.req.param("id");
  const result = await c.env.DB.prepare("UPDATE clients SET is_active = ? WHERE id = ?").bind(active ? 1 : 0, clientId).run();
  if (result.meta.changes === 0) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }
  if (!active) {
    await c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), clientId)
      .run();
  }
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_status_updated",
    targetType: "client",
    targetId: clientId,
    metadata: { active: Boolean(active) }
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/clients/:id/secret/rotate", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const clientId = c.req.param("id");
  const client = await getClient(c.env.DB, clientId);
  if (!client) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }

  const clientSecret = createToken(32);
  await c.env.DB.prepare("UPDATE clients SET secret_hash = ?, client_secret_encrypted = ? WHERE id = ?")
    .bind(await hashPassword(clientSecret), await encryptSecret(c.env.OIDC_PRIVATE_JWK, clientSecret), clientId)
    .run();
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_secret_rotated",
    targetType: "client",
    targetId: clientId
  });

  return withCors(c, c.json({ ok: true, clientSecret }));
});

app.post("/api/admin/clients/:id/secret/reveal", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const clientId = c.req.param("id");
  const client = await getClient(c.env.DB, clientId);
  if (!client) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }
  if (!client.secret_hash) {
    return withCors(c, c.json({ error: "Public 客户端没有 client secret。" }, 400));
  }
  if (!client.client_secret_encrypted) {
    return withCors(c, c.json({ error: "该应用创建较早，未保存可回显密钥。请轮换密钥后再查看。" }, 404));
  }

  const clientSecret = await decryptSecret(c.env.OIDC_PRIVATE_JWK, client.client_secret_encrypted);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_secret_revealed",
    targetType: "client",
    targetId: clientId
  });
  return withCors(c, c.json({ ok: true, clientSecret }));
});

app.post("/api/admin/clients/:id/delete", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const clientId = c.req.param("id");
  const client = await getClient(c.env.DB, clientId);
  if (!client) {
    return withCors(c, c.json({ error: "应用不存在。" }, 404));
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM authorization_codes WHERE client_id = ?").bind(clientId),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL").bind(
      new Date().toISOString(),
      clientId
    ),
    c.env.DB.prepare("DELETE FROM oauth_grants WHERE client_id = ?").bind(clientId),
    c.env.DB.prepare("DELETE FROM clients WHERE id = ?").bind(clientId)
  ]);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "client_deleted",
    targetType: "client",
    targetId: clientId,
    metadata: { name: client.name }
  });

  return withCors(c, c.json({ ok: true }));
});

app.get("/api/admin/oidc-metadata", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const issuer = normalizedIssuer(c.env.ISSUER);
  return withCors(
    c,
    c.json({
      issuer,
      discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
      jwksEndpoint: `${issuer}/.well-known/jwks.json`,
      authorizationEndpoint: `${issuer}/oauth/authorize`,
      tokenEndpoint: `${issuer}/oauth/token`,
      userinfoEndpoint: `${issuer}/oauth/userinfo`,
      logoutEndpoint: `${issuer}/oauth/logout`,
      responseTypes: ["code"],
      grantTypes: ["authorization_code", "refresh_token"],
      scopes: ["openid", "profile", "email"],
      prompts: ["none", "login", "consent"],
      tokenEndpointAuthMethods: ["client_secret_basic", "client_secret_post", "none"],
      pkce: "S256，可按应用关闭以兼容传统机密客户端"
    })
  );
});

app.get("/api/admin/audit-events", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const limit = Math.min(Number(new URL(c.req.url).searchParams.get("limit") ?? 100), 200);
  const { results } = await c.env.DB.prepare(
    `SELECT id, actor_type, actor_id, event_type, target_type, target_id, ip, user_agent, metadata, created_at
     FROM audit_events
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(limit)
    .all<{
      id: string;
      actor_type: string;
      actor_id: string | null;
      event_type: string;
      target_type: string | null;
      target_id: string | null;
      ip: string | null;
      user_agent: string | null;
      metadata: string;
      created_at: string;
    }>();
  return withCors(
    c,
    c.json({
      events: results.map((event) => ({
        id: event.id,
        actorType: event.actor_type,
        actorId: event.actor_id,
        eventType: event.event_type,
        targetType: event.target_type,
        targetId: event.target_id,
        ip: event.ip,
        userAgent: event.user_agent,
        metadata: safeJsonParse(event.metadata),
        createdAt: event.created_at
      }))
    })
  );
});

app.get("/api/admin/users", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT
      users.id,
      users.username,
      users.email,
      users.display_name,
      users.email_verified,
      users.is_admin,
      users.is_active,
      users.created_at,
      users.updated_at,
      COUNT(sessions.id) AS session_count
    FROM users
    LEFT JOIN sessions ON sessions.user_id = users.id AND sessions.expires_at > ?
      AND COALESCE(sessions.user_agent, '') NOT LIKE 'curl/%'
      AND COALESCE(sessions.user_agent, '') != 'node'
      AND COALESCE(sessions.user_agent, '') NOT LIKE 'PostmanRuntime/%'
      AND COALESCE(sessions.user_agent, '') NOT LIKE 'HTTPie/%'
    GROUP BY users.id
    ORDER BY users.created_at DESC`
  )
    .bind(nowSeconds())
    .all<{
      id: string;
      username: string | null;
      email: string;
      display_name: string;
      email_verified: number;
      is_admin: number;
      is_active: number;
      created_at: string;
      updated_at: string | null;
      session_count: number;
    }>();

  return withCors(
    c,
    c.json({
      users: results.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        emailVerified: Boolean(user.email_verified),
        admin: Boolean(user.is_admin),
        active: Boolean(user.is_active),
        sessionCount: user.session_count,
        createdAt: user.created_at,
        updatedAt: user.updated_at
      }))
    })
  );
});

app.post("/api/admin/users", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const body = await c.req.json<{
    username?: string;
    email?: string;
    displayName?: string;
    password?: string;
    admin?: boolean;
    active?: boolean;
  }>();
  const userInput = normalizeAdminUserInput(body);
  const passwordError = validatePassword(body.password);
  if (!userInput.username) {
    return withCors(c, c.json({ error: "用户名需为 3-32 位字母、数字、下划线或短横线。" }, 400));
  }
  if (!userInput.email) {
    return withCors(c, c.json({ error: "请输入有效邮箱。" }, 400));
  }
  if (passwordError) {
    return withCors(c, c.json({ error: passwordError }, 400));
  }

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .bind(userInput.email, userInput.username)
    .first<{ id: string }>();
  if (existing) {
    return withCors(c, c.json({ error: "邮箱或用户名已被使用。" }, 409));
  }

  const userId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO users
      (id, username, email, display_name, password_hash, password_salt, email_verified, is_admin, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
    .bind(
      userId,
      userInput.username,
      userInput.email,
      userInput.displayName,
      await hashPassword(body.password ?? ""),
      "embedded",
      body.admin ? 1 : 0,
      body.active === false ? 0 : 1,
      nowIso,
      nowIso
    )
    .run();

  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_created",
    targetType: "user",
    targetId: userId,
    metadata: { username: userInput.username, email: userInput.email, admin: Boolean(body.admin) }
  });
  return withCors(c, c.json({ ok: true, id: userId }));
});

app.post("/api/admin/users/:id", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }

  const userId = c.req.param("id");
  const existingUser = await getUserById(c.env.DB, userId);
  if (!existingUser) {
    return withCors(c, c.json({ error: "用户不存在。" }, 404));
  }

  const body = await c.req.json<{
    username?: string;
    email?: string;
    displayName?: string;
    admin?: boolean;
    active?: boolean;
  }>();
  const userInput = normalizeAdminUserInput(body);
  if (!userInput.username) {
    return withCors(c, c.json({ error: "用户名需为 3-32 位字母、数字、下划线或短横线。" }, 400));
  }
  if (!userInput.email) {
    return withCors(c, c.json({ error: "请输入有效邮箱。" }, 400));
  }

  const duplicate = await c.env.DB.prepare("SELECT id FROM users WHERE (email = ? OR username = ?) AND id != ?")
    .bind(userInput.email, userInput.username, userId)
    .first<{ id: string }>();
  if (duplicate) {
    return withCors(c, c.json({ error: "邮箱或用户名已被使用。" }, 409));
  }

  const nextActive = body.active === false ? 0 : 1;
  const nextAdmin = body.admin ? 1 : 0;
  if ((!nextActive || !nextAdmin) && existingUser.is_admin) {
    const activeAdminCount = await countActiveAdmins(c.env.DB);
    if (activeAdminCount <= 1) {
      return withCors(c, c.json({ error: "不能停用或降级最后一个管理员。" }, 400));
    }
  }

  const nowIso = new Date().toISOString();
  const statements = [
    c.env.DB.prepare(
      "UPDATE users SET username = ?, email = ?, display_name = ?, is_admin = ?, is_active = ?, updated_at = ? WHERE id = ?"
    ).bind(userInput.username, userInput.email, userInput.displayName, nextAdmin, nextActive, nowIso, userId)
  ];
  if (!nextActive) {
    statements.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId));
    statements.push(
      c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
        nowIso,
        userId
      )
    );
  }
  await c.env.DB.batch(statements);

  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_updated",
    targetType: "user",
    targetId: userId,
    metadata: { username: userInput.username, email: userInput.email, admin: Boolean(nextAdmin), active: Boolean(nextActive) }
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/users/:id/status", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const { active } = await c.req.json<{ active?: boolean }>();
  const userId = c.req.param("id");
  const existingUser = await getUserById(c.env.DB, userId);
  if (!existingUser) {
    return withCors(c, c.json({ error: "用户不存在。" }, 404));
  }
  if (!active && existingUser.is_admin) {
    const activeAdminCount = await countActiveAdmins(c.env.DB);
    if (activeAdminCount <= 1) {
      return withCors(c, c.json({ error: "不能停用最后一个管理员。" }, 400));
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?").bind(
      active ? 1 : 0,
      new Date().toISOString(),
      userId
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId)
  ]);
  if (!active) {
    await c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), userId)
      .run();
  }
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_status_updated",
    targetType: "user",
    targetId: userId,
    metadata: { active: Boolean(active) }
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/users/:id/password", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const userId = c.req.param("id");
  const { password } = await c.req.json<{ password?: string }>();
  const passwordError = validatePassword(password);
  if (passwordError) {
    return withCors(c, c.json({ error: passwordError }, 400));
  }
  const existingUser = await getUserById(c.env.DB, userId);
  if (!existingUser) {
    return withCors(c, c.json({ error: "用户不存在。" }, 404));
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?").bind(
      await hashPassword(password ?? ""),
      "embedded",
      nowIso,
      userId
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
      nowIso,
      userId
    )
  ]);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_password_reset",
    targetType: "user",
    targetId: userId
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/users/:id/delete", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const userId = c.req.param("id");
  if (admin.user?.id === userId) {
    return withCors(c, c.json({ error: "不能删除当前登录的管理员账号。" }, 400));
  }
  const existingUser = await getUserById(c.env.DB, userId);
  if (!existingUser) {
    return withCors(c, c.json({ error: "用户不存在。" }, 404));
  }
  if (existingUser.is_admin) {
    const activeAdminCount = await countActiveAdmins(c.env.DB);
    if (activeAdminCount <= 1) {
      return withCors(c, c.json({ error: "不能删除最后一个管理员。" }, 400));
    }
  }

  const nowIso = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
      nowIso,
      userId
    ),
    c.env.DB.prepare("DELETE FROM oauth_grants WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM email_verification_codes WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId)
  ]);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_deleted",
    targetType: "user",
    targetId: userId
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/users/:id/revoke-sessions", async (c) => {
  const admin = await requireAdmin(c);
  if ("response" in admin) {
    return admin.response;
  }
  const userId = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
      new Date().toISOString(),
      userId
    )
  ]);
  await recordAuditEvent(c, {
    actorType: "admin",
    actorId: admin.user?.id,
    eventType: "user_sessions_revoked",
    targetType: "user",
    targetId: userId
  });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/logout", async (c) => {
  const sessionId = getCookie(c, sessionCookie);
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  deleteCookie(c, sessionCookie, { path: "/" });
  return withCors(c, c.json({ ok: true }));
});

app.post("/api/admin/bootstrap", async (c) => {
  const token = c.req.header("x-bootstrap-token") ?? "";
  if (!(await timingSafeEqualText(token, c.env.ADMIN_BOOTSTRAP_TOKEN))) {
    return c.json({ error: "Bootstrap token 无效。" }, 401);
  }

  const exists = await c.env.DB.prepare("SELECT id FROM bootstrap_state WHERE id = 'initial'").first();
  if (exists) {
    return c.json({ error: "系统已经初始化。" }, 409);
  }

  const body = await c.req.json<{
    username?: string;
    email?: string;
    password?: string;
    displayName?: string;
    client?: {
      id?: string;
      name?: string;
      redirectUris?: string[];
      allowedScopes?: string[];
      secret?: string;
    };
  }>();

  const normalizedEmail = normalizeEmail(body.email);
  const normalizedUsername = normalizeUsername(body.username ?? body.displayName ?? body.email?.split("@")[0]);
  const passwordError = validatePassword(body.password);
  if (!normalizedEmail || !normalizedUsername || passwordError || !body.client?.id || !body.client.redirectUris?.length) {
    return c.json({ error: "缺少初始化用户或客户端信息。" }, 400);
  }
  const password = body.password;
  if (!password) {
    return c.json({ error: "缺少初始化用户或客户端信息。" }, 400);
  }

  const userId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const clientSecretHash = body.client.secret ? await hashPassword(body.client.secret) : null;
  const clientSecretEncrypted = body.client.secret ? await encryptSecret(c.env.OIDC_PRIVATE_JWK, body.client.secret) : null;

  const statements = [
    c.env.DB.prepare(
      "INSERT INTO users (id, username, email, display_name, password_hash, password_salt, email_verified, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)"
    ).bind(
      userId,
      normalizedUsername,
      normalizedEmail,
      body.displayName?.trim() || normalizedUsername,
      await hashPassword(password),
      "embedded",
      nowIso
    ),
    c.env.DB.prepare(
      "INSERT INTO clients (id, name, redirect_uris, allowed_scopes, secret_hash, client_secret_encrypted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      body.client.id,
      body.client.name ?? body.client.id,
      JSON.stringify(body.client.redirectUris),
      JSON.stringify(body.client.allowedScopes ?? ["openid", "profile", "email"]),
      clientSecretHash,
      clientSecretEncrypted,
      nowIso
    ),
    c.env.DB.prepare("INSERT INTO bootstrap_state (id, created_at) VALUES ('initial', ?)").bind(nowIso)
  ];

  await c.env.DB.batch(statements);
  return c.json({ ok: true, userId, clientId: body.client.id });
});

app.get("/login", (c) => {
  const loginUrl = new URL("/login", normalizedOrigin(c.env.PAGES_ORIGIN));
  const sourceUrl = new URL(c.req.url);
  const returnTo = sourceUrl.searchParams.get("return_to");
  if (returnTo) {
    loginUrl.searchParams.set("return_to", returnTo);
  }
  return c.redirect(loginUrl.toString());
});

app.get("/register", (c) => {
  const registerUrl = new URL("/register", normalizedOrigin(c.env.PAGES_ORIGIN));
  const sourceUrl = new URL(c.req.url);
  const returnTo = sourceUrl.searchParams.get("return_to");
  if (returnTo) {
    registerUrl.searchParams.set("return_to", returnTo);
  }
  return c.redirect(registerUrl.toString());
});

app.get("/", (c) => c.redirect(`${normalizedOrigin(c.env.PAGES_ORIGIN)}/dashboard`));

function validateAuthorizeRequest(
  client: Client | null,
  request: {
    responseType: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: string;
  }
): string | null {
  if (!client || !client.is_active) {
    return "客户端不存在或已禁用。";
  }
  if (request.responseType !== "code") {
    return "response_type 必须是 code。";
  }
  if (!parseJsonArray(client.redirect_uris).includes(request.redirectUri)) {
    return "redirect_uri 未注册。";
  }
  if (client.pkce_required === 1 || !client.secret_hash) {
    if (!request.codeChallenge || request.codeChallengeMethod !== "S256") {
      return "必须使用 S256 PKCE。";
    }
  } else if (request.codeChallenge && request.codeChallengeMethod !== "S256") {
    return "PKCE 只支持 S256。";
  }
  const allowedScopes = new Set(parseJsonArray(client.allowed_scopes));
  for (const scope of normalizeScopes(request.scope)) {
    if (!allowedScopes.has(scope)) {
      return `scope 不被允许：${scope}`;
    }
  }
  if (!normalizeScopes(request.scope).includes("openid")) {
    return "scope 必须包含 openid。";
  }
  return null;
}

async function getClient(db: D1Database, clientId: string): Promise<Client | null> {
  if (!clientId) {
    return null;
  }
  return db
    .prepare(
      `SELECT
        id,
        name,
        redirect_uris,
        allowed_scopes,
        secret_hash,
        client_secret_encrypted,
        COALESCE(pkce_required, 1) AS pkce_required,
        is_active,
        created_at
       FROM clients
       WHERE id = ?`
    )
    .bind(clientId)
    .first<Client>();
}

async function getUserById(db: D1Database, userId: string): Promise<User | null> {
  return db
    .prepare("SELECT id, username, email, display_name, email_verified, is_admin, is_active FROM users WHERE id = ?")
    .bind(userId)
    .first<User>();
}

async function getUserPasswordById(db: D1Database, userId: string): Promise<(User & { password_hash: string }) | null> {
  return db
    .prepare(
      "SELECT id, username, email, display_name, email_verified, is_admin, is_active, password_hash FROM users WHERE id = ?"
    )
    .bind(userId)
    .first<User & { password_hash: string }>();
}

async function countActiveAdmins(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND is_active = 1").first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function normalizeAdminUserInput(input: { username?: string; email?: string; displayName?: string }): {
  username: string | null;
  email: string | null;
  displayName: string;
} {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || username || email || "";
  return {
    username,
    email,
    displayName: displayName.slice(0, 80)
  };
}

async function getCurrentUser(c: AppContext): Promise<User | null> {
  const session = await getCurrentSession(c.env.DB, getCookie(c, sessionCookie));
  if (!session) {
    return null;
  }
  return getUserById(c.env.DB, session.user_id);
}

async function requireAdmin(c: AppContext): Promise<{ user: User | null } | { response: Response }> {
  const token = c.req.header("x-bootstrap-token") ?? "";
  if (token && (await timingSafeEqualText(token, c.env.ADMIN_BOOTSTRAP_TOKEN))) {
    return { user: null };
  }

  const user = await getCurrentUser(c);
  if (!user) {
    return { response: withCors(c, c.json({ error: "请先登录管理员账号。" }, 401)) };
  }
  if (!user.is_active || !user.is_admin) {
    return { response: withCors(c, c.json({ error: "需要管理员权限。" }, 403)) };
  }
  return { user };
}

async function getCurrentSession(db: D1Database, sessionId?: string): Promise<Session | null> {
  if (!sessionId) {
    return null;
  }
  const session = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first<Session>();
  if (!session || session.expires_at < nowSeconds()) {
    await db.prepare("DELETE FROM sessions WHERE id = ? OR expires_at < ?").bind(sessionId, nowSeconds()).run();
    return null;
  }
  await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(new Date().toISOString(), sessionId).run();
  return session;
}

async function createSession(
  db: D1Database,
  userId: string,
  c: AppContext,
  environment: string
): Promise<void> {
  const sessionId = createToken(32);
  const nowIso = new Date().toISOString();
  await db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at, ip, user_agent, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      sessionId,
      userId,
      nowSeconds() + sessionMaxAgeSeconds,
      nowIso,
      c.req.header("cf-connecting-ip") ?? null,
      c.req.header("user-agent") ?? null,
      nowIso
    )
    .run();

  setCookie(c, sessionCookie, sessionId, {
    httpOnly: true,
    secure: environment !== "development",
    sameSite: "Lax",
    path: "/",
    maxAge: sessionMaxAgeSeconds
  });
}

async function createVerifiedUser(
  db: D1Database,
  input: { username: string; email: string; password: string }
): Promise<User> {
  const user: User = {
    id: crypto.randomUUID(),
    username: input.username,
    email: input.email,
    display_name: input.username,
    email_verified: 1,
    is_admin: 0,
    is_active: 1
  };
  await db
    .prepare(
      "INSERT INTO users (id, username, email, display_name, password_hash, password_salt, email_verified, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)"
    )
    .bind(user.id, user.username, user.email, user.display_name, await hashPassword(input.password), "embedded", new Date().toISOString())
    .run();
  return user;
}

async function issueOidcTokens(input: {
  env: Bindings;
  user: User;
  clientId: string;
  scope: string;
  nonce?: string;
}): Promise<{ accessToken: string; idToken: string }> {
  const issuer = normalizedIssuer(input.env.ISSUER);
  const privateJwk = parsePrivateJwk(input.env.OIDC_PRIVATE_JWK);
  const privateKey = await importJWK(privateJwk, "ES256");
  const accessToken = await new SignJWT({
    scope: input.scope,
    email: input.user.email,
    name: input.user.display_name
  })
    .setProtectedHeader({ alg: "ES256", kid: privateJwk.kid })
    .setIssuer(issuer)
    .setSubject(input.user.id)
    .setAudience(input.clientId)
    .setIssuedAt()
    .setExpirationTime(`${tokenMaxAgeSeconds}s`)
    .sign(privateKey);

  const idToken = await new SignJWT({
    nonce: input.nonce,
    email: input.user.email,
    email_verified: true,
    name: input.user.display_name
  })
    .setProtectedHeader({ alg: "ES256", kid: privateJwk.kid })
    .setIssuer(issuer)
    .setSubject(input.user.id)
    .setAudience(input.clientId)
    .setIssuedAt()
    .setExpirationTime(`${tokenMaxAgeSeconds}s`)
    .sign(privateKey);

  return { accessToken, idToken };
}

async function createRefreshToken(db: D1Database, userId: string, clientId: string, scope: string): Promise<string> {
  const refreshToken = createToken(48);
  await db.prepare(
    `INSERT INTO refresh_tokens
      (id, token_hash, user_id, client_id, scope, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      await hashToken(refreshToken),
      userId,
      clientId,
      scope,
      nowSeconds() + refreshTokenMaxAgeSeconds,
      new Date().toISOString()
    )
    .run();
  return refreshToken;
}

async function rotateRefreshToken(db: D1Database, tokenRecord: RefreshTokenRecord): Promise<string> {
  const refreshToken = createToken(48);
  const tokenId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?").bind(
      nowIso,
      tokenId,
      tokenRecord.id
    ),
    db.prepare(
      `INSERT INTO refresh_tokens
        (id, token_hash, user_id, client_id, scope, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tokenId,
      await hashToken(refreshToken),
      tokenRecord.user_id,
      tokenRecord.client_id,
      tokenRecord.scope,
      nowSeconds() + refreshTokenMaxAgeSeconds,
      nowIso
    )
  ]);
  return refreshToken;
}

function oidcTokenResponse(input: {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  scope: string;
}): Response {
  return new Response(
    JSON.stringify({
      access_token: input.accessToken,
      id_token: input.idToken,
      refresh_token: input.refreshToken,
      token_type: "Bearer",
      expires_in: tokenMaxAgeSeconds,
      refresh_expires_in: refreshTokenMaxAgeSeconds,
      scope: input.scope
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        pragma: "no-cache"
      }
    }
  );
}

async function getActiveEmailCode(
  db: D1Database,
  purpose: EmailPurpose,
  email: string,
  userId?: string
): Promise<EmailCode | null> {
  let query =
    "SELECT * FROM email_verification_codes WHERE purpose = ? AND email = ? AND consumed_at IS NULL AND expires_at > ?";
  const bindings: Array<string | number> = [purpose, email, nowSeconds()];
  if (userId) {
    query += " AND user_id = ?";
    bindings.push(userId);
  }
  query += " ORDER BY created_at DESC LIMIT 1";
  return db
    .prepare(query)
    .bind(...bindings)
    .first<EmailCode>();
}

async function upsertOAuthGrant(
  db: D1Database,
  grant: { userId: string; clientId: string; scope: string; redirectUri: string }
): Promise<void> {
  const existing = await db
    .prepare("SELECT id FROM oauth_grants WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL")
    .bind(grant.userId, grant.clientId)
    .first<{ id: string }>();
  const nowIso = new Date().toISOString();
  const scope = normalizeScopes(grant.scope).join(" ");
  if (existing) {
    await db.prepare("UPDATE oauth_grants SET scope = ?, last_redirect_uri = ?, updated_at = ? WHERE id = ?")
      .bind(scope, grant.redirectUri, nowIso, existing.id)
      .run();
    return;
  }

  await db.prepare(
    `INSERT INTO oauth_grants
      (id, user_id, client_id, scope, last_redirect_uri, granted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), grant.userId, grant.clientId, scope, grant.redirectUri, nowIso, nowIso)
    .run();
}

async function hasActiveOAuthGrant(
  db: D1Database,
  userId: string,
  clientId: string,
  requestedScope: string
): Promise<boolean> {
  const grant = await db
    .prepare("SELECT scope FROM oauth_grants WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL")
    .bind(userId, clientId)
    .first<{ scope: string }>();
  if (!grant) {
    return false;
  }

  const grantedScopes = new Set(normalizeScopes(grant.scope));
  return normalizeScopes(requestedScope).every((scope) => grantedScopes.has(scope));
}

async function touchOAuthGrant(
  db: D1Database,
  grant: { userId: string; clientId: string; redirectUri: string }
): Promise<void> {
  await db
    .prepare(
      "UPDATE oauth_grants SET last_redirect_uri = ?, updated_at = ? WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL"
    )
    .bind(grant.redirectUri, new Date().toISOString(), grant.userId, grant.clientId)
    .run();
}

async function markSessionClient(db: D1Database, sessionId: string, userId: string, clientId: string): Promise<void> {
  if (!clientId) return;
  await db.prepare("UPDATE sessions SET client_id = ? WHERE id = ? AND user_id = ?").bind(clientId, sessionId, userId).run();
}

async function checkEmailCodeRateLimit(
  db: D1Database,
  purpose: EmailPurpose,
  email: string,
  userId?: string
): Promise<string | null> {
  let query = "SELECT created_at FROM email_verification_codes WHERE purpose = ? AND email = ? AND created_at > ?";
  const bindings: Array<string | number> = [purpose, email, new Date(Date.now() - 60 * 60 * 1000).toISOString()];
  if (userId) {
    query += " AND user_id = ?";
    bindings.push(userId);
  }
  query += " ORDER BY created_at DESC";
  const { results } = await db.prepare(query).bind(...bindings).all<{ created_at: string }>();
  const latest = results[0]?.created_at ? Date.parse(results[0].created_at) : 0;
  if (latest && Date.now() - latest < emailCodeCooldownSeconds * 1000) {
    return "验证码发送太频繁，请稍后再试。";
  }
  if (results.length >= emailCodeHourlyLimit) {
    return "验证码请求次数过多，请一小时后再试。";
  }
  return null;
}

async function recordAuditEvent(
  c: {
    env: Bindings;
    req: {
      header: (name: string) => string | undefined;
    };
  },
  event: {
    actorType: "anonymous" | "user" | "admin";
    actorId?: string;
    eventType: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, event_type, target_type, target_id, ip, user_agent, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        event.actorType,
        event.actorId ?? null,
        event.eventType,
        event.targetType ?? null,
        event.targetId ?? null,
        c.req.header("cf-connecting-ip") ?? null,
        c.req.header("user-agent") ?? null,
        JSON.stringify(event.metadata ?? {}),
        new Date().toISOString()
      )
      .run();
  } catch (error) {
    console.error(JSON.stringify({ message: "audit event write failed", error: String(error), eventType: event.eventType }));
  }
}

async function hashEmailCode(code: string): Promise<string> {
  return hashPassword(code);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder().encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

async function verifyEmailCode(code: string, stored: string): Promise<boolean> {
  return verifyPassword(code, stored);
}

function normalizeEmail(email?: string): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeUsername(username?: string): string | null {
  const normalized = username?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function validatePassword(password?: string): string | null {
  if (!password || password.length < 6) {
    return "密码至少需要 6 位。";
  }
  if (password.length > 128) {
    return "密码不能超过 128 位。";
  }
  return null;
}

function normalizeCode(code?: string): string | null {
  const normalized = code?.replace(/\D/g, "");
  return normalized?.length === 6 ? normalized : null;
}

function normalizeClientId(clientId?: string): string | null {
  const normalized = clientId?.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9_-]{2,62}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeRedirectUris(uris?: string[]): string[] {
  const normalized = new Set<string>();
  for (const uri of uris ?? []) {
    try {
      const parsed = new URL(uri.trim());
      if (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        normalized.add(parsed.toString());
      }
    } catch {
      // 忽略无效回调地址
    }
  }
  return [...normalized];
}

function normalizeAllowedScopes(scopes?: string[]): string[] {
  const allowed = new Set(["openid", "profile", "email", "sub"]);
  const normalized = new Set(["openid"]);
  for (const scope of scopes ?? ["profile", "email"]) {
    if (allowed.has(scope)) {
      normalized.add(scope);
    }
  }
  return [...normalized];
}

function encodeRequestPath(path: string): string {
  return base64UrlEncode(textEncoder().encode(path));
}

function decodeRequestPath(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(value));
    if (!decoded.startsWith("/oauth/authorize?")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function createNumericCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0) % 1000000;
  return value.toString().padStart(6, "0");
}

function validateSmtpConfig(input: SmtpConfigInput, existingConfig?: SmtpConfig): SmtpConfig | { error: string } {
  const host = input.host?.trim();
  const port = Number(input.port);
  const secureMode = input.secureMode;
  const username = input.username?.trim();
  const password = input.password?.trim() || existingConfig?.password || "";
  const fromEmail = normalizeEmail(input.fromEmail);
  const fromName = input.fromName?.trim() || "统一登陆平台";
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return { error: "SMTP 主机或端口无效。" };
  }
  if (secureMode !== "ssl" && secureMode !== "starttls") {
    return { error: "请选择 SSL 或 STARTTLS。" };
  }
  if (!username || !password) {
    return { error: "SMTP 用户名和密码不能为空。" };
  }
  if (!fromEmail) {
    return { error: "发件邮箱无效。" };
  }
  return { host, port, secureMode, username, password, fromEmail, fromName };
}

function validateEmailDeliverySettings(
  input: SmtpConfigInput,
  provider: "resend" | "smtp"
): EmailDeliverySettings | { error: string } {
  const resendFromEmail = normalizeEmail(input.fromEmail) ?? "noreply@example.com";
  const resendFromName = input.fromName?.trim() || "统一登陆平台";
  return {
    provider,
    resendFromEmail,
    resendFromName
  };
}

async function saveEmailDeliverySettings(db: D1Database, settings: EmailDeliverySettings): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('email_delivery', ?, ?)")
    .bind(JSON.stringify(settings), new Date().toISOString())
    .run();
}

async function getEmailDeliverySettings(db: D1Database): Promise<EmailDeliverySettings> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'email_delivery'").first<{ value: string }>();
  if (!row) {
    return {
      provider: "resend",
      resendFromEmail: "noreply@example.com",
      resendFromName: "统一登陆平台"
    };
  }
  const value = safeJsonParse(row.value) as Partial<EmailDeliverySettings>;
  return {
    provider: value.provider === "smtp" ? "smtp" : "resend",
    resendFromEmail: normalizeEmail(value.resendFromEmail) ?? "noreply@example.com",
    resendFromName: value.resendFromName?.trim() || "统一登陆平台"
  };
}

async function getEmailDeliveryConfig(env: Bindings): Promise<EmailDeliveryConfig | null> {
  const settings = await getEmailDeliverySettings(env.DB);
  if (settings.provider === "resend") {
    if (!env.RESEND_API_KEY) {
      return null;
    }
    return {
      provider: "resend",
      apiKey: env.RESEND_API_KEY,
      fromEmail: settings.resendFromEmail,
      fromName: settings.resendFromName
    };
  }
  const smtpConfig = await getSmtpConfig(env.DB, env.OIDC_PRIVATE_JWK);
  return smtpConfig ? { provider: "smtp", ...smtpConfig } : null;
}

async function saveSmtpConfig(db: D1Database, privateJwk: string, config: SmtpConfig): Promise<void> {
  const value = {
    host: config.host,
    port: config.port,
    secureMode: config.secureMode,
    username: config.username,
    passwordEncrypted: await encryptSecret(privateJwk, config.password),
    fromEmail: config.fromEmail,
    fromName: config.fromName
  };
  await db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('smtp', ?, ?)")
    .bind(JSON.stringify(value), new Date().toISOString())
    .run();
}

async function getSmtpConfig(db: D1Database, privateJwk: string): Promise<SmtpConfig | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'smtp'").first<{ value: string }>();
  if (!row) {
    return null;
  }
  const value = JSON.parse(row.value) as Omit<SmtpConfig, "password"> & { passwordEncrypted: string };
  return {
    host: value.host,
    port: value.port,
    secureMode: value.secureMode,
    username: value.username,
    password: await decryptSecret(privateJwk, value.passwordEncrypted),
    fromEmail: value.fromEmail,
    fromName: value.fromName
  };
}

async function getPublicSmtpConfig(db: D1Database, privateJwk: string): Promise<Omit<SmtpConfig, "password"> | null> {
  const config = await getSmtpConfig(db, privateJwk);
  if (!config) {
    return null;
  }
  return {
    host: config.host,
    port: config.port,
    secureMode: config.secureMode,
    username: config.username,
    fromEmail: config.fromEmail,
    fromName: config.fromName
  };
}

async function encryptSecret(privateJwk: string, plainText: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(privateJwk);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, textEncoder().encode(plainText));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(encrypted))}`;
}

async function decryptSecret(privateJwk: string, encryptedText: string): Promise<string> {
  const [version, ivText, cipherText] = encryptedText.split(".");
  if (version !== "v1" || !ivText || !cipherText) {
    throw new Error("SMTP 密码密文格式无效。");
  }
  const key = await deriveAesKey(privateJwk);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(ivText)) },
    key,
    toArrayBuffer(base64UrlDecode(cipherText))
  );
  return new TextDecoder().decode(decrypted);
}

async function deriveAesKey(privateJwk: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder().encode(privateJwk));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sendVerificationEmail(
  config: EmailDeliveryConfig,
  toEmail: string,
  code: string,
  subject: string
): Promise<{ id?: string }> {
  const html = verificationEmailHtml(code, subject, config.fromName, toEmail);
  const text = `${toEmail.split("@")[0]}，您好：\\n\\n您的验证码是：${code}\\n\\n验证码将在 10 分钟后失效。如果不是您本人操作，请忽略此邮件。\\n\\n${config.fromName}`;
  if (config.provider === "resend") {
    return sendResendMail(config, {
      to: toEmail,
      subject,
      text,
      html
    });
  }
  await sendSmtpMail(config, {
    to: toEmail,
    subject,
    text,
    html
  });
  return { id: "smtp" };
}

function verificationEmailHtml(code: string, subject: string, siteName: string, toEmail: string): string {
  const safeCode = escapeEmailHtml(code);
  const safeSubject = escapeEmailHtml(subject.replace("验证码", "") || "邮箱");
  const safeSiteName = escapeEmailHtml(siteName || "统一登陆平台");
  const recipientName = escapeEmailHtml(toEmail.split("@")[0] || "用户");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>统一登陆平台验证码</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f7f7;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f1f7f7;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 18px 52px rgba(15,35,70,0.14);">
            <tr>
              <td style="padding:28px 32px;background:#0f9f9a;color:#ffffff;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="width:56px;vertical-align:middle;">
                      <div style="width:48px;height:48px;border-radius:14px;background:#ecfffd;color:#087f7b;font-size:16px;line-height:48px;text-align:center;font-weight:900;">SSO</div>
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:13px;line-height:1.4;color:#dff4f2;font-weight:700;">${safeSiteName}</div>
                      <h1 style="margin:2px 0 0;font-size:24px;line-height:1.25;color:#ffffff;font-weight:800;">邮箱验证码</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 10px;font-size:15px;line-height:1.8;color:#334155;">
                <p style="margin:0 0 14px;">${recipientName}，您好：</p>
                <p style="margin:0;">您正在进行 <strong style="color:#111827;">${safeSubject}验证</strong>，请使用以下验证码继续操作。</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 24px;">
                <div style="box-sizing:border-box;width:100%;padding:24px 18px;border:1px solid #b9e7e4;border-radius:12px;background:#edfafa;color:#087f7b;font-size:34px;line-height:1.2;font-weight:800;letter-spacing:8px;text-align:center;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">${safeCode}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;font-size:14px;line-height:1.8;color:#64748b;">
                <p style="margin:0 0 8px;">验证码将在 <strong style="color:#111827;">10</strong> 分钟后失效。</p>
                <p style="margin:0;">如果不是您本人操作，请忽略此邮件，您的账号不会受到影响。</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#f8fbfb;border-top:1px solid #e8eef3;color:#94a3b8;font-size:12px;line-height:1.7;">
                This email was sent by ${safeSiteName}. Please do not reply directly.<br>
                <span style="color:#0f9f9a;">${safeSiteName}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeEmailHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function sendResendMail(
  config: Extract<EmailDeliveryConfig, { provider: "resend" }>,
  message: { to: string; subject: string; text: string; html: string }
): Promise<{ id?: string }> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: encodeMailAddress(config.fromName, config.fromEmail),
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend 返回异常：${response.status} ${detail}`);
  }
  const result = (await response.json().catch(() => ({}))) as { id?: string };
  return { id: result.id };
}

async function sendSmtpMail(
  config: SmtpConfig,
  message: { to: string; subject: string; text: string; html: string }
): Promise<void> {
  let socket: Socket | null = null;
  try {
    socket = connect(
      { hostname: config.host, port: config.port },
      { secureTransport: config.secureMode === "ssl" ? "on" : "starttls", allowHalfOpen: false }
    );
    await socket.opened;
    let transport = smtpTransport(socket);

    const helloName = config.fromEmail.split("@")[1] || config.host;
    await transport.expect([220], "SMTP greeting");
    await transport.command(`EHLO ${helloName}`, [250], "SMTP EHLO");
    if (config.secureMode === "starttls") {
      await transport.command("STARTTLS", [220], "SMTP STARTTLS");
      socket = socket.startTls({ expectedServerHostname: config.host });
      await socket.opened;
      transport = smtpTransport(socket);
      await transport.command(`EHLO ${helloName}`, [250], "SMTP EHLO after STARTTLS");
    }
    await transport.command("AUTH LOGIN", [334], "SMTP AUTH LOGIN");
    await transport.command(btoa(config.username), [334], "SMTP username");
    await transport.command(btoa(config.password), [235], "SMTP password");
    await transport.command(`MAIL FROM:<${config.fromEmail}>`, [250], "SMTP MAIL FROM");
    await transport.command(`RCPT TO:<${message.to}>`, [250, 251], "SMTP RCPT TO");
    await transport.command("DATA", [354], "SMTP DATA");
    await transport.write(buildMimeMessage(config, message));
    await transport.expect([250], "SMTP message body");
    await transport.command("QUIT", [221], "SMTP QUIT");
  } finally {
    await socket?.close().catch(() => undefined);
  }
}

function smtpTransport(socket: Socket): {
  command: (line: string, expected: number[], label?: string) => Promise<void>;
  expect: (expected: number[], label?: string) => Promise<string[]>;
  write: (data: string) => Promise<void>;
} {
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = textEncoder();
  let buffer = "";

  async function readLine(): Promise<string> {
    while (!buffer.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) {
        throw new Error("SMTP 连接已关闭。");
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    const lineEnd = buffer.indexOf("\n");
    const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    return line;
  }

  async function expect(expected: number[], label = "SMTP"): Promise<string[]> {
    const lines: string[] = [];
    let code = 0;
    for (;;) {
      const line = await readLine();
      lines.push(line);
      code = Number(line.slice(0, 3));
      if (line[3] !== "-") {
        break;
      }
    }
    if (!expected.includes(code)) {
      throw new Error(`${label} 返回异常：${lines.join(" | ")}`);
    }
    return lines;
  }

  async function write(data: string): Promise<void> {
    await writer.write(encoder.encode(data));
  }

  async function command(line: string, expected: number[], label?: string): Promise<void> {
    await write(`${line}\r\n`);
    await expect(expected, label ?? `SMTP ${line.split(" ")[0]}`);
  }

  return { command, expect, write };
}

function buildMimeMessage(
  config: SmtpConfig,
  message: { to: string; subject: string; text: string; html: string }
): string {
  const boundary = `sso-${crypto.randomUUID()}`;
  const headers = [
    `From: ${encodeMailAddress(config.fromName, config.fromEmail)}`,
    `To: <${message.to}>`,
    `Subject: ${encodeMimeWord(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    escapeSmtpData(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    escapeSmtpData(message.html),
    `--${boundary}--`
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body.join("\r\n")}\r\n.\r\n`;
}

function encodeMailAddress(name: string, email: string): string {
  return `${encodeMimeWord(name)} <${email}>`;
}

function encodeMimeWord(value: string): string {
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

function escapeSmtpData(value: string): string {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", textEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256
  );
  return `pbkdf2$100000$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, hashText] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !saltText || !hashText) {
    return false;
  }
  const salt = toArrayBuffer(base64UrlDecode(saltText));
  const key = await crypto.subtle.importKey("raw", textEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iterationsText) },
    key,
    256
  );
  return timingSafeEqualBytes(new Uint8Array(bits), base64UrlDecode(hashText));
}

async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder().encode(verifier));
  return timingSafeEqualText(base64UrlEncode(new Uint8Array(digest)), challenge);
}

async function timingSafeEqualText(left: string, right: string): Promise<boolean> {
  return timingSafeEqualBytes(textEncoder().encode(left), textEncoder().encode(right));
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function createToken(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function parsePrivateJwk(raw: string): JWK {
  const jwk = JSON.parse(raw) as JWK;
  if (!jwk.kid) {
    jwk.kid = "default";
  }
  return jwk;
}

function toPublicJwk(privateJwk: JWK): JWK {
  const { d: _privateExponent, ...publicJwk } = privateJwk;
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  return publicJwk;
}

function normalizeScopes(scope: string): string[] {
  return [...new Set(scope.split(" ").map((item) => item.trim()).filter(Boolean))];
}

function parseClientAuthentication(
  authorizationHeader: string | undefined,
  body: TokenRequestBody
):
  | ClientAuthentication
  | { error: "invalid_request" | "invalid_client"; description: string; status: 400 | 401 } {
  const bodyClientId = String(body.client_id ?? "");
  const bodyClientSecret = body.client_secret ? String(body.client_secret) : "";
  const basicAuth = parseBasicClientAuthentication(authorizationHeader);

  if ("error" in basicAuth) {
    return basicAuth;
  }
  if (basicAuth.clientId) {
    if (bodyClientId && bodyClientId !== basicAuth.clientId) {
      return {
        error: "invalid_request",
        description: "Basic 认证与请求体中的 client_id 不一致。",
        status: 400
      };
    }
    return {
      method: "client_secret_basic",
      clientId: basicAuth.clientId,
      clientSecret: basicAuth.clientSecret
    };
  }

  return {
    method: bodyClientSecret ? "client_secret_post" : "none",
    clientId: bodyClientId,
    clientSecret: bodyClientSecret
  };
}

async function authenticateOAuthClient(
  c: AppContext,
  clientAuth: ClientAuthentication
): Promise<{ client: Client } | { response: Response }> {
  const client = await getClient(c.env.DB, clientAuth.clientId);
  if (!client || !client.is_active) {
    return { response: oauthError(c, "invalid_client", "客户端不存在或已禁用。", 401) };
  }
  if (client.secret_hash) {
    if (!clientAuth.clientSecret || !(await verifyPassword(clientAuth.clientSecret, client.secret_hash))) {
      return { response: oauthError(c, "invalid_client", "客户端密钥错误。", 401) };
    }
  } else if (clientAuth.method !== "none") {
    return { response: oauthError(c, "invalid_client", "公共客户端不应提交 client secret。", 401) };
  }
  return { client };
}

async function revokeOAuthToken(db: D1Database, env: Bindings, token: string, clientId: string): Promise<void> {
  const tokenHash = await hashToken(token);
  const refreshToken = await db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .bind(tokenHash)
    .first<RefreshTokenRecord>();
  if (refreshToken?.client_id === clientId && !refreshToken.revoked_at) {
    await db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), refreshToken.id)
      .run();
    return;
  }

  const accessToken = await verifyAccessToken(env, token, clientId);
  if (!accessToken.active || !accessToken.sub || !accessToken.exp) {
    return;
  }
  await db.prepare(
    `INSERT OR REPLACE INTO revoked_access_tokens
      (token_hash, client_id, user_id, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?)`
  )
    .bind(tokenHash, clientId, accessToken.sub, accessToken.exp, new Date().toISOString())
    .run();
}

async function introspectOAuthToken(
  db: D1Database,
  env: Bindings,
  token: string,
  clientId: string
): Promise<Record<string, unknown>> {
  const accessToken = await verifyAccessToken(env, token, clientId);
  if (accessToken.active) {
    if (await isAccessTokenRevoked(db, token)) {
      return { active: false };
    }
    return accessToken;
  }

  const tokenHash = await hashToken(token);
  const refreshToken = await db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ?")
    .bind(tokenHash)
    .first<RefreshTokenRecord>();
  if (
    !refreshToken ||
    refreshToken.client_id !== clientId ||
    refreshToken.revoked_at ||
    refreshToken.expires_at < nowSeconds()
  ) {
    return { active: false };
  }
  return {
    active: true,
    client_id: refreshToken.client_id,
    sub: refreshToken.user_id,
    scope: refreshToken.scope,
    exp: refreshToken.expires_at,
    token_type: "refresh_token"
  };
}

async function verifyAccessToken(env: Bindings, token: string, clientId: string): Promise<Record<string, unknown>> {
  try {
    const privateJwk = parsePrivateJwk(env.OIDC_PRIVATE_JWK);
    const publicKey = await importJWK(toPublicJwk(privateJwk), "ES256");
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: normalizedIssuer(env.ISSUER),
      audience: clientId
    });
    return {
      active: true,
      client_id: clientId,
      sub: payload.sub,
      scope: payload.scope,
      exp: payload.exp,
      iat: payload.iat,
      token_type: "Bearer",
      email: payload.email,
      name: payload.name
    };
  } catch {
    return { active: false };
  }
}

async function isAccessTokenRevoked(db: D1Database, token: string): Promise<boolean> {
  const tokenHash = await hashToken(token);
  const revoked = await db.prepare("SELECT token_hash FROM revoked_access_tokens WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, nowSeconds())
    .first<RevokedAccessToken>();
  return Boolean(revoked);
}

function parseBasicClientAuthentication(
  authorizationHeader: string | undefined
): { clientId: string; clientSecret: string } | { error: "invalid_client"; description: string; status: 401 } {
  if (!authorizationHeader) {
    return { clientId: "", clientSecret: "" };
  }
  const [scheme, credentials] = authorizationHeader.split(" ");
  if (scheme !== "Basic") {
    return { clientId: "", clientSecret: "" };
  }
  try {
    const decoded = atob(credentials ?? "");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return { error: "invalid_client", description: "Basic 客户端认证格式无效。", status: 401 };
    }
    return {
      clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
      clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1))
    };
  } catch {
    return { error: "invalid_client", description: "Basic 客户端认证无法解析。", status: 401 };
  }
}

function normalizePrompt(prompt: string | null): Set<string> {
  const supported = new Set(["none", "login", "consent"]);
  return new Set(
    (prompt ?? "")
      .split(" ")
      .map((item) => item.trim())
      .filter((item) => supported.has(item))
  );
}

function createAuthorizeErrorRedirect(redirectUri: string, error: string, description: string, state: string): string {
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("error", error);
  redirectUrl.searchParams.set("error_description", description);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }
  return redirectUrl.toString();
}

function parseJsonArray(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

function getBearerToken(header?: string): string | null {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

function safeReturnTo(returnTo: string | undefined, issuer: string): string {
  const fallback = `${normalizedIssuer(issuer)}/dashboard`;
  const origin = normalizedIssuer(issuer);
  if (!returnTo) {
    return fallback;
  }
  if (returnTo.startsWith("/")) {
    return `${origin}${returnTo}`;
  }
  try {
    const parsed = new URL(returnTo);
    if (parsed.origin === origin) {
      return parsed.toString();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

async function safePostLogoutRedirect(
  db: D1Database,
  input: { clientId?: string; postLogoutRedirectUri?: string; issuer: string }
): Promise<string> {
  const fallback = normalizedIssuer(input.issuer);
  if (!input.clientId || !input.postLogoutRedirectUri) {
    return fallback;
  }
  const client = await getClient(db, input.clientId);
  if (!client) {
    return fallback;
  }

  try {
    const redirect = new URL(input.postLogoutRedirectUri);
    const allowedOrigins = parseJsonArray(client.redirect_uris).map((uri) => new URL(uri).origin);
    if (allowedOrigins.includes(redirect.origin)) {
      return redirect.toString();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function oauthError(_c: unknown, error: string, description: string, status: 400 | 401) {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

function oauthJson(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      pragma: "no-cache"
    }
  });
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizedIssuer(issuer: string): string {
  return issuer.replace(/\/$/, "");
}

function normalizedOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function withCors(c: { req: { header: (name: string) => string | undefined }; env: Bindings }, response: Response): Response {
  const origin = c.req.header("origin");
  if (origin && getAllowedCorsOrigins(c.env).includes(origin)) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("access-control-allow-credentials", "true");
    response.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
    response.headers.set("access-control-allow-headers", "content-type,authorization,x-bootstrap-token");
    response.headers.append("vary", "Origin");
  }
  return response;
}

function getAllowedCorsOrigins(env: Bindings): string[] {
  const origins = [normalizedOrigin(env.PAGES_ORIGIN)];
  for (const origin of env.EXTRA_CORS_ORIGINS?.split(",") ?? []) {
    const normalized = origin.trim().replace(/\/$/, "");
    if (normalized) {
      origins.push(normalized);
    }
  }
  return origins;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function cleanupExpiredData(env: Bindings): Promise<Record<string, number>> {
  const now = nowSeconds();
  const retentionIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM authorization_codes WHERE expires_at < ?").bind(now),
    env.DB.prepare(
      "DELETE FROM email_verification_codes WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)"
    ).bind(now, retentionIso),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(
      now,
      retentionIso
    )
  ]);
  return {
    authorizationCodes: results[0].meta.changes ?? 0,
    emailVerificationCodes: results[1].meta.changes ?? 0,
    sessions: results[2].meta.changes ?? 0,
    refreshTokens: results[3].meta.changes ?? 0
  };
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings): Promise<void> {
    const result = await cleanupExpiredData(env);
    console.log(JSON.stringify({ message: "expired auth data cleanup completed", result }));
  }
};
