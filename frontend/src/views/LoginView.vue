<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { ShieldCheck } from "lucide-vue-next";
import AppToast from "../components/AppToast.vue";
import { postJson, requestJson } from "../api";
import { appState, handleError, loadSystemSettings } from "../store";

const route = useRoute();
const busy = ref(false);
const loginClient = ref<{ id: string; name: string; logoUrl?: string | null } | null>(null);
const resolvedReturnTo = ref("");
const form = reactive({
  identifier: "",
  password: ""
});
const returnTo = computed(() => String(route.query.return_to || ""));
const clientId = computed(() => String(route.query.client_id || ""));
const loginDescription = computed(() =>
  loginClient.value ? `登录后将继续访问 ${loginClient.value.name}。` : "使用用户名或邮箱登录你的统一账号。"
);

onMounted(async () => {
  await loadSystemSettings().catch(handleError);
  if (!returnTo.value && !clientId.value) return;
  const result = await requestJson<{ client: { id: string; name: string; logoUrl?: string | null } | null; returnTo?: string | null }>(
    `/api/auth/login-context?return_to=${encodeURIComponent(returnTo.value)}&client_id=${encodeURIComponent(clientId.value)}`
  ).catch(() => ({ client: null, returnTo: null }));
  loginClient.value = result.client;
  resolvedReturnTo.value = result.returnTo || returnTo.value;
});

async function submit() {
  if (!form.identifier.trim()) throw new Error("请输入邮箱或用户名。");
  if (!form.password) throw new Error("请输入密码。");
  busy.value = true;
  try {
    const result = await postJson<{ redirectTo?: string }>("/api/login", {
      identifier: form.identifier.trim(),
      password: form.password,
      returnTo: resolvedReturnTo.value || returnTo.value || undefined
    });
    window.location.assign(result.redirectTo || "/dashboard");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-visual">
        <div class="auth-logo"><img :src="appState.system.logoUrl" alt="" /></div>
        <h1>{{ appState.system.siteName }}</h1>
        <p>统一登陆、OIDC 接入、账号与会话管理，在一个清爽的后台里完成。</p>
        <div class="auth-points">
          <span>用户名/邮箱登录</span>
          <span>OIDC 标准接入</span>
          <span>后台集中管理</span>
        </div>
      </div>
      <form class="auth-form-panel" @submit.prevent="submit().catch(handleError)">
        <div class="auth-title-row">
          <span v-if="loginClient?.logoUrl" class="auth-title-icon has-image">
            <img :src="loginClient.logoUrl" alt="" />
          </span>
          <ShieldCheck v-else :size="30" />
          <h2>登录</h2>
        </div>
        <p>{{ loginDescription }}</p>
        <label>
          邮箱或用户名
          <input v-model="form.identifier" autocomplete="username" placeholder="请输入邮箱或用户名" />
        </label>
        <label>
          密码
          <input v-model="form.password" type="password" autocomplete="current-password" placeholder="请输入密码" />
        </label>
        <el-button type="primary" native-type="submit" :loading="busy" class="full-button">登录</el-button>
        <div class="auth-link-row">
          <RouterLink class="auth-sub-link" to="/forgot-password">忘记密码？</RouterLink>
          <RouterLink
            v-if="appState.system.registrationEnabled"
            class="auth-switch"
            :to="`/register${resolvedReturnTo || returnTo ? `?return_to=${encodeURIComponent(resolvedReturnTo || returnTo)}` : clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`"
          >
            没有账号？去注册
          </RouterLink>
        </div>
      </form>
    </section>
    <AppToast />
  </main>
</template>
