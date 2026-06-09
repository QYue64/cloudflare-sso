import { apiBase, escapeHtml, hydrateTokenInput, requireAdmin, saveAdminToken } from "./admin.js";

const tokenForm = document.querySelector("#token-form");
const message = document.querySelector("#message");
const eventsList = document.querySelector("#events-list");

hydrateTokenInput(tokenForm);
await requireAdmin();

tokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = saveAdminToken(new FormData(tokenForm).get("token"));
  await loadAuditEvents(token);
});

async function loadAuditEvents(token) {
  const response = await fetch(`${apiBase}/api/admin/audit-events?limit=100`, {
    credentials: "include",
    headers: { "x-bootstrap-token": token }
  });
  const result = await response.json();
  if (!response.ok) {
    eventsList.innerHTML = "";
    message.textContent = result.error ?? "读取失败。";
    return;
  }
  message.textContent = "";
  eventsList.innerHTML = result.events.map(renderEvent).join("");
}

function renderEvent(event) {
  return `
    <article class="client-item">
      <div>
        <strong>${escapeHtml(event.eventType)}</strong>
        <code>${escapeHtml(event.createdAt)}</code>
      </div>
      <p>${escapeHtml(event.actorType)}${event.actorId ? ` · ${escapeHtml(event.actorId)}` : ""}</p>
      <p>${event.targetType ? escapeHtml(event.targetType) : "无目标"}${event.targetId ? ` · ${escapeHtml(event.targetId)}` : ""}</p>
      <code>${escapeHtml(JSON.stringify(event.metadata ?? {}))}</code>
    </article>
  `;
}

await loadAuditEvents(tokenForm?.elements?.token?.value ?? "");
