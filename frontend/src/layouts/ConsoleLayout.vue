<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import {
  AppWindow,
  ClipboardCheck,
  Gauge,
  History,
  KeyRound,
  LogOut,
  MonitorCheck,
  Settings,
  ShieldCheck,
  UserCog,
  Users
} from "lucide-vue-next";
import AppLoading from "../components/AppLoading.vue";
import AppToast from "../components/AppToast.vue";
import { apiBase } from "../api";
import { appState, handleError, loadSystemSettings } from "../store";
import { avatarText, displayName } from "../utils/format";

const route = useRoute();

const title = computed(() => String(route.meta.title || "仪表盘"));
const subtitle = computed(() => String(route.meta.subtitle || "用一个账号连接所有已接入应用。"));
const navItems = computed(() =>
  [
    { path: "/dashboard", label: "仪表盘", icon: Gauge },
    { path: "/grants", label: "授权应用", icon: ShieldCheck },
    { path: "/sessions", label: "登录会话", icon: MonitorCheck },
    { path: "/account", label: "账号中心", icon: KeyRound },
    { path: "/client-profiles", label: "应用身份", icon: UserCog },
    { path: "/users", label: "用户管理", icon: Users, admin: true },
    { path: "/clients", label: "应用接入", icon: AppWindow, admin: true },
    { path: "/settings", label: "系统配置", icon: Settings, admin: true },
    { path: "/audit", label: "审计日志", icon: History, admin: true }
  ].filter((item) => !item.admin || appState.user?.isAdmin)
);

const bottomItems = computed(() => navItems.value.filter((item) => ["/dashboard", "/grants", "/sessions", "/account", "/client-profiles"].includes(item.path)));
const adminBottomVisible = computed(() => Boolean(appState.user?.isAdmin));
const activeAdmin = computed(() => ["/users", "/clients", "/settings", "/audit"].includes(route.path));
const ready = computed(() => appState.checked && Boolean(appState.user));

onMounted(() => {
  loadSystemSettings().catch(handleError);
});

function logout() {
  window.location.assign(`${apiBase}/oauth/logout`);
}

</script>

<template>
  <div class="console-shell">
    <aside class="console-sidebar">
      <div class="console-brand">
        <span class="console-logo"><img :src="appState.system.logoUrl" alt="" /></span>
        <span>
          <strong>{{ appState.system.siteName }}</strong>
          <small>sso.aiku.qzz.io</small>
        </span>
      </div>
      <nav class="console-nav">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="console-nav-item">
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <el-button text class="sidebar-logout" @click="logout">
        <LogOut :size="17" />
        退出登录
      </el-button>
    </aside>

    <section class="console-content">
      <header class="console-topbar">
        <div>
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </div>
        <div class="console-user">
          <span class="user-avatar">
            <img v-if="appState.user?.avatarUrl" :src="appState.user.avatarUrl" alt="" />
            <template v-else>{{ avatarText(displayName(appState.user)) }}</template>
          </span>
          <span>{{ displayName(appState.user) }}</span>
          <el-button text circle class="desktop-only" aria-label="退出登录" @click="logout">
            <LogOut :size="17" />
          </el-button>
        </div>
      </header>

      <main class="console-main">
        <AppLoading v-if="!ready" />
        <RouterView v-else />
      </main>
    </section>

    <nav v-if="ready && !appState.modalOpen" class="mobile-tabbar" aria-label="移动端导航">
      <RouterLink v-for="item in bottomItems" :key="item.path" :to="item.path" :aria-label="item.label">
        <component :is="item.icon" :size="21" />
      </RouterLink>
      <RouterLink v-if="adminBottomVisible" to="/clients" :class="{ 'router-link-active': activeAdmin }" aria-label="管理">
        <ClipboardCheck :size="21" />
      </RouterLink>
    </nav>

    <AppToast />
  </div>
</template>
