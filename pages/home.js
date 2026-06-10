const configuredApiBase = window.OIDC_API_BASE ?? "";
const apiBase = configuredApiBase || window.location.origin;

const dashboardLoading = document.querySelector("#dashboard-loading");
const dashboardApp = document.querySelector("#dashboard-app");
const viewRoot = document.querySelector("#view-root");
const viewTitle = document.querySelector("#view-title");
const subtitle = document.querySelector("#dashboard-subtitle");
const adminNav = document.querySelector("#admin-nav");
const adminBadge = document.querySelector("#admin-badge");
const logoutButton = document.querySelector("#logout-button");
const message = document.querySelector("#dashboard-message");
const consoleSidebar = document.querySelector(".console-sidebar");
const consoleBrand = document.querySelector(".console-brand");
const navItems = [...document.querySelectorAll("[data-view]")];
const userAvatar = document.querySelector("#user-avatar");
const userChipName = document.querySelector("#user-chip-name");
let mobileNavButton = null;
let mobileAccountPanel = null;
let toastTimer = null;

let currentUser = null;
let activeView = "dashboard";
let dashboardState = {
  grants: [],
  sessions: [],
  users: [],
  clients: [],
  selectedClientId: null,
  clientDetails: null,
  selectedUserId: null,
  userMode: null,
  modalMode: null,
  smtp: null
};

const viewLabels = {
  dashboard: ["仪表盘", "统一登陆平台运行概览。"],
  account: ["账号中心", "管理你的基础账号信息。"],
  grants: ["授权应用", "查看和撤销已授权的业务系统。"],
  sessions: ["登录会话", "查看并管理当前账号的有效会话。"],
  users: ["用户管理", "管理统一登陆平台账号和会话。"],
  clients: ["应用接入", "创建和维护接入统一登陆平台的 OIDC 应用。"],
  smtp: ["邮件设置", "配置验证码邮件发送服务。"],
  audit: ["审计日志", "查看登录、授权和后台操作记录。"]
};

const viewRoutes = {
  dashboard: "/dashboard",
  account: "/account",
  grants: "/grants",
  sessions: "/sessions",
  users: "/users",
  clients: "/clients",
  smtp: "/smtp",
  audit: "/audit"
};

const routeViews = Object.fromEntries(Object.entries(viewRoutes).map(([view, route]) => [route, view]));

if (!window.SSO_MOBILE_ACTIVE) {
  init().catch((error) => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    dashboardLoading.innerHTML = `
      <section class="console-panel loading-error">
        <h2>登录状态检查失败</h2>
        <p>${escapeHtml(error.message ?? "请求超时或服务暂不可用。")}</p>
        <div class="actions"><button type="button" id="retry-login-check">重新检查</button><a class="button-link secondary" href="/login?return_to=${encodeURIComponent(returnTo)}">去登录</a></div>
      </section>
    `;
    document.querySelector("#retry-login-check")?.addEventListener("click", () => window.location.reload());
  });
}

async function init() {
  const me = await fetchJsonWithTimeout(`${apiBase}/api/me`, { credentials: "include" });
  if (!me.authenticated) {
    redirectToLogin();
    return;
  }

  currentUser = me.user;
  dashboardLoading.hidden = true;
  dashboardApp.hidden = false;
  adminNav.hidden = !currentUser.isAdmin;
  adminBadge.hidden = !currentUser.isAdmin;
  subtitle.textContent = `欢迎回来，${currentUser.username ?? currentUser.displayName ?? currentUser.email}`;
  const displayName = currentUser.username ?? currentUser.displayName ?? currentUser.email;
  userChipName.textContent = displayName;
  userAvatar.textContent = displayName.slice(0, 1).toUpperCase();

  ensureMobileNavButton();
  bindEvents();
  await switchView(viewFromPath(window.location.pathname), { replace: true });
}

function bindEvents() {
  navItems.forEach((item) => {
    item.addEventListener("click", async (event) => {
      event.preventDefault();
      await switchView(item.dataset.view);
      closeMobileNav();
    });
  });

  mobileNavButton?.addEventListener("click", () => {
    const open = !consoleSidebar.classList.contains("mobile-open");
    consoleSidebar.classList.toggle("mobile-open", open);
    mobileNavButton.setAttribute("aria-expanded", String(open));
  });

  mobileAccountPanel?.querySelector("[data-mobile-logout]")?.addEventListener("click", () => {
    window.location.assign(`${apiBase}/oauth/logout`);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileNav();
  });

  logoutButton?.addEventListener("click", () => {
    window.location.assign(`${apiBase}/oauth/logout`);
  });

  viewRoot.addEventListener("click", (event) => {
    handleViewClick(event).catch(reportActionError);
  });
  viewRoot.addEventListener("submit", (event) => {
    handleViewSubmit(event).catch(reportActionError);
  });

  window.addEventListener("popstate", () => {
    switchView(viewFromPath(window.location.pathname), { history: false }).catch(reportActionError);
  });
}

function ensureMobileNavButton() {
  if (!consoleBrand || mobileNavButton) return;
  mobileNavButton = document.createElement("button");
  mobileNavButton.type = "button";
  mobileNavButton.className = "mobile-nav-toggle";
  mobileNavButton.setAttribute("aria-expanded", "false");
  mobileNavButton.setAttribute("aria-label", "打开导航菜单");
  mobileNavButton.textContent = "菜单";
  consoleBrand.append(mobileNavButton);

  const displayName = currentUser.username ?? currentUser.displayName ?? currentUser.email;
  mobileAccountPanel = document.createElement("div");
  mobileAccountPanel.className = "mobile-account-panel";
  mobileAccountPanel.innerHTML = `
    <div class="mobile-account-card">
      <span class="user-avatar">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</span>
      <span>
        <strong>${escapeHtml(displayName)}</strong>
        <small>${currentUser.isAdmin ? "管理员账号" : "普通账号"}</small>
      </span>
    </div>
    <button type="button" class="ghost-button" data-mobile-logout>退出登录</button>
  `;
  consoleSidebar.append(mobileAccountPanel);
}

function closeMobileNav() {
  consoleSidebar?.classList.remove("mobile-open");
  mobileNavButton?.setAttribute("aria-expanded", "false");
}

async function switchView(view, options = {}) {
  if (isAdminView(view) && !currentUser.isAdmin) {
    view = "dashboard";
    options = { ...options, replace: true };
  }
  activeView = view;
  updateRoute(view, options);
  dashboardState.modalMode = null;
  dashboardState.userMode = null;
  dashboardState.selectedUserId = null;
  setActiveNav(view);
  const [title, description] = viewLabels[view] ?? viewLabels.dashboard;
  viewTitle.textContent = title;
  subtitle.textContent = description;
  hideToast();
  viewRoot.innerHTML = `<section class="console-panel"><p>正在加载...</p></section>`;

  const renderers = {
    dashboard: renderDashboard,
    account: renderAccount,
    grants: renderGrantsView,
    sessions: renderSessionsView,
    users: renderUsersView,
    clients: renderClientsView,
    smtp: renderSmtpView,
    audit: renderAuditView
  };
  await renderers[view]();
}

