const profileText = document.querySelector("#profile-text");
const form = document.querySelector("#bind-form");
const message = document.querySelector("#message");
const codeField = document.querySelector(".code-field");
const submitButton = document.querySelector("#submit-button");
const logoutButton = document.querySelector("#logout-button");
const grantsList = document.querySelector("#grants-list");
const sessionsList = document.querySelector("#sessions-list");
const configuredApiBase = window.OIDC_API_BASE ?? "";
const apiBase = configuredApiBase || window.location.origin;
let codeSent = false;

async function loadProfile() {
  const response = await fetch(`${apiBase}/api/me`, { credentials: "include" });
  const result = await response.json();
  if (!result.authenticated) {
    window.location.assign(`/login?return_to=${encodeURIComponent("/account.html")}`);
    return;
  }
  profileText.textContent = `当前邮箱：${result.user.email}`;
  await Promise.all([loadGrants(), loadSessions()]);
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  submitButton.disabled = true;

  const data = new FormData(form);
  const endpoint = codeSent ? "/api/account/email/verify" : "/api/account/email/start";
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: data.get("email"),
      code: data.get("code")
    })
  });
  submitButton.disabled = false;

  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error ?? "操作失败。";
    return;
  }

  if (!codeSent) {
    codeSent = true;
    codeField.hidden = false;
    submitButton.textContent = "验证并绑定";
    message.textContent = "验证码已发送，请查看邮箱。";
    form.elements.code.focus();
    return;
  }

  message.textContent = "邮箱已绑定。";
  codeSent = false;
  codeField.hidden = true;
  submitButton.textContent = "发送绑定验证码";
  form.reset();
  await loadProfile();
});

logoutButton?.addEventListener("click", () => {
  window.location.assign(`${apiBase}/oauth/logout`);
});

grantsList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-grant-id]");
  if (!button) {
    return;
  }
  button.disabled = true;
  message.textContent = "";
  const response = await fetch(`${apiBase}/api/account/grants/${encodeURIComponent(button.dataset.grantId)}/revoke`, {
    method: "POST",
    credentials: "include"
  });
  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error ?? "撤销授权失败。";
    button.disabled = false;
    return;
  }
  message.textContent = "授权已撤销。";
  await loadGrants();
});

sessionsList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-session-id]");
  if (!button) {
    return;
  }
  button.disabled = true;
  message.textContent = "";
  const response = await fetch(`${apiBase}/api/account/sessions/${encodeURIComponent(button.dataset.sessionId)}/revoke`, {
    method: "POST",
    credentials: "include"
  });
  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error ?? "注销会话失败。";
    button.disabled = false;
    return;
  }
  message.textContent = "会话已注销。";
  await loadSessions();
});

async function loadGrants() {
  const response = await fetch(`${apiBase}/api/account/grants`, { credentials: "include" });
  const result = await response.json();
  if (!response.ok) {
    grantsList.innerHTML = `<article class="client-item"><p>${escapeHtml(result.error ?? "授权列表读取失败。")}</p></article>`;
    return;
  }
  if (result.grants.length === 0) {
    grantsList.innerHTML = '<article class="client-item"><p>还没有授权过其他应用。</p></article>';
    return;
  }
  grantsList.innerHTML = result.grants.map(renderGrant).join("");
}

async function loadSessions() {
  const response = await fetch(`${apiBase}/api/account/sessions`, { credentials: "include" });
  const result = await response.json();
  if (!response.ok) {
    sessionsList.innerHTML = `<article class="client-item"><p>${escapeHtml(result.error ?? "会话列表读取失败。")}</p></article>`;
    return;
  }
  if (result.sessions.length === 0) {
    sessionsList.innerHTML = '<article class="client-item"><p>没有有效会话。</p></article>';
    return;
  }
  sessionsList.innerHTML = result.sessions.map(renderSession).join("");
}

function renderGrant(grant) {
  return `
    <article class="client-item">
      <div>
        <strong>${escapeHtml(grant.clientName)}</strong>
        <code>client_id: ${escapeHtml(grant.clientId)}</code>
      </div>
      <p>权限范围：${escapeHtml(grant.scopes.join(" "))}</p>
      <p>最近授权：${escapeHtml(grant.updatedAt)}</p>
      <code>回调地址：${escapeHtml(grant.lastRedirectUri)}</code>
      <div class="actions">
        <button type="button" data-grant-id="${escapeHtml(grant.id)}">撤销授权</button>
      </div>
    </article>
  `;
}

function renderSession(session) {
  return `
    <article class="client-item">
      <div>
        <strong>${session.current ? "当前会话" : "其他会话"}</strong>
        <code>${escapeHtml(session.ip ?? "未知 IP")}</code>
      </div>
      <p>${escapeHtml(compactUserAgent(session.userAgent))}</p>
      <p>最近活动：${escapeHtml(session.lastSeenAt ?? session.createdAt)}</p>
      <p>过期时间：${escapeHtml(formatExpiresAt(session.expiresAt))}</p>
      ${
        session.current
          ? ""
          : `<div class="actions"><button type="button" data-session-id="${escapeHtml(session.id)}">注销会话</button></div>`
      }
    </article>
  `;
}

function compactUserAgent(userAgent) {
  if (!userAgent) {
    return "未知浏览器";
  }
  return userAgent.length > 120 ? `${userAgent.slice(0, 117)}...` : userAgent;
}

function formatExpiresAt(expiresAt) {
  return new Date(Number(expiresAt) * 1000).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await loadProfile();
