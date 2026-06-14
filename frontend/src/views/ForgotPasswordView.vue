<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { KeyRound } from "lucide-vue-next";
import AppToast from "../components/AppToast.vue";
import TurnstileWidget from "../components/TurnstileWidget.vue";
import { postJson, requestJson } from "../api";
import { handleError, toast } from "../store";
import type { PublicTurnstileSettings } from "../types";

const busy = ref(false);
const codeBusy = ref(false);
const cooldown = ref(0);
const turnstileSettings = ref<PublicTurnstileSettings | null>(null);
const turnstileToken = ref("");
const turnstileWidget = ref<InstanceType<typeof TurnstileWidget> | null>(null);
let timer = 0;
const form = reactive({
  email: "",
  code: "",
  password: "",
  confirmPassword: ""
});
const showTurnstile = computed(() => turnstileSettings.value?.enabled && turnstileSettings.value.enableOnPasswordReset);

onMounted(async () => {
  turnstileSettings.value = await requestJson<PublicTurnstileSettings>("/api/public/turnstile").catch(() => null);
});

function handleTurnstileVerify(token: string) {
  turnstileToken.value = token;
}

function validateEmail() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
}

function validateReset() {
  validateEmail();
  if (!/^\d{6}$/.test(form.code.trim())) throw new Error("请输入 6 位数字验证码。");
  if (form.password.length < 6) throw new Error("密码至少需要 6 位。");
  if (form.password !== form.confirmPassword) throw new Error("两次输入的新密码不一致。");
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
  validateEmail();

  // 检查 Turnstile
  if (showTurnstile.value && !turnstileToken.value) {
    throw new Error("请完成人机验证。");
  }

  codeBusy.value = true;
  try {
    const result = await postJson<{ expiresIn?: number }>("/api/auth/password/reset/start", {
      email: form.email.trim(),
      turnstileToken: turnstileToken.value || undefined
    });
    toast("如果邮箱存在，验证码会发送到该邮箱。");
    startCooldown(result.expiresIn || 60);
  } catch (error) {
    // 重置 Turnstile
    if (turnstileWidget.value) {
      turnstileWidget.value.reset();
      turnstileToken.value = "";
    }
    throw error;
  } finally {
    codeBusy.value = false;
  }
}

async function submit() {
  validateReset();
  busy.value = true;
  try {
    await postJson("/api/auth/password/reset/verify", {
      email: form.email.trim(),
      code: form.code.trim(),
      password: form.password
    });
    toast("密码已重置，请使用新密码登录。");
    window.setTimeout(() => window.location.assign("/login"), 600);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-card">
      <div class="auth-visual">
        <div class="auth-logo"><img src="/brand.svg" alt="" /></div>
        <h1>找回密码</h1>
        <p>通过邮箱验证码验证身份，重置你的统一账号密码。</p>
        <div class="auth-points">
          <span>邮箱验证</span>
          <span>重置密码</span>
          <span>会话失效</span>
        </div>
      </div>
      <form class="auth-form-panel" @submit.prevent="submit().catch(handleError)">
        <div class="auth-title-row">
          <KeyRound :size="30" />
          <h2>重置密码</h2>
        </div>
        <p>输入账号邮箱，获取验证码后设置新密码。</p>
        <label>
          邮箱
          <input v-model="form.email" type="email" autocomplete="email" placeholder="请输入账号邮箱" />
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

        <TurnstileWidget
          v-if="showTurnstile"
          ref="turnstileWidget"
          :site-key="turnstileSettings?.siteKey || ''"
          @verify="handleTurnstileVerify"
        />

        <label>
          新密码
          <input v-model="form.password" type="password" autocomplete="new-password" placeholder="请输入至少 6 位新密码" />
        </label>
        <label>
          确认新密码
          <input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" />
        </label>
        <el-button type="primary" native-type="submit" :loading="busy" class="full-button">重置密码</el-button>
        <RouterLink class="auth-switch" to="/login">想起密码？去登录</RouterLink>
      </form>
    </section>
    <AppToast />
  </main>
</template>