function viewFromPath(pathname) {
  return routeViews[pathname] ?? "dashboard";
}

function updateRoute(view, options = {}) {
  if (options.history === false) return;
  const route = viewRoutes[view] ?? viewRoutes.dashboard;
  if (window.location.pathname === route) return;
  const nextUrl = route;
  if (options.replace) {
    window.history.replaceState({ view }, "", nextUrl);
    return;
  }
  window.history.pushState({ view }, "", nextUrl);
}

function setActiveNav(view) {
  navItems.forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle("active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });
}

function isAdminView(view) {
  return ["users", "clients", "smtp", "audit"].includes(view);
}

function redirectToLogin() {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(`/login?return_to=${encodeURIComponent(returnTo)}`);
}

async function renderDashboard() {
  await refreshAccountData();
  viewRoot.innerHTML = `
    <section class="metric-grid" aria-label="账号概览">
      ${metricCard("授权应用", String(dashboardState.grants.length), "已允许访问账号信息")}
      ${metricCard("有效会话", String(dashboardState.sessions.length), "当前仍保持登录状态")}
    </section>

    <section class="dashboard-stack">
      ${panel(
        "最近授权应用",
        "你允许使用账号信息的业务系统。",
        renderGrantTable(dashboardState.grants.slice(0, 5)),
        `<button class="panel-link button-plain" type="button" data-action="view" data-view-target="grants">全部授权</button>`
      )}
      ${panel(
        "登录会话",
        "检查当前账号的有效登录设备。",
        renderSessionTable(dashboardState.sessions.slice(0, 5)),
        `<button class="panel-link button-plain" type="button" data-action="view" data-view-target="sessions">管理会话</button>`
      )}
    </section>
  `;
}

function renderAccount() {
  const displayName = currentUser.displayName ?? currentUser.username ?? currentUser.email;
  viewRoot.innerHTML = `
    <section class="account-workspace">
      <div class="account-hero">
        <div class="account-avatar">${escapeHtml(displayName.slice(0, 1).toUpperCase())}</div>
        <div>
          <h2>${escapeHtml(displayName)}</h2>
          <p>${escapeHtml(currentUser.email)}</p>
        </div>
        <div class="account-badges">
          <span class="status-chip ${currentUser.emailVerified ? "ok" : "neutral"}">${currentUser.emailVerified ? "邮箱已验证" : "邮箱未验证"}</span>
          <span class="status-chip neutral">${currentUser.isAdmin ? "管理员" : "普通用户"}</span>
        </div>
      </div>

      <div class="account-grid">
        <section class="console-panel account-profile-panel">
          <div class="panel-heading">
            <div>
              <h2>基础资料</h2>
              <p>当前登录账号的账号信息。</p>
            </div>
          </div>
          <dl class="account-fields">
            <div><dt>用户名</dt><dd>${escapeHtml(currentUser.username ?? "-")}</dd></div>
            <div><dt>邮箱</dt><dd>${escapeHtml(currentUser.email)}</dd></div>
            <div><dt>邮箱验证</dt><dd>${currentUser.emailVerified ? "已验证" : "未验证"}</dd></div>
            <div><dt>账号角色</dt><dd>${currentUser.isAdmin ? "管理员" : "普通用户"}</dd></div>
          </dl>
        </section>

        <section class="console-panel account-actions-panel">
          <div class="panel-heading">
            <div>
              <h2>账号操作</h2>
              <p>敏感操作会在弹窗中确认。</p>
            </div>
          </div>
          <div class="account-action-list">
            <button type="button" data-action="open-password-modal">
              <span>
                <strong>修改密码</strong>
                <small>更新后注销其他设备和刷新令牌</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
            <button type="button" class="secondary-button" data-action="open-bind-email-modal">
              <span>
                <strong>绑定邮箱</strong>
                <small>更换邮箱需要验证码确认</small>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
      </div>
    </section>
    ${renderOperationModal()}
  `;
}

async function renderGrantsView() {
  await refreshGrants();
  viewRoot.innerHTML = panel("授权应用", "撤销后，对应业务系统需要重新授权。", renderGrantManageList(dashboardState.grants));
}

async function renderSessionsView() {
  await refreshSessions();
  viewRoot.innerHTML = panel("登录会话", "注销陌生或不再使用的设备会话。", renderSessionManageList(dashboardState.sessions));
}

async function renderUsersView() {
  const result = await fetchJsonWithTimeout(`${apiBase}/api/admin/users`, { credentials: "include" });
  dashboardState.users = result.users;
  renderUsersViewFromState();
}

async function renderClientsView() {
  const result = await fetchJsonWithTimeout(`${apiBase}/api/admin/clients`, { credentials: "include" });
  dashboardState.clients = result.clients;
  viewRoot.innerHTML = `
    ${panel(
      "应用列表",
      "维护已接入系统。",
      renderClientsList(result.clients),
      `<button type="button" data-action="open-client-modal">创建应用</button>`
    )}
    ${renderOperationModal()}
    ${renderClientDetailsModal()}
  `;
}

async function renderSmtpView() {
  let smtp = null;
  try {
    const result = await fetchJsonWithTimeout(`${apiBase}/api/admin/smtp`, { credentials: "include" });
    smtp = result;
  } catch {
    smtp = null;
  }
  dashboardState.smtp = smtp;
  viewRoot.innerHTML = `
    ${panel(
      "邮件设置",
      "验证码邮件可在 Resend API 和 SMTP 之间切换。",
      renderSmtpSummary(smtp),
      `<button type="button" data-action="open-smtp-modal">${smtp ? "编辑设置" : "配置邮件"}</button>`
    )}
    ${renderOperationModal()}
  `;
}

async function renderAuditView() {
  const result = await fetchJsonWithTimeout(`${apiBase}/api/admin/audit-events?limit=100`, { credentials: "include" });
  viewRoot.innerHTML = panel("审计日志", "查看验证码、登录、授权和后台变更。", renderAuditList(result.events));
}

async function refreshAccountData() {
  await Promise.allSettled([refreshGrants(), refreshSessions()]);
}

async function refreshGrants() {
  const result = await fetchJsonWithTimeout(`${apiBase}/api/account/grants`, { credentials: "include" });
  dashboardState.grants = result.grants;
}

async function refreshSessions() {
  const result = await fetchJsonWithTimeout(`${apiBase}/api/account/sessions`, { credentials: "include" });
  dashboardState.sessions = result.sessions;
}

async function handleViewClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  if (action === "view") {
    await switchView(button.dataset.viewTarget);
  }
  if (action === "revoke-grant") {
    await postJson(`/api/account/grants/${encodeURIComponent(button.dataset.grantId)}/revoke`);
    await switchView("grants");
  }
  if (action === "revoke-session") {
    await postJson(`/api/account/sessions/${encodeURIComponent(button.dataset.sessionId)}/revoke`);
    await switchView("sessions");
  }
  if (action === "open-password-modal") {
    dashboardState.modalMode = "password";
    renderAccount();
  }
  if (action === "open-bind-email-modal") {
    dashboardState.modalMode = "bind-email";
    renderAccount();
  }
  if (action === "open-client-modal") {
    dashboardState.modalMode = "client";
    dashboardState.selectedClientId = null;
    await renderClientsView();
  }
  if (action === "edit-client") {
    dashboardState.modalMode = "client";
    dashboardState.selectedClientId = button.dataset.clientId;
    await renderClientsView();
  }
  if (action === "view-client-details") {
    const client = dashboardState.clients.find((item) => item.id === button.dataset.clientId);
    if (!client) return;
    dashboardState.clientDetails = { client };
    await renderClientsView();
  }
  if (action === "close-client-details") {
    dashboardState.clientDetails = null;
    await renderClientsView();
  }
  if (action === "open-smtp-modal") {
    dashboardState.modalMode = "smtp";
    viewRoot.innerHTML = `
      ${panel(
        "邮件设置",
        "验证码邮件可在 Resend API 和 SMTP 之间切换。",
        renderSmtpSummary(dashboardState.smtp),
        `<button type="button" data-action="open-smtp-modal">${dashboardState.smtp ? "编辑设置" : "配置邮件"}</button>`
      )}
      ${renderOperationModal()}
    `;
  }
  if (action === "cancel-dialog") {
    dashboardState.modalMode = null;
    dashboardState.selectedClientId = null;
    dashboardState.clientDetails = null;
    if (activeView === "account") renderAccount();
    if (activeView === "clients") await renderClientsView();
    if (activeView === "smtp") await renderSmtpView();
  }
  if (action === "toggle-user") {
    await postJson(`/api/admin/users/${encodeURIComponent(button.dataset.userId)}/status`, {
      active: button.dataset.active !== "true"
    });
    await switchView("users");
  }
  if (action === "create-user") {
    dashboardState.selectedUserId = null;
    dashboardState.userMode = "create";
    renderUsersViewFromState();
  }
  if (action === "edit-user") {
    dashboardState.selectedUserId = button.dataset.userId;
    dashboardState.userMode = "edit";
    renderUsersViewFromState();
  }
  if (action === "reset-user-password") {
    dashboardState.selectedUserId = button.dataset.userId;
    dashboardState.userMode = "password";
    renderUsersViewFromState();
  }
  if (action === "cancel-user-action") {
    dashboardState.selectedUserId = null;
    dashboardState.userMode = null;
    renderUsersViewFromState();
  }
  if (action === "toggle-user-admin") {
    const user = dashboardState.users.find((item) => item.id === button.dataset.userId);
    if (!user) return;
    await postJson(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      admin: !user.admin,
      active: user.active
    });
    await switchView("users");
  }
  if (action === "delete-user") {
    const user = dashboardState.users.find((item) => item.id === button.dataset.userId);
    if (!user || !window.confirm(`确定删除用户 ${user.username ?? user.email}？此操作不可恢复。`)) return;
    await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/delete`);
    await switchView("users");
    showToast("用户已删除。");
  }
  if (action === "revoke-user-sessions") {
    await postJson(`/api/admin/users/${encodeURIComponent(button.dataset.userId)}/revoke-sessions`);
    await switchView("users");
  }
  if (action === "toggle-client") {
    await postJson(`/api/admin/clients/${encodeURIComponent(button.dataset.clientId)}/status`, {
      active: button.dataset.active !== "true"
    });
    await switchView("clients");
  }
  if (action === "rotate-secret") {
    const result = await postJson(`/api/admin/clients/${encodeURIComponent(button.dataset.clientId)}/secret/rotate`);
    const client = dashboardState.clients.find((item) => item.id === button.dataset.clientId);
    if (client) {
      dashboardState.clientDetails = { client: { ...client, secretRevealable: true }, clientSecret: result.clientSecret };
    }
    await renderClientsView();
    showToast("密钥已轮换，接入配置已更新。", "success", { sticky: true });
  }
  if (action === "reveal-client-secret") {
    const client = dashboardState.clientDetails?.client;
    if (!client) return;
    const result = await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/secret/reveal`);
    dashboardState.clientDetails = { client: { ...client, secretRevealable: true }, clientSecret: result.clientSecret };
    await renderClientsView();
    showToast("client secret 已显示。");
  }
  if (action === "delete-client") {
    const client = dashboardState.clients.find((item) => item.id === button.dataset.clientId);
    if (!client || !window.confirm(`确定删除应用 ${client.name}？已授权用户需要重新接入。`)) return;
    await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/delete`);
    await switchView("clients");
    showToast("应用已删除。");
  }
  if (action === "submit-client-form") {
    const form = button.closest("form");
    if (!form) return;
    hideToast();
    if (!form.reportValidity()) return;
    await submitClient(form);
  }
  if (action === "copy-config-value") {
    const value = button.dataset.copyValue ?? "";
    await navigator.clipboard.writeText(value);
    showToast("已复制。");
  }
  if (action === "smtp-test") {
    const form = document.querySelector("#smtp-form");
    if (!form) return;
    const data = new FormData(form);
    await postJson("/api/admin/smtp/test", { testEmail: data.get("testEmail") });
    showToast("测试邮件已发送，请查看收件箱。");
  }
}

viewRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement) || target.name !== "provider") return;
  if (dashboardState.modalMode !== "smtp") return;
  dashboardState.smtp = {
    ...(dashboardState.smtp ?? {}),
    provider: target.value
  };
  viewRoot.innerHTML = `
    ${panel(
      "邮件设置",
      "验证码邮件可在 Resend API 和 SMTP 之间切换。",
      renderSmtpSummary(dashboardState.smtp),
      `<button type="button" data-action="open-smtp-modal">${dashboardState.smtp ? "编辑设置" : "配置邮件"}</button>`
    )}
    ${renderOperationModal()}
  `;
});

viewRoot.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("button")) return;
  const configField = target.closest("[data-action='copy-config-field']");
  if (!(configField instanceof HTMLElement)) return;
  if (configField.dataset.revealSecret === "true") {
    const client = dashboardState.clientDetails?.client;
    if (!client) return;
    const result = await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/secret/reveal`);
    dashboardState.clientDetails = { client: { ...client, secretRevealable: true }, clientSecret: result.clientSecret };
    await renderClientsView();
    showToast("client secret 已显示，再点一次可复制。");
    return;
  }
  const value = configField.dataset.copyValue;
  if (!value) return;
  await navigator.clipboard.writeText(value);
  showToast("已复制。");
});

