(() => {
  const mobileQuery = window.matchMedia("(max-width: 860px)");
  window.SSO_MOBILE_ACTIVE = mobileQuery.matches;
  if (!mobileQuery.matches || !window.Vue) return;

  const { createApp, computed, onMounted, reactive } = window.Vue;
  const configuredApiBase = window.OIDC_API_BASE ?? "";
  const apiBase = configuredApiBase || window.location.origin;
  const origin = window.location.origin;

  const routes = {
    dashboard: "/dashboard",
    grants: "/grants",
    sessions: "/sessions",
    account: "/account",
    users: "/users",
    clients: "/clients",
    smtp: "/smtp",
    audit: "/audit"
  };
  const routeViews = Object.fromEntries(Object.entries(routes).map(([view, route]) => [route, view]));

  const state = reactive({
    loading: true,
    view: routeViews[window.location.pathname] ?? "dashboard",
    user: null,
    grants: [],
    sessions: [],
    users: [],
    clients: [],
    smtp: null,
    audit: [],
    moreOpen: false,
    message: "",
    messageType: "success",
    busyMessage: "",
    adminForm: null,
    adminFormData: {},
    revealedSecret: ""
  });

  const viewTitles = {
    dashboard: "仪表盘",
    grants: "授权应用",
    sessions: "登录会话",
    account: "账号中心",
    users: "用户管理",
    clients: "应用接入",
    smtp: "邮件设置",
    audit: "审计日志"
  };

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, { credentials: "include", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "请求失败");
    return data;
  }

  async function postJson(path, body = {}) {
    return fetchJson(`${apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
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

  function displayName(user) {
    return user?.displayName ?? user?.username ?? user?.email ?? "-";
  }

  function splitLines(value) {
    return String(value ?? "")
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function splitWords(value) {
    return String(value ?? "")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function openAdminForm(type, data = {}) {
    state.revealedSecret = "";
    state.adminForm = type;
    state.adminFormData = type === "smtp" ? { provider: "resend", ...data } : { ...data };
  }

  function closeAdminForm() {
    state.adminForm = null;
    state.adminFormData = {};
    state.revealedSecret = "";
  }

  async function copyText(value) {
    const text = String(value ?? "");
    if (!text) return;
    await navigator.clipboard?.writeText(text);
  }

  async function loadAccountData() {
    const [grants, sessions] = await Promise.all([
      fetchJson(`${apiBase}/api/account/grants`),
      fetchJson(`${apiBase}/api/account/sessions`)
    ]);
    state.grants = grants.grants ?? [];
    state.sessions = sessions.sessions ?? [];
  }

  async function loadAdminView(view) {
    if (!state.user?.isAdmin) return;
    if (view === "users") {
      const result = await fetchJson(`${apiBase}/api/admin/users`);
      state.users = result.users ?? [];
    }
    if (view === "clients") {
      const result = await fetchJson(`${apiBase}/api/admin/clients`);
      state.clients = result.clients ?? [];
    }
    if (view === "smtp") {
      state.smtp = await fetchJson(`${apiBase}/api/admin/smtp`).catch(() => null);
    }
    if (view === "audit") {
      const result = await fetchJson(`${apiBase}/api/admin/audit-events?limit=50`);
      state.audit = result.events ?? [];
    }
  }

  async function switchView(view, options = {}) {
    if (!routes[view]) view = "dashboard";
    if (["users", "clients", "smtp", "audit"].includes(view) && !state.user?.isAdmin) view = "dashboard";
    state.view = view;
    state.moreOpen = false;
    if (window.location.pathname !== routes[view]) {
      const method = options.replace ? "replaceState" : "pushState";
      window.history[method]({ view }, "", routes[view]);
    }
    if (["dashboard", "grants", "sessions"].includes(view)) await loadAccountData();
    await loadAdminView(view);
  }

  async function init() {
    document.body.classList.add("mobile-nutui-body");
    document.querySelector("#dashboard-loading")?.setAttribute("hidden", "");
    document.querySelector("#dashboard-app")?.setAttribute("hidden", "");
    const mobileRoot = document.querySelector("#mobile-app");
    if (mobileRoot) mobileRoot.hidden = false;

    const me = await fetchJson(`${apiBase}/api/me`);
    if (!me.authenticated) {
      window.location.replace(`/login?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    state.user = me.user;
    await switchView(state.view, { replace: true });
    state.loading = false;
  }

  createApp({
    setup() {
      const title = computed(() => viewTitles[state.view] ?? "仪表盘");
      const adminItems = computed(() => [
        { view: "users", label: "用户管理", hidden: !state.user?.isAdmin },
        { view: "clients", label: "应用接入", hidden: !state.user?.isAdmin },
        { view: "smtp", label: "邮件设置", hidden: !state.user?.isAdmin },
        { view: "audit", label: "审计日志", hidden: !state.user?.isAdmin }
      ].filter((item) => !item.hidden));
      const navClass = computed(() => ({ "is-admin": Boolean(state.user?.isAdmin) }));
      const adminPopupVisible = computed({
        get: () => Boolean(state.adminForm),
        set: (visible) => {
          if (!visible) closeAdminForm();
        }
      });

      let messageTimer = 0;

      function showError(error) {
        window.clearTimeout(messageTimer);
        state.messageType = "error";
        state.message = error?.message ?? "操作失败";
        messageTimer = window.setTimeout(() => {
          state.message = "";
        }, 2200);
      }

      function showMessage(message, type = "success") {
        window.clearTimeout(messageTimer);
        state.messageType = type;
        state.message = message;
        messageTimer = window.setTimeout(() => {
          state.message = "";
        }, 2200);
      }

      function runAction(action, successMessage) {
        if (state.busyMessage) return;
        state.busyMessage = "处理中";
        Promise.resolve()
          .then(action)
          .then((result) => {
            if (result === false) return;
            if (typeof result === "string") showMessage(result);
            else if (successMessage) showMessage(successMessage);
          })
          .finally(() => {
            state.busyMessage = "";
          })
          .catch(showError);
      }

      async function revokeGrant(grant) {
        await postJson(`/api/account/grants/${encodeURIComponent(grant.id)}/revoke`);
        await switchView("grants", { replace: true });
        return "授权已撤销";
      }

      async function revokeSession(session) {
        await postJson(`/api/account/sessions/${encodeURIComponent(session.id)}/revoke`);
        await switchView("sessions", { replace: true });
        return "会话已注销";
      }

      function formDataFromEvent(event) {
        const form = event.target.closest?.("form") ?? event.target;
        return Object.fromEntries(new FormData(form).entries());
      }

      async function submitMobileUser(event) {
        const data = formDataFromEvent(event);
        const editing = state.adminForm === "user-edit";
        const payload = {
          username: data.username,
          email: data.email,
          displayName: data.displayName,
          admin: data.admin === "on",
          active: data.active === "on"
        };
        if (!editing) payload.password = data.password;
        await postJson(editing ? `/api/admin/users/${encodeURIComponent(state.adminFormData.id)}` : "/api/admin/users", payload);
        closeAdminForm();
        await switchView("users", { replace: true });
        return editing ? "用户已保存" : "用户已创建";
      }

      async function resetMobileUserPassword(event) {
        const data = formDataFromEvent(event);
        if (data.password !== data.confirmPassword) throw new Error("两次输入的新密码不一致。");
        await postJson(`/api/admin/users/${encodeURIComponent(state.adminFormData.id)}/password`, { password: data.password });
        closeAdminForm();
        await switchView("users", { replace: true });
        return "密码已重置";
      }

      async function submitMobileAccountPassword(event) {
        const data = formDataFromEvent(event);
        if (data.newPassword !== data.confirmPassword) throw new Error("两次输入的新密码不一致。");
        await postJson("/api/account/password", {
          currentPassword: data.currentPassword,
          newPassword: data.newPassword
        });
        closeAdminForm();
        return "密码已更新，其他设备已注销";
      }

      async function toggleMobileUser(user) {
        await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/status`, { active: !user.active });
        await switchView("users", { replace: true });
        return user.active ? "用户已停用" : "用户已启用";
      }

      async function deleteMobileUser(user) {
        if (!window.confirm(`确定删除用户 ${user.username ?? user.email}？`)) return false;
        await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/delete`);
        await switchView("users", { replace: true });
        return "用户已删除";
      }

      async function revokeMobileUserSessions(user) {
        await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`);
        await switchView("users", { replace: true });
        return "该用户会话已注销";
      }

      async function submitMobileClient(event) {
        const data = formDataFromEvent(event);
        const editing = state.adminForm === "client-edit";
        const payload = {
          id: data.id,
          name: data.name,
          redirectUris: splitLines(data.redirectUris),
          allowedScopes: splitWords(data.allowedScopes),
          confidential: data.confidential === "on",
          pkceRequired: data.pkceRequired === "on"
        };
        const result = await postJson(editing ? `/api/admin/clients/${encodeURIComponent(state.adminFormData.id)}` : "/api/admin/clients", payload);
        state.revealedSecret = result.clientSecret ?? "";
        if (!state.revealedSecret) closeAdminForm();
        await switchView("clients", { replace: true });
        return state.revealedSecret ? "应用已创建，密钥已显示" : "应用已保存";
      }

      async function toggleMobileClient(client) {
        await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/status`, { active: !client.active });
        await switchView("clients", { replace: true });
        return client.active ? "应用已停用" : "应用已启用";
      }

      async function rotateMobileClient(client) {
        const result = await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/secret/rotate`);
        openAdminForm("client-secret", client);
        state.revealedSecret = result.clientSecret;
        return "新密钥已生成";
      }

      async function deleteMobileClient(client) {
        if (!window.confirm(`确定删除应用 ${client.name}？`)) return false;
        await postJson(`/api/admin/clients/${encodeURIComponent(client.id)}/delete`);
        await switchView("clients", { replace: true });
        return "应用已删除";
      }

      function showMobileClientConfig(client) {
        openAdminForm("client-config", client);
      }

      async function revealMobileClientSecret() {
        if (state.revealedSecret) {
          await copyText(state.revealedSecret);
          showMessage("client secret 已复制");
          return;
        }
        if (!state.adminFormData?.id || !state.adminFormData?.secretRevealable) return;
        const result = await postJson(`/api/admin/clients/${encodeURIComponent(state.adminFormData.id)}/secret/reveal`);
        state.revealedSecret = result.clientSecret ?? "";
        showMessage("client secret 已显示，再点一次可复制");
      }

      async function copyConfigValue(value) {
        await copyText(value);
        showMessage("已复制");
      }

      async function submitMobileSmtp(event) {
        const data = formDataFromEvent(event);
        await postJson("/api/admin/smtp", {
          provider: data.provider,
          fromEmail: data.fromEmail,
          fromName: data.fromName,
          host: data.host,
          port: Number(data.port),
          secureMode: data.secureMode,
          username: data.username,
          password: data.password
        });
        closeAdminForm();
        await switchView("smtp", { replace: true });
        return "邮件设置已保存";
      }

      async function testMobileSmtp(event) {
        const data = formDataFromEvent(event);
        await postJson("/api/admin/smtp/test", { testEmail: data.testEmail });
        return "测试邮件已发送";
      }

      function logout() {
        window.location.assign(`${apiBase}/oauth/logout`);
      }

      onMounted(() => {
        init().catch(showError);
        window.addEventListener("popstate", () => {
          switchView(routeViews[window.location.pathname] ?? "dashboard", { replace: true }).catch(showError);
        });
      });

      return {
        state,
        title,
        adminItems,
        navClass,
        adminPopupVisible,
        origin,
        displayName,
        formatDate,
        formatDateFromSeconds,
        switchView,
        runAction,
        revokeGrant,
        revokeSession,
        openAdminForm,
        closeAdminForm,
        submitMobileUser,
        resetMobileUserPassword,
        submitMobileAccountPassword,
        toggleMobileUser,
        deleteMobileUser,
        revokeMobileUserSessions,
        submitMobileClient,
        toggleMobileClient,
        rotateMobileClient,
        deleteMobileClient,
        showMobileClientConfig,
        revealMobileClientSecret,
        copyConfigValue,
        submitMobileSmtp,
        testMobileSmtp,
        logout
      };
    },
    template: `
      <div class="nut-mobile-shell">
        <nut-navbar :title="title" fixed placeholder safe-area-inset-top>
          <template #left>
            <div class="nut-mobile-brand"><span>SSO</span></div>
          </template>
        </nut-navbar>

        <main class="nut-mobile-main" v-if="!state.loading">
          <section v-if="state.view === 'dashboard'" class="nut-page-stack">
            <div class="nut-stat-grid">
              <div class="nut-stat-card"><span>授权应用</span><strong>{{ state.grants.length }}</strong><small>已允许访问账号信息</small></div>
              <div class="nut-stat-card"><span>有效会话</span><strong>{{ state.sessions.length }}</strong><small>当前仍保持登录状态</small></div>
            </div>
            <section class="nut-section">
              <div class="nut-section-head"><strong>最近授权应用</strong><button @click="switchView('grants')">全部</button></div>
              <div v-if="state.grants.length === 0" class="nut-empty">暂无授权应用</div>
              <div v-for="grant in state.grants.slice(0, 3)" :key="grant.id" class="nut-list-card">
                <strong>{{ grant.clientName }}</strong>
                <span>{{ grant.clientId }}</span>
                <small>{{ grant.scopes.join(' ') }}</small>
              </div>
            </section>
          </section>

          <section v-if="state.view === 'grants'" class="nut-page-stack">
            <div v-if="state.grants.length === 0" class="nut-empty">暂无授权应用</div>
            <div v-for="grant in state.grants" :key="grant.id" class="nut-list-card">
              <div class="nut-card-row"><strong>{{ grant.clientName }}</strong><nut-tag type="success">已授权</nut-tag></div>
              <span>{{ grant.clientId }}</span>
              <small>{{ grant.scopes.join(' ') }}</small>
              <small>最近授权 {{ formatDate(grant.updatedAt) }}</small>
              <nut-button size="small" plain type="danger" @click="runAction(() => revokeGrant(grant))">撤销授权</nut-button>
            </div>
          </section>

          <section v-if="state.view === 'sessions'" class="nut-page-stack">
            <div v-if="state.sessions.length === 0" class="nut-empty">暂无有效会话</div>
            <div v-for="session in state.sessions" :key="session.id" class="nut-list-card">
              <div class="nut-card-row"><strong>{{ session.current ? '当前会话' : '其他会话' }}</strong><nut-tag :type="session.current ? 'success' : 'default'">{{ session.sourceName || '控制台' }}</nut-tag></div>
              <span>{{ session.ip || '未知 IP' }}</span>
              <small>最近活动 {{ formatDate(session.lastSeenAt || session.createdAt) }}</small>
              <small>过期时间 {{ formatDateFromSeconds(session.expiresAt) }}</small>
              <nut-button v-if="!session.current" size="small" plain type="danger" @click="runAction(() => revokeSession(session))">注销会话</nut-button>
            </div>
          </section>

          <section v-if="state.view === 'account'" class="nut-page-stack">
            <div class="nut-account-card">
              <div class="nut-account-avatar">{{ displayName(state.user).slice(0, 1).toUpperCase() }}</div>
              <strong>{{ displayName(state.user) }}</strong>
              <span>{{ state.user.email }}</span>
            </div>
            <nut-cell title="用户名" :desc="state.user.username || '-'" />
            <nut-cell title="邮箱状态" :desc="state.user.emailVerified ? '已验证' : '未验证'" />
            <nut-cell title="账号角色" :desc="state.user.isAdmin ? '管理员' : '普通用户'" />
            <div class="nut-account-actions">
              <button type="button" class="nut-form-button primary" @click="openAdminForm('account-password')">修改密码</button>
              <button type="button" class="nut-form-button ghost" @click="logout">退出登录</button>
            </div>
          </section>

          <section v-if="state.view === 'users'" class="nut-page-stack">
            <div class="nut-section-head nut-action-head"><strong>用户管理</strong><button class="nut-mini-button primary" @click="openAdminForm('user-create', { active: true })">新增</button></div>
            <div v-for="user in state.users" :key="user.id" class="nut-list-card">
              <div class="nut-card-row"><strong>{{ user.displayName }}</strong><nut-tag :type="user.active ? 'success' : 'default'">{{ user.active ? '启用' : '停用' }}</nut-tag></div>
              <span>{{ user.email }}</span><small>{{ user.admin ? '管理员' : '普通用户' }} · 会话 {{ user.sessionCount }}</small>
              <div class="nut-mobile-actions">
                <button class="nut-mini-button" @click="openAdminForm('user-edit', user)">编辑</button>
                <button class="nut-mini-button" @click="openAdminForm('user-password', user)">密码</button>
                <button class="nut-mini-button" @click="runAction(() => toggleMobileUser(user))">{{ user.active ? '停用' : '启用' }}</button>
                <button class="nut-mini-button" @click="runAction(() => revokeMobileUserSessions(user))">注销会话</button>
                <button class="nut-mini-button danger" @click="runAction(() => deleteMobileUser(user))">删除</button>
              </div>
            </div>
          </section>

          <section v-if="state.view === 'clients'" class="nut-page-stack">
            <div class="nut-section-head nut-action-head"><strong>应用接入</strong><button class="nut-mini-button primary" @click="openAdminForm('client-create', { allowedScopes: ['openid', 'profile', 'email', 'sub'], confidential: true, pkceRequired: true })">创建</button></div>
            <div v-for="client in state.clients" :key="client.id" class="nut-list-card">
              <div class="nut-card-row"><strong>{{ client.name }}</strong><nut-tag :type="client.active ? 'success' : 'default'">{{ client.active ? '启用' : '停用' }}</nut-tag></div>
              <span>{{ client.id }}</span><small>{{ client.allowedScopes.join(' ') }}</small>
              <div class="nut-mobile-actions">
                <button class="nut-mini-button" @click="showMobileClientConfig(client)">详情</button>
                <button class="nut-mini-button" @click="openAdminForm('client-edit', client)">编辑</button>
                <button class="nut-mini-button" @click="runAction(() => toggleMobileClient(client))">{{ client.active ? '停用' : '启用' }}</button>
                <button class="nut-mini-button" @click="runAction(() => rotateMobileClient(client))">轮换</button>
                <button class="nut-mini-button danger" @click="runAction(() => deleteMobileClient(client))">删除</button>
              </div>
            </div>
          </section>

          <section v-if="state.view === 'smtp'" class="nut-page-stack">
            <div class="nut-section-head nut-action-head"><strong>邮件设置</strong><button class="nut-mini-button primary" @click="openAdminForm('smtp', state.smtp || {})">编辑</button></div>
            <nut-cell title="当前通道" :desc="state.smtp?.provider === 'resend' ? 'Resend API' : 'SMTP'" />
            <template v-if="state.smtp?.provider !== 'smtp'">
              <nut-cell title="API Key" :desc="state.smtp?.resendConfigured ? '已配置' : '未配置'" />
              <nut-cell title="发件邮箱" :desc="state.smtp?.resend?.fromEmail || 'noreply@example.com'" />
            </template>
            <template v-else>
              <nut-cell title="SMTP 主机" :desc="state.smtp?.smtp?.host || '未配置'" />
              <nut-cell title="发件邮箱" :desc="state.smtp?.smtp?.fromEmail || '-'" />
            </template>
          </section>

          <section v-if="state.view === 'audit'" class="nut-page-stack">
            <div v-for="event in state.audit" :key="event.id" class="nut-list-card">
              <strong>{{ event.eventType }}</strong><span>{{ event.actorType }}</span><small>{{ formatDate(event.createdAt) }}</small>
            </div>
          </section>
        </main>

        <div v-else class="nut-mobile-loading">
          <nut-loading type="spinner" color="#2563eb" />
        </div>

        <nav v-show="!state.moreOpen && !state.adminForm" class="nut-mobile-tabs" :class="navClass" aria-label="主导航">
          <button aria-label="首页" :class="{ active: state.view === 'dashboard' }" @click="switchView('dashboard')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.8 12 4l8 6.8V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>
          </button>
          <button aria-label="授权" :class="{ active: state.view === 'grants' }" @click="switchView('grants')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5.2c0 4.4 2.9 8.2 7 9.8 4.1-1.6 7-5.4 7-9.8V6z" /></svg>
          </button>
          <button aria-label="会话" :class="{ active: state.view === 'sessions' }" @click="switchView('sessions')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-4l-4 3v-3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z" /></svg>
          </button>
          <button aria-label="账号" :class="{ active: state.view === 'account' }" @click="switchView('account')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8a7 7 0 0 1 14 0z" /></svg>
          </button>
          <button v-if="state.user?.isAdmin" aria-label="管理" :class="{ active: ['users', 'clients', 'smtp', 'audit'].includes(state.view) }" @click="state.moreOpen = true">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h6v6H5zm8 0h6v6h-6zM5 13h6v6H5zm8 0h6v6h-6z" /></svg>
          </button>
        </nav>

        <nut-popup v-model:visible="state.moreOpen" position="bottom" round closeable>
          <div class="nut-more-panel">
            <strong>管理</strong>
            <button v-for="item in adminItems" :key="item.view" @click="switchView(item.view)">{{ item.label }}</button>
            <button v-if="adminItems.length === 0" @click="switchView('account')">账号中心</button>
          </div>
        </nut-popup>

        <nut-popup v-model:visible="adminPopupVisible" position="bottom" round closeable @click-overlay="closeAdminForm" @click-close-icon="closeAdminForm">
          <div class="nut-admin-form">
            <strong v-if="state.adminForm === 'user-create'">新增用户</strong>
            <strong v-if="state.adminForm === 'user-edit'">编辑用户</strong>
            <strong v-if="state.adminForm === 'user-password'">重置密码</strong>
            <strong v-if="state.adminForm === 'account-password'">修改密码</strong>
            <strong v-if="state.adminForm === 'client-create'">创建应用</strong>
            <strong v-if="state.adminForm === 'client-edit'">编辑应用</strong>
            <strong v-if="state.adminForm === 'client-config'">接入配置</strong>
            <strong v-if="state.adminForm === 'client-secret'">Client Secret</strong>
            <strong v-if="state.adminForm === 'smtp'">邮件设置</strong>

            <form v-if="state.adminForm === 'user-create' || state.adminForm === 'user-edit'" @submit.prevent="runAction(() => submitMobileUser($event))">
              <label>用户名<input name="username" :value="state.adminFormData.username || ''" required /></label>
              <label>邮箱<input name="email" type="email" :value="state.adminFormData.email || ''" required /></label>
              <label>显示名称<input name="displayName" :value="state.adminFormData.displayName || ''" /></label>
              <label v-if="state.adminForm === 'user-create'">密码<input name="password" type="password" minlength="6" required /></label>
              <label class="nut-check"><input name="admin" type="checkbox" :checked="Boolean(state.adminFormData.admin)" /> 管理员</label>
              <label class="nut-check"><input name="active" type="checkbox" :checked="state.adminFormData.active !== false" /> 启用</label>
              <div class="nut-form-actions"><button type="button" class="nut-form-button ghost" @click="closeAdminForm">取消</button><button type="submit" class="nut-form-button primary">保存</button></div>
            </form>

            <form v-if="state.adminForm === 'user-password'" @submit.prevent="runAction(() => resetMobileUserPassword($event))">
              <label>新密码<input name="password" type="password" minlength="6" required /></label>
              <label>确认新密码<input name="confirmPassword" type="password" minlength="6" required /></label>
              <div class="nut-form-actions"><button type="button" class="nut-form-button ghost" @click="closeAdminForm">取消</button><button type="submit" class="nut-form-button primary">保存</button></div>
            </form>

            <form v-if="state.adminForm === 'account-password'" @submit.prevent="runAction(() => submitMobileAccountPassword($event))">
              <label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required /></label>
              <label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="6" required /></label>
              <label>确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required /></label>
              <div class="nut-form-actions"><button type="button" class="nut-form-button ghost" @click="closeAdminForm">取消</button><button type="submit" class="nut-form-button primary">保存</button></div>
            </form>

            <form v-if="state.adminForm === 'client-create' || state.adminForm === 'client-edit'" @submit.prevent="runAction(() => submitMobileClient($event))">
              <label>应用 ID<input name="id" :value="state.adminFormData.id || ''" :readonly="state.adminForm === 'client-edit'" required /></label>
              <label>应用名称<input name="name" :value="state.adminFormData.name || ''" required /></label>
              <label>回调地址<textarea name="redirectUris" required>{{ (state.adminFormData.redirectUris || []).join('\\n') }}</textarea></label>
              <label>Scope<input name="allowedScopes" :value="(state.adminFormData.allowedScopes || ['openid','profile','email','sub']).join(' ')" required /></label>
              <label v-if="state.adminForm === 'client-create'" class="nut-check"><input name="confidential" type="checkbox" :checked="state.adminFormData.confidential !== false" /> 生成 client secret</label>
              <label class="nut-check"><input name="pkceRequired" type="checkbox" :checked="state.adminFormData.pkceRequired !== false" /> 强制 PKCE</label>
              <div class="nut-form-actions"><button type="button" class="nut-form-button ghost" @click="closeAdminForm">取消</button><button type="submit" class="nut-form-button primary">保存</button></div>
            </form>

            <div v-if="state.adminForm === 'client-config' || state.adminForm === 'client-secret'" class="nut-config-list">
              <p @click="copyConfigValue(state.adminFormData.id)"><b>Client ID</b><code>{{ state.adminFormData.id }}</code></p>
              <p v-if="state.adminFormData.confidential" @click="runAction(revealMobileClientSecret)"><b>Client Secret</b><code>{{ state.revealedSecret || (state.adminFormData.secretRevealable ? '********' : '旧应用需先轮换密钥') }}</code></p>
              <p @click="copyConfigValue(origin)"><b>Issuer</b><code>{{ origin }}</code></p>
              <p @click="copyConfigValue(origin + '/oauth/authorize')"><b>Authorize</b><code>{{ origin }}/oauth/authorize</code></p>
              <p @click="copyConfigValue(origin + '/oauth/token')"><b>Token</b><code>{{ origin }}/oauth/token</code></p>
              <p @click="copyConfigValue(origin + '/oauth/userinfo')"><b>UserInfo</b><code>{{ origin }}/oauth/userinfo</code></p>
              <p @click="copyConfigValue((state.adminFormData.redirectUris || [])[0] || '')"><b>Redirect URI</b><code>{{ (state.adminFormData.redirectUris || [])[0] || '-' }}</code></p>
              <div class="nut-form-actions single"><button type="button" class="nut-form-button primary" @click="closeAdminForm">关闭</button></div>
            </div>

            <form v-if="state.adminForm === 'smtp'" @submit.prevent="runAction(() => submitMobileSmtp($event))">
              <label>发送通道<select name="provider" v-model="state.adminFormData.provider"><option value="resend">Resend API</option><option value="smtp">SMTP</option></select></label>
              <label>发件邮箱<input name="fromEmail" type="email" :value="state.adminFormData.resend?.fromEmail || state.adminFormData.smtp?.fromEmail || 'noreply@example.com'" required /></label>
              <label>发件名称<input name="fromName" :value="state.adminFormData.resend?.fromName || state.adminFormData.smtp?.fromName || '统一登陆平台'" required /></label>
              <template v-if="state.adminFormData.provider === 'smtp'">
                <label>SMTP 主机<input name="host" :value="state.adminFormData.smtp?.host || ''" required /></label>
                <label>端口<input name="port" type="number" :value="state.adminFormData.smtp?.port || 465" required /></label>
                <label>加密方式<select name="secureMode"><option value="ssl" :selected="state.adminFormData.smtp?.secureMode !== 'starttls'">SSL/TLS</option><option value="starttls" :selected="state.adminFormData.smtp?.secureMode === 'starttls'">STARTTLS</option></select></label>
                <label>用户名<input name="username" :value="state.adminFormData.smtp?.username || ''" required /></label>
                <label>密码/授权码<input name="password" type="password" placeholder="已配置时可留空" /></label>
              </template>
              <label>测试邮箱<input name="testEmail" type="email" /></label>
              <div class="nut-form-actions"><button type="button" class="nut-form-button ghost" @click="runAction(() => testMobileSmtp($event))">发送测试</button><button type="submit" class="nut-form-button primary">保存</button></div>
            </form>
          </div>
        </nut-popup>

        <div v-if="state.busyMessage" class="nut-mobile-busy" aria-live="polite">
          <div>
            <nut-loading type="spinner" color="#0f9f9a" />
            <span>{{ state.busyMessage }}</span>
          </div>
        </div>

        <div v-if="state.message" class="nut-mobile-toast" :class="state.messageType">{{ state.message }}</div>
      </div>
    `
  }).use(window.nutui.default ?? window.nutui).mount("#mobile-app");
})();
