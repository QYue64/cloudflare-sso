import { createRouter, createWebHistory } from "vue-router";
import ConsoleLayout from "../layouts/ConsoleLayout.vue";
import LoginView from "../views/LoginView.vue";
import RegisterView from "../views/RegisterView.vue";
import ForgotPasswordView from "../views/ForgotPasswordView.vue";
import AuthorizeView from "../views/AuthorizeView.vue";
import DashboardView from "../views/DashboardView.vue";
import GrantsView from "../views/GrantsView.vue";
import SessionsView from "../views/SessionsView.vue";
import AccountView from "../views/AccountView.vue";
import ClientProfilesView from "../views/ClientProfilesView.vue";
import UsersView from "../views/UsersView.vue";
import ClientsView from "../views/ClientsView.vue";
import SettingsView from "../views/SettingsView.vue";
import AuditView from "../views/AuditView.vue";
import { loadMe } from "../store";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/login", component: LoginView, meta: { public: true } },
    { path: "/register", component: RegisterView, meta: { public: true } },
    { path: "/forgot-password", component: ForgotPasswordView, meta: { public: true } },
    { path: "/authorize", component: AuthorizeView, meta: { public: true } },
    {
      path: "/",
      component: ConsoleLayout,
      children: [
        { path: "dashboard", component: DashboardView, meta: { title: "仪表盘", subtitle: "查看账号概览和最近活动。" } },
        { path: "grants", component: GrantsView, meta: { title: "授权应用", subtitle: "管理已授权的应用和权限范围。" } },
        { path: "sessions", component: SessionsView, meta: { title: "登录会话", subtitle: "查看和管理所有登录设备和会话。" } },
        { path: "account", component: AccountView, meta: { title: "账号中心", subtitle: "管理个人资料、密码和邮箱等账号信息。" } },
        { path: "client-profiles", component: ClientProfilesView, meta: { title: "应用身份", subtitle: "为每个应用单独配置用户名、邮箱、昵称和头像，不影响 SSO 主账号。" } },
        { path: "users", component: UsersView, meta: { title: "用户管理", subtitle: "管理系统用户和权限。", admin: true } },
        { path: "clients", component: ClientsView, meta: { title: "应用接入", subtitle: "管理已接入的 OIDC 应用和客户端配置。", admin: true } },
        { path: "settings", component: SettingsView, meta: { title: "系统配置", subtitle: "配置系统设置、邮件服务和全局选项。", admin: true } },
        { path: "smtp", redirect: "/settings" },
        { path: "audit", component: AuditView, meta: { title: "审计日志", subtitle: "查看系统操作记录和安全审计日志。", admin: true } }
      ]
    },
    { path: "/:pathMatch(.*)*", redirect: "/dashboard" }
  ]
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  const user = await loadMe();
  if (!user) {
    return {
      path: "/login",
      query: { return_to: to.fullPath }
    };
  }

  if (to.meta.admin && !user.isAdmin) {
    return "/dashboard";
  }

  return true;
});

export default router;