viewRoot.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.action !== "copy-config-field") return;
  event.preventDefault();
  if (target.dataset.revealSecret === "true") {
    const client = dashboardState.clientDetails?.client;
    if (!client) return;
    const result = await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/secret/reveal`);
    dashboardState.clientDetails = { client: { ...client, secretRevealable: true }, clientSecret: result.clientSecret };
    await renderClientsView();
    showToast("client secret 已显示，再点一次可复制。");
    return;
  }
  const value = target.dataset.copyValue;
  if (!value) return;
  await navigator.clipboard.writeText(value);
  showToast("已复制。");
});

async function handleViewSubmit(event) {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  hideToast();

  if (form.id === "bind-email-form") {
    await submitBindEmail(form);
  }
  if (form.id === "password-form") {
    await submitPasswordChange(form);
  }
  if (form.id === "user-create-form") {
    await submitUserCreate(form);
  }
  if (form.id === "user-edit-form") {
    await submitUserEdit(form);
  }
  if (form.id === "user-password-form") {
    await submitUserPasswordReset(form);
  }
  if (form.id === "client-form") {
    await submitClient(form);
  }
  if (form.id === "smtp-form") {
    await submitSmtp(form);
  }
}

async function submitBindEmail(form) {
  const data = new FormData(form);
  const codeField = form.querySelector("#bind-code-field");
  const endpoint = codeField.hidden ? "/api/account/email/start" : "/api/account/email/verify";
  await postJson(endpoint, { email: data.get("email"), code: data.get("code") });
  if (codeField.hidden) {
    codeField.hidden = false;
    form.querySelector("#bind-email-submit").textContent = "验证并绑定";
    showToast("验证码已发送，请查看邮箱。");
    return;
  }
  showToast("邮箱已绑定。");
  const me = await fetchJsonWithTimeout(`${apiBase}/api/me`, { credentials: "include" });
  currentUser = me.user;
  dashboardState.modalMode = null;
  renderAccount();
}

async function submitPasswordChange(form) {
  const data = new FormData(form);
  const newPassword = String(data.get("newPassword") ?? "");
  const confirmPassword = String(data.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) {
    showToast("两次输入的新密码不一致。", "error");
    return;
  }
  await postJson("/api/account/password", {
    currentPassword: data.get("currentPassword"),
    newPassword
  });
  form.reset();
  dashboardState.modalMode = null;
  renderAccount();
  showToast("密码已更新，其他设备已注销。");
}

async function submitUserCreate(form) {
  const data = new FormData(form);
  await postJson("/api/admin/users", {
    username: data.get("username"),
    email: data.get("email"),
    displayName: data.get("displayName"),
    password: data.get("password"),
    admin: data.get("admin") === "on",
    active: data.get("active") === "on"
  });
  form.reset();
  form.querySelector('input[name="active"]').checked = true;
  await switchView("users");
  showToast("用户已创建。");
}

async function submitUserEdit(form) {
  const data = new FormData(form);
  await postJson(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}`, {
    username: data.get("username"),
    email: data.get("email"),
    displayName: data.get("displayName"),
    admin: data.get("admin") === "on",
    active: data.get("active") === "on"
  });
  dashboardState.selectedUserId = null;
  dashboardState.userMode = null;
  await switchView("users");
  showToast("用户资料已保存。");
}

