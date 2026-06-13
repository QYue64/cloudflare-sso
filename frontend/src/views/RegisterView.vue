<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { UserPlus } from "lucide-vue-next";
import AppToast from "../components/AppToast.vue";
import { postJson, requestJson } from "../api";
import { appState, handleError, loadSystemSettings, toast } from "../store";

const route = useRoute();
const busy = ref(false);
const codeBusy = ref(false);
const cooldown = ref(0);
const loginClient = ref<{ id: string; name: string; logoUrl?: string | null } | null>(null);
const resolvedReturnTo = ref("");
let timer = 0;
const form = reactive({
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
  code: ""
});
const returnTo = computed(() => String(route.query.return_to || ""));
const clientId = computed(() => String(route.query.client_id || ""));
const registerDescription = computed(() =>
  loginClient.value ? `注册后将继续访问 ${loginClient.value.name}。` : "填写邮箱后发送验证码完成注册。"
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

function validate(requireCode: boolean) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(form.username.trim())) {
    throw new Error("用户名需为 3-32 位字母、数字、下划线或短横线，且必须以字母或数字开头。");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error("请输入有效邮箱地址。");
  if (form.password.length < 6) throw new Error("密码至少需要 6 位。");
  if (form.password !== form.confirmPassword) throw new Error("两次输入的密码不一致。");
  if (requireCode && !/^\d{6}$/.test(form.code.trim())) throw new Error("请输入 6 位数字验证码。");
}

function startCooldown(seconds: number) {
  window.clearInterval(timer);
  cooldown.value = Math.min(seconds || 60, 60);
  timer = window.setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) window.clearInterval(timer);
  }, 1000);
}

async function sendCode() {
  validate(false);
  codeBusy.value = true;
  try {
    const result = await postJson<{ expiresIn?: number }>("/api/auth/email/start", {
      username: form.username.trim(),
      email: form.email.trim()
    });
    toast("验证码已发送，请查看收件箱或垃圾邮件。");
    startCooldown(result.expiresIn || 60);
  } finally {
    codeBusy.value = false;
  }
}

async function submit() {
  validate(true);
  busy.value = true;
  try {
    const result = await postJson<{ redirectTo?: string }>("/api/auth/email/verify", {
      username: form.username.trim(),
      password: form.password,
      email: form.email.trim(),
      code: form.code.trim(),
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
        <h1>创建统一账号</h1>
        <p>注册后就可以使用同一账号访问所有接入统一登陆平台的业务系统。</p>
        <div class="auth-points">
          <span>邮箱验证码</span>
          <span>用户名登录</span>
          <span>授权可撤销</span>
        </div>
      </div>
      <form v-if="appState.system.registrationEnabled" class="auth-form-panel" @submit.prevent="submit().catch(handleError)">
        <div class="auth-title-row">
          <span v-if="loginClient?.logoUrl" class="auth-title-icon has-image">
            <img :src="loginClient.logoUrl" alt="" />
          </span>
          <UserPlus v-else :size="30" />
          <h2>注册</h2>
        </div>
        <p>{{ registerDescription }}</p>
        <label>
          用户名
          <input v-model="form.username" autocomplete="username" placeholder="请输入 3-32 位用户名" />
        </label>
        <label>
          邮箱
          <input v-model="form.email" type="email" autocomplete="email" placeholder="请输入邮箱地址" />
        </label>
        <label>
          密码
          <input v-model="form.password" type="password" autocomplete="new-password" placeholder="请输入至少 6 位密码" />
        </label>
        <label>
          确认密码
          <input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入密码" />
        </label>
        <div class="code-row">
          <label>
            验证码
            <input v-model="form.code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码" />
          </label>
          <el-button type="primary" plain :disabled="codeBusy || cooldown > 0" :loading="codeBusy" @click="sendCode().catch(handleError)">
            {{ cooldown > 0 ? `${cooldown} 秒` : codeBusy ? "发送中" : "发送验证码" }}
          </el-button>
        </div>
        <el-button type="primary" native-type="submit" :loading="busy" class="full-button">注册并登录</el-button>
        <RouterLink
          class="auth-switch"
          :to="`/login${resolvedReturnTo || returnTo ? `?return_to=${encodeURIComponent(resolvedReturnTo || returnTo)}` : clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`"
        >
          已有账号？去登录
        </RouterLink>
      </form>
      <div v-else class="auth-form-panel">
        <div class="auth-title-row">
          <UserPlus :size="30" />
          <h2>注册已关闭</h2>
        </div>
        <p>当前系统暂未开放自助注册，请联系管理员创建账号。</p>
        <RouterLink class="auth-switch" to="/login">已有账号？去登录</RouterLink>
      </div>
    </section>
    <AppToast />
  </main>
</template>
