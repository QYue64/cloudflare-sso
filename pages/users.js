import { apiBase, escapeHtml, hydrateTokenInput, requireAdmin, saveAdminToken } from "./admin.js";

const tokenForm = document.querySelector("#token-form");
const message = document.querySelector("#message");
const usersList = document.querySelector("#users-list");
let adminToken = "";

await requireAdmin();
hydrateTokenInput(tokenForm);

tokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = saveAdminToken(new FormData(tokenForm).get("token"));
  await loadUsers();
});

usersList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const userId = button.dataset.userId;
  const action = button.dataset.action;
  if (action === "toggle") {
    await fetch(`${apiBase}/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-bootstrap-token": adminToken
      },
      body: JSON.stringify({ active: button.dataset.active !== "true" })
    });
  }
  if (action === "revoke") {
    await fetch(`${apiBase}/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: "POST",
      credentials: "include",
      headers: { "x-bootstrap-token": adminToken }
    });
  }
  await loadUsers();
});

async function loadUsers() {
  const response = await fetch(`${apiBase}/api/admin/users`, {
    credentials: "include",
    headers: { "x-bootstrap-token": adminToken }
  });
  const result = await response.json();
  if (!response.ok) {
    usersList.innerHTML = "";
    message.textContent = result.error ?? "读取失败。";
    return;
  }
  message.textContent = "";
  usersList.innerHTML = result.users
    .map(
      (user) => `
        <article class="client-item">
          <div>
            <strong>${escapeHtml(user.displayName)}</strong>
            <code>${escapeHtml(user.username ?? "-")} · ${escapeHtml(user.email)}</code>
          </div>
          <p>${user.active ? "已启用" : "已停用"} · ${user.admin ? "管理员" : "普通用户"} · ${user.emailVerified ? "邮箱已验证" : "邮箱未验证"} · ${user.sessionCount} 个有效会话</p>
          <div class="actions">
            <button type="button" data-action="toggle" data-user-id="${escapeHtml(user.id)}" data-active="${user.active}">
              ${user.active ? "停用账号" : "启用账号"}
            </button>
            <button type="button" data-action="revoke" data-user-id="${escapeHtml(user.id)}">注销会话</button>
          </div>
        </article>
      `
    )
    .join("");
}

adminToken = tokenForm?.elements?.token?.value ?? "";
await loadUsers();