async function submitUserPasswordReset(form) {
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  const confirmPassword = String(data.get("confirmPassword") ?? "");
  if (password !== confirmPassword) {
    showToast("两次输入的新密码不一致。", "error");
    return;
  }
  await postJson(`/api/admin/users/${encodeURIComponent(form.dataset.userId)}/password`, { password });
  dashboardState.selectedUserId = null;
  dashboardState.userMode = null;
  await switchView("users");
  showToast("密码已重置，该用户旧会话已注销。");
}

async function submitClient(form) {
  const submitButton = form.querySelector('[data-action="submit-client-form"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = form.dataset.clientId ? "保存中..." : "创建中...";
  }
  const data = new FormData(form);
  const payload = {
    id: data.get("id"),
    name: data.get("name"),
    redirectUris: splitLines(data.get("redirectUris")),
    allowedScopes: splitWords(data.get("allowedScopes")),
    confidential: data.get("confidential") === "on",
    pkceRequired: data.get("pkceRequired") === "on"
  };
  const clientId = form.dataset.clientId;
  let result;
  try {
    result = await postJson(clientId ? `/api/admin/clients/${encodeURIComponent(clientId)}` : "/api/admin/clients", payload);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = clientId ? "保存应用" : "创建应用";
    }
  }
  if (clientId) {
    dashboardState.modalMode = null;
    dashboardState.selectedClientId = null;
    await renderClientsView();
    showToast("应用已保存。");
    return;
  }
  if (result.clientSecret) {
    dashboardState.modalMode = null;
    dashboardState.selectedClientId = null;
    dashboardState.clientDetails = { client: result.client, clientSecret: result.clientSecret };
    await renderClientsView();
    showToast("应用已创建，接入配置已生成。", "success", { sticky: true });
    return;
  }
  dashboardState.modalMode = null;
  dashboardState.selectedClientId = null;
  await renderClientsView();
  showToast("应用已创建。");
}

async function submitSmtp(form) {
  const data = new FormData(form);
  await postJson("/api/admin/smtp", {
    host: data.get("host"),
    port: Number(data.get("port")),
    secureMode: data.get("secureMode"),
    username: data.get("username"),
    password: data.get("password"),
    fromEmail: data.get("fromEmail"),
    fromName: data.get("fromName"),
    provider: data.get("provider")
  });
  dashboardState.modalMode = null;
  await renderSmtpView();
  showToast("邮件设置已保存。");
}

function metricCard(label, value, description) {
  return `<article class="metric-card"><span class="metric-label">${label}</span><strong>${escapeHtml(value)}</strong><p>${escapeHtml(description)}</p></article>`;
}

function panel(title, description, body, action = "") {
  return `
    <section class="console-panel">
      <div class="panel-heading">
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>
        ${action}
      </div>
      ${body}
    </section>
  `;
}

