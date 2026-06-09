const userText = document.querySelector("#user-text");
const clientDetail = document.querySelector("#client-detail");
const message = document.querySelector("#message");
const allowButton = document.querySelector("#allow-button");
const denyButton = document.querySelector("#deny-button");
const params = new URLSearchParams(window.location.search);
const request = params.get("request");
const configuredApiBase = window.OIDC_API_BASE ?? "";
const apiBase = configuredApiBase || window.location.origin;

async function loadContext() {
  const response = await fetch(`${apiBase}/api/oauth/authorize/context?request=${encodeURIComponent(request ?? "")}`, {
    credentials: "include"
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      window.location.assign(`/login?return_to=${encodeURIComponent(`/authorize?request=${request}`)}`);
      return;
    }
    message.textContent = result.error ?? "授权请求无效。";
    allowButton.disabled = true;
    denyButton.disabled = true;
    return;
  }

  userText.textContent = `当前账号：${result.user?.email ?? "未知账号"}`;
  clientDetail.innerHTML = `
    <div class="consent-summary">
      <strong>${escapeHtml(result.client.name)}</strong>
      <span>正在请求访问你的账号</span>
    </div>
    <dl class="consent-fields">
      <div><dt>Client ID</dt><dd>${escapeHtml(result.client.id)}</dd></div>
      <div><dt>回调地址</dt><dd>${escapeHtml(result.client.redirectUri)}</dd></div>
      <div><dt>权限范围</dt><dd class="scope-pills">${result.client.scopes.map((scope) => `<span>${escapeHtml(scope)}</span>`).join("")}</dd></div>
    </dl>
  `;
}

allowButton?.addEventListener("click", async () => {
  await submitDecision("/api/oauth/authorize/confirm");
});

denyButton?.addEventListener("click", async () => {
  await submitDecision("/api/oauth/authorize/deny");
});

async function submitDecision(endpoint) {
  message.textContent = "";
  allowButton.disabled = true;
  denyButton.disabled = true;
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request })
  });
  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error ?? "操作失败。";
    allowButton.disabled = false;
    denyButton.disabled = false;
    return;
  }
  window.location.assign(result.redirectTo);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await loadContext();
