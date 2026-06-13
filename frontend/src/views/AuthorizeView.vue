<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { Check, X } from "lucide-vue-next";
import AppLoading from "../components/AppLoading.vue";
import AppToast from "../components/AppToast.vue";
import AppModal from "../components/AppModal.vue";
import FormActions from "../components/FormActions.vue";
import { ApiError, postJson, requestJson } from "../api";
import { avatarText } from "../utils/format";
import { handleError, toast } from "../store";

interface AuthContext {
  user: { username?: string; displayName?: string; nickname?: string; email?: string; avatarUrl?: string | null; emailVerified?: boolean };
  client: { id: string; name: string; logoUrl?: string | null; appUrl?: string | null; scopes: string[] };
  clientProfile?: {
    username?: string | null;
    email?: string | null;
    nickname?: string | null;
    avatarUrl?: string | null;
    emailVerified?: boolean;
  } | null;
}

const route = useRoute();
const loading = ref(true);
const busy = ref(false);
const profileOpen = ref(false);
const verifyOpen = ref(false);
const profileBusy = ref(false);
const codeBusy = ref(false);
const cooldown = ref(0);
const context = ref<AuthContext | null>(null);
const profileForm = reactive({
  username: "",
  email: "",
  nickname: "",
  avatarUrl: ""
});
const verifyForm = reactive({
  email: "",
  code: ""
});
let cooldownTimer = 0;
const request = computed(() => String(route.query.request || ""));
const scopeMap: Record<string, [string, string]> = {
  openid: ["身份标识", "确认你的唯一用户 ID，这是登录所必需的。"],
  profile: ["基本资料", "读取用户名、显示名称等基础账号信息。"],
  email: ["邮箱信息", "读取邮箱地址和邮箱验证状态。"],
  sub: ["用户 ID", "读取统一登陆平台内的稳定用户标识。"]
};

const userName = computed(() => context.value?.user.nickname || context.value?.user.displayName || context.value?.user.username || context.value?.user.email || "当前账号");

function openExternal(url?: string | null) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function openProfileModal() {
  const profile = context.value?.clientProfile;
  const user = context.value?.user;
  Object.assign(profileForm, {
    username: profile?.username || user?.username || "",
    email: profile?.email || user?.email || "",
    nickname: profile?.nickname || user?.nickname || user?.displayName || user?.username || "",
    avatarUrl: profile?.avatarUrl || user?.avatarUrl || ""
  });
  profileOpen.value = true;
}

function startCooldown(seconds: number) {
  window.clearInterval(cooldownTimer);
  cooldown.value = Math.min(seconds || 60, 60);
  cooldownTimer = window.setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) window.clearInterval(cooldownTimer);
  }, 1000);
}