function renderClientDetailsModal() {
  if (!dashboardState.clientDetails) return "";
  const { client, clientSecret } = dashboardState.clientDetails;
  const fields = clientConfigFields(client, clientSecret);
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel client-detail-modal" role="dialog" aria-modal="true" aria-labelledby="client-detail-title">
        <div class="modal-heading">
          <div>
            <h2 id="client-detail-title">接入配置</h2>
            <p>${escapeHtml(client.name)} 的 Custom OAuth/OIDC 参数。</p>
          </div>
          <button class="icon-button" type="button" data-action="close-client-details" aria-label="关闭">×</button>
        </div>
        <div class="config-list">
          ${fields.map(renderConfigField).join("")}
        </div>
        ${renderClientIntegrationDocs(client)}
      </section>
    </div>
  `;
}

function renderConfigField(field) {
  const copyValue = field.copyValue ?? field.value;
  const canReveal = Boolean(field.revealable);
  const canCopy = canReveal || (Boolean(copyValue) && !field.copyDisabled);
  const copyAttrs = canCopy
    ? `data-action="copy-config-field" ${canReveal ? `data-reveal-secret="true"` : `data-copy-value="${escapeHtml(copyValue)}"`} role="button" tabindex="0" title="${canReveal ? "点击显示" : "点击复制"}"`
    : "";
  return `
    <div class="config-field ${canCopy ? "is-copyable" : "is-muted"}" ${copyAttrs}>
      <strong>${escapeHtml(field.label)}：</strong>
      <code>${escapeHtml(field.value)}</code>
    </div>
  `;
}

function clientConfigFields(client, clientSecret) {
  const issuer = window.location.origin;
  const firstRedirectUri = client.redirectUris?.[0] ?? "";
  const secretValue = client.confidential
    ? clientSecret ?? (client.secretRevealable ? "********" : "旧应用需先轮换密钥")
    : "Public 客户端无需填写";
  return [
    { label: "Client ID", value: client.id },
    {
      label: "Client secret",
      value: secretValue,
      copyValue: clientSecret,
      copyDisabled: !clientSecret,
      revealable: client.confidential && !clientSecret && client.secretRevealable
    },
    { label: "Authorization URL", value: `${issuer}/oauth/authorize` },
    { label: "Access token URL", value: `${issuer}/oauth/token` },
    { label: "Resource URL", value: `${issuer}/oauth/userinfo` },
    { label: "Redirect URL", value: firstRedirectUri },
    { label: "Logout URL", value: `${issuer}/oauth/logout` },
    { label: "User identifier", value: "sub" },
    { label: "Scopes", value: client.allowedScopes?.join(" ") || "openid profile email sub" },
    { label: "Auth Style", value: client.confidential ? "Basic Auth Header 或 Request Body" : "None / PKCE" }
  ];
}

function renderClientIntegrationDocs(client) {
  const issuer = window.location.origin;
  const callback = client.redirectUris?.[0] ?? "https://your-app.example/auth/callback";
  const scopes = client.allowedScopes?.join(" ") || "openid profile email";
  const authorizeUrl = `${issuer}/oauth/authorize`;
  const tokenUrl = `${issuer}/oauth/token`;
  const userinfoUrl = `${issuer}/oauth/userinfo`;
  return `
    <div class="integration-docs">
      <article>
        <h3>有自己的用户表</h3>
        <p>适合业务系统保留用户、角色、套餐、项目权限等数据，只把登录、注册、改密交给统一登陆平台。</p>
        <pre><code>users:
  id
  sso_sub unique
  username
  email
  display_name
  role</code></pre>
        <p>接入流程：跳转授权页 → callback 换 token → 读取 userinfo → 按 sso_sub upsert 本地用户 → 创建业务系统 session。</p>
        <pre><code>Issuer: ${escapeHtml(issuer)}
Client ID: ${escapeHtml(client.id)}
Redirect URI: ${escapeHtml(callback)}
Scope: ${escapeHtml(scopes)}
Authorization URL: ${escapeHtml(authorizeUrl)}
Token URL: ${escapeHtml(tokenUrl)}
UserInfo URL: ${escapeHtml(userinfoUrl)}
User ID Claim: sub
Username Claim: preferred_username
Email Claim: email</code></pre>
      </article>
      <article>
        <h3>没有自己的用户表</h3>
        <p>适合新项目或纯内部工具。应用不保存密码，也不维护本地用户，只保存自己的业务数据并引用 SSO 用户 ID。</p>
        <pre><code>业务表建议:
  owner_sub
  created_by_sub
  updated_by_sub</code></pre>
        <p>接入流程：未登录时跳转统一登陆平台 → callback 换 token → 校验 id_token/userinfo → 把 sub、email、username 写入应用 session。</p>
        <pre><code>session.user = {
  sub: userinfo.sub,
  username: userinfo.preferred_username,
  email: userinfo.email,
  name: userinfo.name
}</code></pre>
      </article>
    </div>
  `;
}

function renderSecurityList() {
  return `
    <div class="security-list">
      <div><span class="status-dot ok"></span><strong>密码登录</strong><p>邮箱或用户名均可登录</p></div>
      <div><span class="status-dot ${currentUser.emailVerified ? "ok" : "warn"}"></span><strong>邮箱验证</strong><p>${currentUser.emailVerified ? "邮箱已完成验证" : "建议尽快验证邮箱"}</p></div>
      <div><span class="status-dot ok"></span><strong>OIDC 授权</strong><p>授权码 + PKCE 已启用</p></div>
    </div>
  `;
}

function renderActivityList() {
  return `<div class="activity-list"><div><strong>登录状态正常</strong><p>当前会话已同步到统一登陆平台。</p></div><div><strong>授权策略生效</strong><p>接入系统仅能读取已授权范围。</p></div><div><strong>邮件验证可用</strong><p>注册和邮箱绑定通过验证码完成。</p></div></div>`;
}

function renderOperationModal() {
  if (!dashboardState.modalMode) return "";
  const selectedClient = dashboardState.clients.find((client) => client.id === dashboardState.selectedClientId);
  const dialogs = {
    password: {
      title: "修改密码",
      description: "修改后会注销其他设备和已签发的刷新令牌。",
      body: `
        <form id="password-form" class="console-form">
          <label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required /></label>
          <label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="6" required /></label>
          <label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required /></label>
          <div class="actions"><button type="submit">更新密码</button><button type="button" class="secondary-button" data-action="cancel-dialog">取消</button></div>
        </form>
      `
    },
    "bind-email": {
      title: "绑定邮箱",
      description: "发送验证码后，在同一弹窗中完成验证。",
      body: `
        <form id="bind-email-form" class="console-form">
          <label>新邮箱<input name="email" type="email" required /></label>
          <label id="bind-code-field" hidden>验证码<input name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" /></label>
          <div class="actions"><button type="submit" id="bind-email-submit">发送绑定验证码</button><button type="button" class="secondary-button" data-action="cancel-dialog">取消</button></div>
        </form>
      `
    },
    client: {
      title: selectedClient ? "编辑应用" : "创建应用",
      description: "常规 OAuth/OIDC 应用可使用 Authorization Code 接入。",
      body: renderClientForm(selectedClient)
    },
    smtp: {
      title: "邮件设置",
      description: "选择 Resend API 或 SMTP 作为验证码邮件通道。",
      body: renderSmtpForm(dashboardState.smtp)
    }
  };
  const dialog = dialogs[dashboardState.modalMode];
  if (!dialog) return "";
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="operation-modal-title">
        <div class="modal-heading">
          <div>
            <h2 id="operation-modal-title">${escapeHtml(dialog.title)}</h2>
            <p>${escapeHtml(dialog.description)}</p>
          </div>
          <button class="icon-button" type="button" data-action="cancel-dialog" aria-label="关闭">×</button>
        </div>
        ${dialog.body}
      </section>
    </div>
  `;
}

