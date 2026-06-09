import { apiBase, hydrateTokenInput, requireAdmin, saveAdminToken } from "./admin.js";

const form = document.querySelector("#smtp-form");
const message = document.querySelector("#message");
const testButton = document.querySelector("#test-button");

await requireAdmin();
hydrateTokenInput(form);

form?.elements?.token?.addEventListener("change", async () => {
  await loadSmtpConfig(saveAdminToken(form.elements.token.value));
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const data = new FormData(form);
  const token = saveAdminToken(data.get("token"));

  const response = await fetch(`${apiBase}/api/admin/smtp`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": token
    },
    body: JSON.stringify({
      host: data.get("host"),
      port: Number(data.get("port")),
      secureMode: data.get("secureMode"),
      username: data.get("username"),
      password: data.get("password"),
      fromEmail: data.get("fromEmail"),
      fromName: data.get("fromName")
    })
  });

  const result = await response.json();
  message.textContent = response.ok ? "SMTP 设置已保存。" : result.error ?? "保存失败。";
  if (response.ok) {
    await loadSmtpConfig(token);
  }
});

testButton?.addEventListener("click", async () => {
  message.textContent = "";
  testButton.disabled = true;
  const data = new FormData(form);
  const token = saveAdminToken(data.get("token"));
  const response = await fetch(`${apiBase}/api/admin/smtp/test`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-token": token
    },
    body: JSON.stringify({
      testEmail: data.get("testEmail")
    })
  });
  testButton.disabled = false;

  const result = await response.json();
  message.textContent = response.ok ? "测试邮件已发送，请查看收件箱。" : result.error ?? "测试邮件发送失败。";
});

async function loadSmtpConfig(token) {
  if (!token) {
    return;
  }
  const response = await fetch(`${apiBase}/api/admin/smtp`, {
    credentials: "include",
    headers: { "x-bootstrap-token": token }
  });
  const result = await response.json();
  if (!response.ok || !result.smtp) {
    return;
  }
  form.elements.host.value = result.smtp.host ?? "";
  form.elements.port.value = result.smtp.port ?? 587;
  form.elements.secureMode.value = result.smtp.secureMode ?? "starttls";
  form.elements.username.value = result.smtp.username ?? "";
  form.elements.password.value = "";
  form.elements.fromEmail.value = result.smtp.fromEmail ?? "";
  form.elements.fromName.value = result.smtp.fromName ?? "统一登陆平台";
}

await loadSmtpConfig(form?.elements?.token?.value ?? "");