async function loadContext() {
  loading.value = true;
  try {
    context.value = await requestJson<AuthContext>(`/api/oauth/authorize/context?request=${encodeURIComponent(request.value)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      window.location.assign(`/login?return_to=${encodeURIComponent(`/authorize?request=${request.value}`)}`);
      return;
    }
    throw error;
  } finally {
    loading.value = false;
  }
}

async function decide(endpoint: string) {
  busy.value = true;
  try {
    const result = await postJson<{ redirectTo: string }>(endpoint, { request: request.value });
    window.location.assign(result.redirectTo);
  } finally {
    busy.value = false;
  }
}

async function submitClientProfile() {
  if (!context.value) return;
  if (profileForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
  const nextEmail = profileForm.email.trim().toLowerCase();
  const mainEmail = context.value.user.email?.toLowerCase() || "";
  const currentEmail = context.value.clientProfile?.email?.toLowerCase() || mainEmail;
  const emailAlreadyVerified =
    nextEmail === mainEmail ||
    (nextEmail === currentEmail && Boolean(context.value.clientProfile?.emailVerified));
  if (nextEmail && nextEmail !== mainEmail && !emailAlreadyVerified) {
    Object.assign(verifyForm, { email: profileForm.email.trim(), code: "" });
    verifyOpen.value = true;
    return;
  }
  profileBusy.value = true;
  try {
    await postJson(`/api/account/client-profiles/${encodeURIComponent(context.value.client.id)}`, {
      username: profileForm.username.trim(),
      email: profileForm.email.trim(),
      nickname: profileForm.nickname.trim(),
      avatarUrl: profileForm.avatarUrl.trim()
    });
    await loadContext();
    profileOpen.value = false;
    toast("应用身份已保存");
  } finally {
    profileBusy.value = false;
  }
}

async function sendEmailCode() {
  if (!context.value) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifyForm.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
  codeBusy.value = true;
  try {
    const result = await postJson<{ expiresIn?: number }>(
      `/api/account/client-profiles/${encodeURIComponent(context.value.client.id)}/email/start`,
      { email: verifyForm.email.trim() }
    );
    toast("验证码已发送，请查看应用邮箱。");
    startCooldown(result.expiresIn || 60);
  } finally {
    codeBusy.value = false;
  }
}

async function verifyEmailAndSave() {
  if (!context.value) return;
  if (!/^\d{6}$/.test(verifyForm.code.trim())) throw new Error("请输入 6 位数字验证码。");
  profileBusy.value = true;
  try {
    await postJson(`/api/account/client-profiles/${encodeURIComponent(context.value.client.id)}/email/verify`, {
      email: verifyForm.email.trim(),
      code: verifyForm.code.trim()
    });
    await postJson(`/api/account/client-profiles/${encodeURIComponent(context.value.client.id)}`, {
      username: profileForm.username.trim(),
      email: verifyForm.email.trim(),
      nickname: profileForm.nickname.trim(),
      avatarUrl: profileForm.avatarUrl.trim()
    });
    await loadContext();
    verifyOpen.value = false;
    profileOpen.value = false;
    toast("应用身份已保存，邮箱已验证");
  } finally {
    profileBusy.value = false;
  }
}

onMounted(() => {
  loadContext().catch(handleError);
});
</script>

<template>
  <main class="consent-shell">
    <AppLoading v-if="loading" />
    <section v-else-if="context" class="consent-card">
      <header class="consent-top">
        <div class="consent-brand"><span>SSO</span><strong>统一登陆平台</strong></div>
        <span class="consent-account">{{ userName }}</span>
      </header>
      <div class="consent-hero">
        <button
          type="button"
          class="consent-app-link"
          :class="{ linkable: Boolean(context.client.appUrl) }"
          :disabled="!context.client.appUrl"
          @click="openExternal(context.client.appUrl)"
        >
          <span class="consent-app-icon" :class="{ 'has-image': Boolean(context.client.logoUrl) }">
          <img v-if="context.client.logoUrl" :src="context.client.logoUrl" alt="" />
          <template v-else>{{ avatarText(context.client.name) }}</template>
          </span>
        </button>
        <h1>{{ context.client.name }}</h1>
        <p>请求访问你的统一登陆平台账号</p>
        <button v-if="context.client.appUrl" type="button" class="text-link-button" @click="openExternal(context.client.appUrl)">访问应用网站</button>
      </div>
      <div class="consent-user-card">
        <span class="user-avatar large">
          <img v-if="context.user.avatarUrl" :src="context.user.avatarUrl" alt="" />
          <template v-else>{{ avatarText(userName) }}</template>
        </span>
        <div>
          <strong>{{ userName }}</strong>
          <span>{{ context.user.email ? `以 ${context.user.email} 的身份授权${context.user.emailVerified ? '' : '，邮箱未验证'}` : "当前统一登陆平台账号" }}</span>
        </div>
        <el-button size="small" plain @click="openProfileModal">配置应用身份</el-button>
      </div>
      <section class="permission-panel">
        <h2>将获得以下权限</h2>
        <div v-for="scope in context.client.scopes" :key="scope" class="permission-item">
          <span>{{ avatarText(scopeMap[scope]?.[0] || scope) }}</span>
          <div>
            <strong>{{ scopeMap[scope]?.[0] || scope }}</strong>
            <small>{{ scopeMap[scope]?.[1] || "该应用请求访问此权限范围。" }}</small>
          </div>
        </div>
      </section>
      <div class="consent-actions">
        <el-button type="primary" :loading="busy" @click="decide('/api/oauth/authorize/confirm').catch(handleError)">
          <Check :size="17" />
          允许
        </el-button>
        <el-button :disabled="busy" @click="decide('/api/oauth/authorize/deny').catch(handleError)">
          <X :size="17" />
          拒绝
        </el-button>
      </div>
    </section>
    <AppModal v-model="profileOpen" title="配置本应用身份" wide>
      <form class="modal-form two-col" @submit.prevent="submitClientProfile().catch(handleError)">
        <label>应用用户名<input v-model="profileForm.username" maxlength="64" placeholder="请输入该应用看到的用户名" /></label>
        <label>应用邮箱<input v-model="profileForm.email" type="email" autocomplete="email" placeholder="请输入该应用看到的邮箱" /></label>
        <label>昵称<input v-model="profileForm.nickname" maxlength="80" placeholder="该应用看到的昵称" /></label>
        <label class="span-two">头像 URL<input v-model="profileForm.avatarUrl" type="url" placeholder="请输入该应用看到的头像地址" /></label>
        <FormActions class="span-two" :busy="profileBusy" @cancel="profileOpen = false" />
      </form>
    </AppModal>
    <AppModal v-model="verifyOpen" title="验证应用邮箱">
      <form class="modal-form" @submit.prevent="verifyEmailAndSave().catch(handleError)">
        <p class="modal-hint">该邮箱和主账号邮箱不同，需要先验证后才能保存给应用使用。</p>
        <label>应用邮箱<input v-model="verifyForm.email" type="email" readonly /></label>
        <div class="code-row">
          <label>
            验证码
            <input v-model="verifyForm.code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="请输入 6 位验证码" />
          </label>
          <el-button type="primary" plain :disabled="codeBusy || cooldown > 0" :loading="codeBusy" @click.prevent="sendEmailCode().catch(handleError)">
            {{ cooldown > 0 ? `${cooldown} 秒` : codeBusy ? "发送中" : "发送验证码" }}
          </el-button>
        </div>
        <div class="form-actions">
          <el-button @click="verifyOpen = false">返回修改</el-button>
          <el-button type="primary" native-type="submit" :loading="profileBusy">验证并保存</el-button>
        </div>
      </form>
    </AppModal>
    <AppToast />
  </main>
</template>