function renderClientForm(client) {
  const editing = Boolean(client);
  const confidential = client ? client.confidential : true;
  const pkceRequired = client ? client.pkceRequired : true;
  return `
    <form id="client-form" class="console-form" ${editing ? `data-client-id="${escapeHtml(client.id)}"` : ""}>
      <label>应用 ID<input name="id" placeholder="my-app" value="${escapeHtml(client?.id ?? "")}" ${editing ? "readonly" : "required"} /></label>
      <label>应用名称<input name="name" placeholder="我的业务系统" value="${escapeHtml(client?.name ?? "")}" required /></label>
      <label>回调地址<textarea name="redirectUris" required>${escapeHtml((client?.redirectUris ?? []).join("\n"))}</textarea></label>
      <label>Scope<input name="allowedScopes" value="${escapeHtml((client?.allowedScopes ?? ["openid", "profile", "email", "sub"]).join(" "))}" required /></label>
      ${editing ? "" : `<label class="check-row"><input name="confidential" type="checkbox" ${confidential ? "checked" : ""} />生成 client secret</label>`}
      <label class="check-row"><input name="pkceRequired" type="checkbox" ${pkceRequired ? "checked" : ""} ${confidential ? "" : "disabled"} />强制 S256 PKCE</label>
      <div id="client-secret-panel" class="notice" hidden><strong>请立即保存 client secret</strong><code id="client-secret"></code></div>
      <div class="actions"><button type="button" data-action="submit-client-form">${editing ? "保存应用" : "创建应用"}</button><button type="button" class="secondary-button" data-action="cancel-dialog">取消</button></div>
    </form>
  `;
}

function renderSmtpSummary(smtp) {
  if (!smtp) {
    return `<div class="empty-state">还没有读取到邮件设置。注册验证码和绑定邮箱验证码需要先完成邮件设置。</div>`;
  }
  const provider = smtp.provider ?? "resend";
  const smtpConfig = smtp.smtp;
  const resend = smtp.resend;
  const providerDetails =
    provider === "smtp"
      ? `
        <p><strong>SMTP 主机</strong><br>${smtpConfig ? `${escapeHtml(smtpConfig.host)}:${escapeHtml(smtpConfig.port ?? "-")}` : "未配置"}</p>
        <p><strong>SMTP 发件人</strong><br>${escapeHtml(smtpConfig?.fromEmail ?? "-")}</p>
      `
      : `
        <p><strong>Resend 状态</strong><br>${smtp.resendConfigured ? "API Key 已配置" : "API Key 未配置"}</p>
        <p><strong>Resend 发件人</strong><br>${escapeHtml(resend?.fromEmail ?? "noreply@example.com")}</p>
      `;
  return `
    <div class="detail-list">
      <p><strong>当前通道</strong><br>${provider === "resend" ? "Resend API" : "SMTP"}</p>
      ${providerDetails}
    </div>
  `;
}

function renderSmtpForm(smtp) {
  const provider = smtp?.provider ?? "resend";
  const resend = smtp?.resend ?? { fromEmail: "noreply@example.com", fromName: "统一登陆平台" };
  const smtpConfig = smtp?.smtp;
  const senderEmail = provider === "smtp" ? smtpConfig?.fromEmail ?? resend.fromEmail : resend.fromEmail;
  const senderName = provider === "smtp" ? smtpConfig?.fromName ?? resend.fromName : resend.fromName;
  return `
    <form id="smtp-form" class="console-form">
      <label>邮件通道
        <select name="provider">
          <option value="resend" ${provider === "resend" ? "selected" : ""}>Resend API</option>
          <option value="smtp" ${provider === "smtp" ? "selected" : ""}>SMTP</option>
        </select>
      </label>
      <label>发件邮箱<input name="fromEmail" type="email" value="${escapeHtml(senderEmail)}" required /></label>
      <label>发件名称<input name="fromName" value="${escapeHtml(senderName)}" required /></label>
      ${provider === "smtp" ? renderSmtpProviderFields(smtpConfig) : renderResendProviderFields(smtp)}
      <label>测试收件邮箱<input name="testEmail" type="email" /></label>
      <div class="actions">
        <button type="submit">保存邮件设置</button>
        <button type="button" class="secondary-button" data-action="smtp-test">发送测试邮件</button>
        <button type="button" class="secondary-button" data-action="cancel-dialog">取消</button>
      </div>
    </form>
  `;
}

function renderResendProviderFields(smtp) {
  return `
    <div class="notice">
      <strong>Resend API Key ${smtp?.resendConfigured ? "已配置" : "未配置"}</strong>
      <p>API Key 存放在 Cloudflare Worker Secret 中，页面不会显示密钥。</p>
    </div>
  `;
}

function renderSmtpProviderFields(smtpConfig) {
  return `
    <label>SMTP 主机<input name="host" value="${escapeHtml(smtpConfig?.host ?? "")}" required /></label>
    <label>端口<input name="port" type="number" value="${escapeHtml(smtpConfig?.port ?? 465)}" required /></label>
    <label>加密方式
      <select name="secureMode">
        <option value="ssl" ${smtpConfig?.secureMode === "starttls" ? "" : "selected"}>SSL/TLS</option>
        <option value="starttls" ${smtpConfig?.secureMode === "starttls" ? "selected" : ""}>STARTTLS</option>
      </select>
    </label>
    <label>用户名<input name="username" value="${escapeHtml(smtpConfig?.username ?? "")}" required /></label>
    <label>密码/授权码<input name="password" type="password" placeholder="已配置时可留空" /></label>
  `;
}

