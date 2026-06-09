const loginForm = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const registerLink = document.querySelector("#register-link");
const params = new URLSearchParams(window.location.search);
const configuredApiBase = window.OIDC_API_BASE ?? "";
const apiBase = configuredApiBase || window.location.origin;
const returnTo = params.get("return_to");

if (returnTo) {
  registerLink.href = `/register?return_to=${encodeURIComponent(returnTo)}`;
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  const data = new FormData(loginForm);
  const identifier = String(data.get("identifier") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!identifier) {
    loginForm.elements.identifier.focus();
    loginMessage.textContent = "请输入邮箱或用户名。";
    return;
  }
  if (!password) {
    loginForm.elements.password.focus();
    loginMessage.textContent = "请输入密码。";
    return;
  }
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;

  const response = await fetch(`${apiBase}/api/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier,
      password,
      returnTo
    })
  });
  const result = await response.json();
  submitButton.disabled = false;

  if (!response.ok) {
    loginMessage.textContent = result.error ?? "登录失败。";
    return;
  }
  window.location.assign(result.redirectTo ?? "/dashboard");
});
