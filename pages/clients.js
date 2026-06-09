import { apiBase, escapeHtml, hydrateTokenInput, requireAdmin, saveAdminToken } from "./admin.js";

const tokenForm = document.querySelector("#token-form");
const clientForm = document.querySelector("#client-form");
const message = document.querySelector("#message");
const clientsList = document.querySelector("#clients-list");
const secretPanel = document.querySelector("#secret-panel");
const clientSecret = document.querySelector("#client-secret");
const metadataPanel = document.querySelector("#metadata-panel");
let adminToken = tokenForm?.elements?.token?.value ?? "";

await requireAdmin();
hydrateTokenInput(tokenForm);
adminToken = tokenForm?.elements?.token?.value ?? "";

tokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = saveAdminToken(new FormData(tokenForm).get("token"));
  await loadAdminData();
  clientForm.hidden = false;
});

clientsList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const clientId = button.dataset.clientId;
  const action = button.dataset.action;
  button.disabled = true;
  message.textContent = "";
  secretPanel.hidden = true;

  if (action === "toggle") {
    await fetch(`${apiBase}/api/admin/clients/${encodeURIComponent(clientId)}/status`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-bootstrap-token": adminToken
      },
      body: JSON.stringify({ active: button.dataset.active !== "true" })
    });
    await loadClients();
  }

  if (action === "rotate-secret") {
    const response = await fetch(`${apiBase}/api/admin/clients/${encodeURIComponent(clientId)}/secret/rotate`, {
      method: "POST",
      credentials: "include",
      headers: { "x-bootstrap-token": adminToken }
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error ?? "轮换密钥失败。";
      button.disabled = false;
      return;
    }
    clientSecret.textContent = result.clientSecret;
    secretPanel.hidden = false;
    message.textContent = "client secret 已轮换，请立即保存新密钥。";
    await loadClients();
  }
});

clientsList?.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-client-id]");
  if (!form) {
    return;
  }
  event.preventDefault();
  message.textContent = "";
  secretPanel.hidden = true;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  const data = new FormData(form);
  const clientId = form.dataset.clientId;
  const response = await fetch(`${apiBase}/api/admin/clients/${encodeURIComponent(clientId)}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": adminToken
    },
    body: JSON.stringify({
      name: data.get("name"),
      redirectUris: splitLines(data.get("redirectUris")),
      allowedScopes: splitWords(data.get("allowedScopes"))
    })
  });
  const result = await response.json();
  button.disabled = false;
  if (!response.ok) {
    message.textContent = result.error ?? "保存应用失败。";
    return;
  }
  message.textContent = "应用配置已保存。";
  await loadClients();
});

clientForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  secretPanel.hidden = true;
  const data = new FormData(clientForm);
  const response = await fetch(`${apiBase}/api/admin/clients`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": adminToken
    },
    body: JSON.stringify({
      id: data.get("id"),
      name: data.get("name"),
      redirectUris: splitLines(data.get("redirectUris")),
      allowedScopes: splitWords(data.get("allowedScopes")),
      confidential: data.get("confidential") === "on"
    })
  });
  const result = await response.json();
  if (!response.ok) {
    message.textContent = result.error ?? "创建失败。";
    return;
  }
  if (result.clientSecret) {
    clientSecret.textContent = result.clientSecret;
    secretPanel.hidden = false;
  }
  message.textContent = "应用已创建。";
  clientForm.reset();
  clientForm.elements.allowedScopes.value = "openid profile email";
  clientForm.elements.confidential.checked = true;
  await loadClients();
});

async function loadAdminData() {
  await Promise.all([loadMetadata(), loadClients()]);
}

async function loadMetadata() {
  const response = await fetch(`${apiBase}/api/admin/oidc-metadata`, {
    credentials: "include",
    headers: { "x-bootstrap-token": adminToken }
  });
  const result = await response.json();
  if (!response.ok) {
    metadataPanel.hidden = true;
    message.textContent = result.error ?? "读取 OIDC 元数据失败。";
    return;
  }
  const labels = {
    issuer: "Issuer",
    discoveryEndpoint: "Discovery",
    authorizationEndpoint: "Authorize",
    tokenEndpoint: "Token",
    userinfoEndpoint: "UserInfo",
    logoutEndpoint: "Logout",
    jwksEndpoint: "JWKS",
    grantTypes: "Grant Types",
    prompts: "Prompt Values"
  };
  for (const [field, label] of Object.entries(labels)) {
    const item = metadataPanel.querySelector(`[data-field="${field}"]`);
    const value = Array.isArray(result[field]) ? result[field].join(" ") : result[field];
    item.textContent = `${label}: ${value}`;
  }
  metadataPanel.hidden = false;
}

async function loadClients() {
  const response = await fetch(`${apiBase}/api/admin/clients`, {
    credentials: "include",
    headers: { "x-bootstrap-token": adminToken }
  });
  const result = await response.json();
  if (!response.ok) {
    clientsList.innerHTML = "";
    message.textContent = result.error ?? "读取失败。";
    return;
  }
  message.textContent = "";
  clientsList.innerHTML = result.clients
    .map(
      (client) => `
        <article class="client-item">
          <form data-client-id="${escapeHtml(client.id)}">
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              <code>client_id: ${escapeHtml(client.id)}</code>
            </div>
            <label>
              应用名称
              <input name="name" value="${escapeHtml(client.name)}" required />
            </label>
            <label>
              回调地址
              <textarea name="redirectUris" required>${escapeHtml(client.redirectUris.join("\n"))}</textarea>
            </label>
            <label>
              Scope
              <input name="allowedScopes" value="${escapeHtml(client.allowedScopes.join(" "))}" required />
            </label>
            <button type="submit">保存应用配置</button>
          </form>
          <p>${client.active ? "已启用" : "已停用"} · ${client.confidential ? "Confidential" : "Public"}</p>
          <div class="actions">
            <button type="button" data-action="toggle" data-client-id="${escapeHtml(client.id)}" data-active="${client.active}">
              ${client.active ? "停用应用" : "启用应用"}
            </button>
            <button type="button" data-action="rotate-secret" data-client-id="${escapeHtml(client.id)}">轮换密钥</button>
          </div>
        </article>
      `
    )
    .join("");
}

await loadAdminData();
clientForm.hidden = false;

function splitLines(value) {
  return String(value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitWords(value) {
  return String(value ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