function renderGrantTable(grants) {
  if (grants.length === 0) return table(["应用", "权限范围", "最近授权", "状态"], renderTableMessage("还没有授权过其他应用。", 4));
  return table(["应用", "权限范围", "最近授权", "状态"], grants.map(renderGrantRow).join(""));
}

function renderGrantRow(grant) {
  return `<tr><td><strong>${escapeHtml(grant.clientName)}</strong><span>${escapeHtml(grant.clientId)}</span></td><td>${escapeHtml(grant.scopes.join(" "))}</td><td>${escapeHtml(formatDate(grant.updatedAt))}</td><td><span class="status-chip ok">已授权</span></td></tr>`;
}

function renderGrantManageList(grants) {
  if (grants.length === 0) return `<div class="empty-state">还没有授权过其他应用。</div>`;
  return table(
    ["应用", "Client ID", "权限范围", "最近授权", "操作"],
    grants
      .map(
        (grant) => `
          <tr>
            <td><strong>${escapeHtml(grant.clientName)}</strong></td>
            <td><code>${escapeHtml(grant.clientId)}</code></td>
            <td>${escapeHtml(grant.scopes.join(" "))}</td>
            <td>${escapeHtml(formatDate(grant.updatedAt))}</td>
            <td><div class="table-actions"><button type="button" data-action="revoke-grant" data-grant-id="${escapeHtml(grant.id)}">撤销授权</button></div></td>
          </tr>
        `
      )
      .join("")
  );
}

function renderSessionTable(sessions) {
  if (sessions.length === 0) return table(["会话", "来源", "IP", "浏览器", "最近活动"], renderTableMessage("没有有效会话。", 5));
  return table(["会话", "来源", "IP", "浏览器", "最近活动"], sessions.map(renderSessionRow).join(""));
}

function renderSessionRow(session) {
  const device = parseUserAgent(session.userAgent);
  return `<tr><td><strong>${session.current ? "当前会话" : "其他会话"}</strong><span>${escapeHtml(formatDateFromSeconds(session.expiresAt))} 过期</span></td><td>${escapeHtml(session.sourceName ?? "控制台")}</td><td>${escapeHtml(session.ip ?? "未知")}</td><td>${escapeHtml(device.summary)}</td><td>${escapeHtml(formatDate(session.lastSeenAt ?? session.createdAt))}</td></tr>`;
}

function renderSessionManageList(sessions) {
  if (sessions.length === 0) return `<div class="empty-state">没有有效会话。</div>`;
  return `<div class="session-list">${sessions.map(renderSessionCard).join("")}</div>`;
}

function renderSessionCard(session) {
  const device = parseUserAgent(session.userAgent);
  return `
    <article class="session-card">
      <div class="session-main">
        <div>
          <strong>${escapeHtml(device.summary)}</strong>
          <span>${escapeHtml(device.detail)}</span>
        </div>
        <span class="status-chip ${session.current ? "ok" : "neutral"}">${escapeHtml(session.sourceName ?? "控制台")}</span>
      </div>
      <dl class="session-meta">
        <div><dt>来源</dt><dd>${escapeHtml(session.sourceName ?? "控制台")}</dd></div>
        <div><dt>IP</dt><dd>${escapeHtml(session.ip ?? "未知")}</dd></div>
        <div><dt>最近活动</dt><dd>${escapeHtml(formatDate(session.lastSeenAt ?? session.createdAt))}</dd></div>
        <div><dt>过期时间</dt><dd>${escapeHtml(formatDateFromSeconds(session.expiresAt))}</dd></div>
      </dl>
      ${session.current ? "" : `<div class="actions"><button type="button" data-action="revoke-session" data-session-id="${escapeHtml(session.id)}">注销会话</button></div>`}
    </article>
  `;
}

function renderUsersTable(users) {
  if (users.length === 0) return `<div class="empty-state">还没有用户。</div>`;
  return table(
    ["用户", "邮箱", "状态", "角色", "会话", "操作"],
    users
      .map(
        (user) => renderUserRow(user)
      )
      .join("")
  );
}

function renderUserRow(user) {
  const isSelf = user.id === currentUser.id;
  return `
    <tr>
      <td><strong>${escapeHtml(user.displayName)}</strong><span>${escapeHtml(user.username ?? "-")}</span></td>
      <td>${escapeHtml(user.email)}<span>${user.emailVerified ? "已验证" : "未验证"}</span></td>
      <td><span class="status-chip ${user.active ? "ok" : "neutral"}">${user.active ? "启用" : "停用"}</span></td>
      <td>${user.admin ? "管理员" : "普通用户"}</td>
      <td>${user.sessionCount}</td>
      <td class="table-actions">
        <button type="button" data-action="edit-user" data-user-id="${escapeHtml(user.id)}">编辑</button>
        <button type="button" data-action="reset-user-password" data-user-id="${escapeHtml(user.id)}">重置密码</button>
        <button type="button" data-action="toggle-user-admin" data-user-id="${escapeHtml(user.id)}">${user.admin ? "取消管理员" : "设为管理员"}</button>
        <button type="button" data-action="toggle-user" data-user-id="${escapeHtml(user.id)}" data-active="${user.active}">${user.active ? "停用" : "启用"}</button>
        <button type="button" data-action="revoke-user-sessions" data-user-id="${escapeHtml(user.id)}">注销会话</button>
        <button class="danger-button" type="button" data-action="delete-user" data-user-id="${escapeHtml(user.id)}" ${isSelf ? "disabled" : ""}>删除</button>
      </td>
    </tr>
  `;
}

