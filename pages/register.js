const registerForm = document.querySelector("#register-form");
const registerMessage = document.querySelector("#register-message");
const sendCodeButton = document.querySelector("#send-code-button");
const loginLink = document.querySelector("#login-link");
const params = new URLSearchParams(window.location.search);
const configuredApiBase = window.OIDC_API_BASE ?? "";
const apiBase = configuredApiBase || window.location.origin;
const returnTo = params.get("return_to");
let sendCodeTimer = 0;

if (returnTo) {
  loginLink.href = `/login?return_to=${encodeURIComponent(returnTo)}`;
}

sendCodeButton?.addEventListener("click", async () => {
  registerMessage.textContent = "";
  const validationError = validateRegisterFields({ requirePassword: false, requireCode: false });
  if (validationError) {
    registerMessage.textContent = validationError;
    return;
  }
  const data = new FormData(registerForm);
  sendCodeButton.disabled = true;
  const response = await fetch(`${apiBase}/api/auth/email/start`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: data.get("username"),
      email: data.get("email")
    })
  });
  const result = await response.json();
  if (!response.ok) {
    sendCodeButton.disabled = false;
    registerMessage.textContent = result.error ?? "验证码发送失败。";
    return;
  }
  registerMessage.textContent = `验证码已发送到 ${data.get("email")}，请查看收件箱或垃圾邮件。转发邮箱可能会有延迟。`;
  startSendCodeCooldown(result.expiresIn ?? 60);
  registerForm.elements.code.focus();
});

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  registerMessage.textContent = "";
  const validationError = validateRegisterFields({ requirePassword: true, requireCode: true });
  if (validationError) {
    registerMessage.textContent = validationError;
    return;
  }
  const data = new FormData(registerForm);
  const submitButton = registerForm.querySelector("button[type='submit']");
  submitButton.disabled = true;

  const response = await fetch(`${apiBase}/api/auth/email/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: data.get("username"),
      password: data.get("password"),
      email: data.get("email"),
      code: data.get("code"),
      returnTo
    })
  });
  const result = await response.json();
  submitButton.disabled = false;

  if (!response.ok) {
    registerMessage.textContent = result.error ?? "注册失败。";
    return;
  }
  window.location.assign(result.redirectTo ?? "/dashboard");
});

function validateRegisterFields(options) {
  const username = registerForm.elements.username.value.trim();
  const email = registerForm.elements.email.value.trim();
  const password = registerForm.elements.password.value;
  const confirmPassword = registerForm.elements.confirmPassword.value;
  const code = registerForm.elements.code.value.trim();
  const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
  if (!usernamePattern.test(username)) {
    registerForm.elements.username.focus();
    return "用户名需为 3-32 位字母、数字、下划线或短横线，且必须以字母或数字开头。";
  }
  if (!registerForm.elements.email.validity.valid) {
    registerForm.elements.email.focus();
    return "请输入有效邮箱地址。";
  }
  if (options.requirePassword && password.length < 6) {
    registerForm.elements.password.focus();
    return "密码至少需要 6 位。";
  }
  if (options.requirePassword && password !== confirmPassword) {
    registerForm.elements.confirmPassword.focus();
    return "两次输入的密码不一致。";
  }
  if (options.requireCode && !/^[0-9]{6}$/.test(code)) {
    registerForm.elements.code.focus();
    return "请输入 6 位数字验证码。";
  }
  return "";
}

function startSendCodeCooldown(seconds) {
  window.clearInterval(sendCodeTimer);
  let remaining = Math.min(Number(seconds) || 60, 60);
  sendCodeButton.textContent = `${remaining} 秒后重发`;
  sendCodeTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      window.clearInterval(sendCodeTimer);
      sendCodeButton.disabled = false;
      sendCodeButton.textContent = "发送验证码";
      return;
    }
    sendCodeButton.textContent = `${remaining} 秒后重发`;
  }, 1000);
}