function renderUserModal() {
  if (!dashboardState.userMode) return "";
  const user = dashboardState.users.find((item) => item.id === dashboardState.selectedUserId);
  if (dashboardState.userMode === "create") {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <div class="modal-heading">
            <div>
              <h2 id="user-modal-title">新增用户</h2>
              <p>创建后账号可立即用于登录统一登陆平台。</p>
            </div>
            <button class="icon-button" type="button" data-action="cancel-user-action" aria-label="关闭">×</button>
          </div>
          <form id="user-create-form" class="console-form">
            <label>用户名<input name="username" placeholder="zhangsan" autocomplete="off" required /></label>
            <label>邮箱<input name="email" type="email" placeholder="name@example.com" autocomplete="off" required /></label>
            <label>显示名称<input name="displayName" placeholder="可留空，默认使用用户名" /></label>
            <label>初始密码<input name="password" type="password" minlength="6" required /></label>
            <label class="check-row"><input name="admin" type="checkbox" />设为管理员</label>
            <label class="check-row"><input name="active" type="checkbox" checked />立即启用</label>
            <div class="actions"><button type="submit">创建用户</button><button type="button" class="secondary-button" data-action="cancel-user-action">取消</button></div>
          </form>
        </section>
      </div>
    `;
  }
  if (!user) return "";
  if (dashboardState.userMode === "password") {
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
          <div class="modal-heading">
            <div>
              <h2 id="user-modal-title">重置密码</h2>
              <p>${escapeHtml(user.username ?? user.email)} 的旧会话会被注销。</p>
            </div>
            <button class="icon-button" type="button" data-action="cancel-user-action" aria-label="关闭">×</button>
          </div>
          <form id="user-password-form" class="console-form" data-user-id="${escapeHtml(user.id)}">
          <label>新密码<input name="password" type="password" minlength="6" required /></label>
          <label>确认新密码<input name="confirmPassword" type="password" minlength="6" required /></label>
          <div class="actions"><button type="submit">保存新密码</button><button type="button" class="secondary-button" data-action="cancel-user-action">取消</button></div>
          </form>
        </section>
      </div>
    `;
  }
  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
        <div class="modal-heading">
          <div>
            <h2 id="user-modal-title">编辑用户</h2>
            <p>更新账号资料、角色和启用状态。</p>
          </div>
          <button class="icon-button" type="button" data-action="cancel-user-action" aria-label="关闭">×</button>
        </div>
        <form id="user-edit-form" class="console-form" data-user-id="${escapeHtml(user.id)}">
        <label>用户名<input name="username" value="${escapeHtml(user.username ?? "")}" required /></label>
        <label>邮箱<input name="email" type="email" value="${escapeHtml(user.email)}" required /></label>
        <label>显示名称<input name="displayName" value="${escapeHtml(user.displayName)}" /></label>
        <label class="check-row"><input name="admin" type="checkbox" ${user.admin ? "checked" : ""} />管理员</label>
        <label class="check-row"><input name="active" type="checkbox" ${user.active ? "checked" : ""} />启用</label>
        <div class="actions"><button type="submit">保存修改</button><button type="button" class="secondary-button" data-action="cancel-user-action">取消</button></div>
        </form>
      </section>
    </div>
  `;
}

function renderUsersViewFromState() {
  viewRoot.innerHTML = `
    ${panel(
      "用户列表",
      "增删改查、角色调整、重置密码和会话管理。",
      renderUsersTable(dashboardState.users),
      `<button type="button" data-action="create-user">新增用户</button>`
    )}
    ${renderUserModal()}
  `;
}

function renderClientsList(clients) {
  if (clients.length === 0) return `<div class="empty-state">还没有应用。</div>`;
  return `<div class="client-list">${clients.map((client) => `<article class="client-item"><div><strong>${escapeHtml(client.name)}</strong><code>${escapeHtml(client.id)}</code></div><p>${client.active ? "已启用" : "已停用"} · ${client.confidential ? "Confidential" : "Public"} · ${client.pkceRequired ? "强制 PKCE" : "兼容无 PKCE"}</p><p>Scope：${escapeHtml(client.allowedScopes.join(" "))}</p><div class="actions"><button type="button" data-action="view-client-details" data-client-id="${escapeHtml(client.id)}">详情</button><button type="button" data-action="edit-client" data-client-id="${escapeHtml(client.id)}">编辑</button><button type="button" data-action="toggle-client" data-client-id="${escapeHtml(client.id)}" data-active="${client.active}">${client.active ? "停用应用" : "启用应用"}</button><button type="button" data-action="rotate-secret" data-client-id="${escapeHtml(client.id)}">轮换密钥</button><button class="danger-button" type="button" data-action="delete-client" data-client-id="${escapeHtml(client.id)}">删除</button></div></article>`).join("")}</div>`;
}

function renderAuditList(events) {
  if (events.length === 0) return `<div class="empty-state">暂无审计事件。</div>`;
  return `<div class="client-list">${events.map((event) => `<article class="client-item"><div><strong>${escapeHtml(event.eventType)}</strong><code>${escapeHtml(event.createdAt)}</code></div><p>${escapeHtml(event.actorType)}${event.actorId ? ` · ${escapeHtml(event.actorId)}` : ""}</p><p>${event.targetType ? escapeHtml(event.targetType) : "无目标"}${event.targetId ? ` · ${escapeHtml(event.targetId)}` : ""}</p><code>${escapeHtml(JSON.stringify(event.metadata ?? {}))}</code></article>`).join("")}</div>`;
}

function table(headers, rows) {
  const labeledRows = rows.replace(/<tr>([\s\S]*?)<\/tr>/g, (_row, cells) => {
    let columnIndex = 0;
    const labeledCells = cells.replace(/<td([^>]*)>/g, (cell, attributes) => {
      if (attributes.includes("colspan=")) return cell;
      const label = headers[columnIndex] ?? "";
      columnIndex += 1;
      return `<td${attributes} data-label="${escapeHtml(label)}">`;
    });
    return `<tr>${labeledCells}</tr>`;
  });

  return `<div class="table-shell"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${labeledRows}</tbody></table></div>`;
}

function renderTableMessage(text, columns) {
  return `<tr><td class="empty-table" colspan="${columns}">${escapeHtml(text)}</td></tr>`;
}

function showToast(text, type = "success", options = {}) {
  window.clearTimeout(toastTimer);
  message.textContent = text;
  message.dataset.type = type;
  message.hidden = false;
  message.classList.add("show");
  if (!options.sticky) {
    toastTimer = window.setTimeout(hideToast, type === "error" ? 5200 : 3200);
  }
}

function hideToast() {
  window.clearTimeout(toastTimer);
  message.classList.remove("show");
  message.textContent = "";
}

function reportActionError(error) {
  showToast(error?.message ?? "操作失败，请稍后重试。", "error");
}

async function postJson(path, body) {
  return fetchJsonWithTimeout(`${apiBase}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail ? `${result.error ?? "请求失败。"} ${result.detail}` : result.error ?? "请求失败。");
    return result;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function splitLines(value) {
  return String(value ?? "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function splitWords(value) {
  return String(value ?? "").split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function parseUserAgent(userAgent) {
  const value = String(userAgent ?? "");
  const browser = value.includes("Edg/") ? "Edge" : value.includes("Chrome/") ? "Chrome" : value.includes("Firefox/") ? "Firefox" : value.includes("Safari/") ? "Safari" : value.startsWith("curl/") ? "命令行" : value === "node" ? "脚本" : "未知浏览器";
  const os = value.includes("Mac OS X") ? "macOS" : value.includes("Windows") ? "Windows" : value.includes("Android") ? "Android" : value.includes("iPhone") || value.includes("iPad") ? "iOS" : value.includes("Linux") ? "Linux" : "未知系统";
  return {
    summary: `${browser} / ${os}`,
    detail: value || "没有 User-Agent 信息"
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatDateFromSeconds(value) {
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
