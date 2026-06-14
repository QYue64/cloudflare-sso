<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { BadgeCheck, CalendarDays, IdCard, KeyRound, LogOut, Mail, Pencil, ShieldCheck, UserRound, VenusAndMars } from "lucide-vue-next";
import AppModal from "../components/AppModal.vue";
import TurnstileWidget from "../components/TurnstileWidget.vue";
import FormActions from "../components/FormActions.vue";
import { apiBase, postJson, requestJson } from "../api";
import { appState, handleError, loadMe, toast } from "../store";
import { avatarText, displayName, genderLabel } from "../utils/format";
import type { PublicTurnstileSettings } from "../types";

const modalOpen = ref(false);
const emailOpen = ref(false);
const profileOpen = ref(false);
const busy = ref(false);
const emailBusy = ref(false);
const profileBusy = ref(false);
const codeBusy = ref(false);
const cooldown = ref(0);
const turnstileSettings = ref<PublicTurnstileSettings | null>(null);
const turnstileToken = ref("");
const turnstileWidget = ref<InstanceType<typeof TurnstileWidget> | null>(null);
let cooldownTimer = 0;
const form = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});
const emailForm = reactive({
  email: "",
  code: ""
});
const profileForm = reactive({
  displayName: "",
  nickname: "",
  gender: "",
  birthday: "",
  avatarUrl: ""
});
const showTurnstile = computed(() => turnstileSettings.value?.enabled && turnstileSettings.value.enableOnEmailChange);

onMounted(async () => {
  turnstileSettings.value = await requestJson<PublicTurnstileSettings>("/api/public/turnstile").catch(() => null);
});

function handleTurnstileVerify(token: string) {
  turnstileToken.value = token;
}

const profileTitle = computed(() => {
  const user = appState.user;
  if (!user) return "-";
  return user.nickname || user.displayName || user.username || "未设置昵称";
});
const profileSubtitle = computed(() => {
  const user = appState.user;
  if (!user) return "";
  return user.username ? `@${user.username}` : user.email;
});
const avatarSource = computed(() => appState.user?.avatarUrl || "");

function logout() {
  window.location.assign(`${apiBase}/oauth/logout`);
}

function openEmailModal() {
  Object.assign(emailForm, { email: "", code: "" });
  emailOpen.value = true;
}

function openProfileModal() {
  Object.assign(profileForm, {
    displayName: appState.user?.displayName || "",
    nickname: appState.user?.nickname || "",
    gender: appState.user?.gender || "",
    birthday: appState.user?.birthday || "",
    avatarUrl: appState.user?.avatarUrl || ""
  });
  profileOpen.value = true;
}

function validateEmail() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailForm.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
  if (emailForm.email.trim().toLowerCase() === appState.user?.email.toLowerCase()) {
    throw new Error("新邮箱不能和当前邮箱相同。");
  }
}

function startCooldown(seconds: number) {
  window.clearInterval(cooldownTimer);
  cooldown.value = Math.min(seconds || 60, 60);
  cooldownTimer = window.setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0) window.clearInterval(cooldownTimer);
  }, 1000);
}

async function submitPassword() {
  if (form.newPassword.length < 6) throw new Error("新密码至少需要 6 位。");
  if (form.newPassword !== form.confirmPassword) throw new Error("两次输入的新密码不一致。");
  busy.value = true;
  try {
    await postJson("/api/account/password", {
      currentPassword: form.currentPassword,
      newPassword: form.newPassword
    });
    modalOpen.value = false;
    toast("密码已更新，其他设备已注销");
  } finally {
    busy.value = false;
  }
}

async function sendEmailCode() {
  validateEmail();

  // 检查 Turnstile
  if (showTurnstile.value && !turnstileToken.value) {
    throw new Error("请完成人机验证。");
  }

  codeBusy.value = true;
  try {
    const result = await postJson<{ expiresIn?: number }>("/api/account/email/start", {
      email: emailForm.email.trim(),
      turnstileToken: turnstileToken.value || undefined
    });
    toast("验证码已发送，请查看新邮箱。");
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

async function submitEmail() {
  validateEmail();
  if (!/^\d{6}$/.test(emailForm.code.trim())) throw new Error("请输入 6 位数字验证码。");
  emailBusy.value = true;
  try {
    await postJson("/api/account/email/verify", {
      email: emailForm.email.trim(),
      code: emailForm.code.trim()
    });
    await loadMe(true);
    emailOpen.value = false;
    toast("邮箱已更换");
  } finally {
    emailBusy.value = false;
  }
}

async function submitProfile() {
  if (profileForm.nickname.length > 80 || profileForm.displayName.length > 80) {
    throw new Error("昵称和显示名称最多 80 个字符。");
  }
  profileBusy.value = true;
  try {
    await postJson("/api/account/profile", {
      displayName: profileForm.displayName.trim(),
      nickname: profileForm.nickname.trim(),
      gender: profileForm.gender,
      birthday: profileForm.birthday,
      avatarUrl: profileForm.avatarUrl.trim()
    });
    await loadMe(true);
    profileOpen.value = false;
    toast("资料已更新");
  } finally {
    profileBusy.value = false;
  }
}
</script>

<template>
  <section class="page-stack">
    <section class="account-overview">
      <article class="account-profile-card">
        <div class="account-profile-main">
          <span class="user-avatar xl">
            <img v-if="avatarSource" :src="avatarSource" alt="" />
            <template v-else>{{ avatarText(displayName(appState.user)) }}</template>
          </span>
          <div>
            <span class="account-kicker">当前账号</span>
            <strong>{{ profileTitle }}</strong>
            <small>{{ profileSubtitle }} · {{ appState.user?.email }}</small>
          </div>
        </div>
        <div class="account-profile-meta">
          <span>{{ appState.user?.isAdmin ? "管理员账号" : "普通账号" }}</span>
          <span>{{ appState.user?.emailVerified ? "邮箱已验证" : "邮箱未验证" }}</span>
        </div>
      </article>

      <aside class="account-security-card">
        <div>
          <span class="account-kicker">安全设置</span>
          <strong>登录凭据</strong>
          <p>管理密码与邮箱，变更后会同步影响所有接入应用的登录身份。</p>
        </div>
        <div class="account-actions">
          <el-button type="primary" plain @click="openProfileModal">
            <IdCard :size="16" />
            编辑资料
          </el-button>
          <el-button type="primary" @click="modalOpen = true">
            <KeyRound :size="16" />
            修改密码
          </el-button>
          <el-button @click="openEmailModal">
            <Mail :size="16" />
            更换邮箱
          </el-button>
          <el-button type="danger" plain @click="logout">
            <LogOut :size="16" />
            退出登录
          </el-button>
        </div>
      </aside>
    </section>

    <div class="account-info-grid">
      <div>
        <span class="account-info-icon"><UserRound :size="18" /></span>
        <div>
          <span>昵称</span>
          <strong>{{ appState.user?.nickname || "未设置" }}</strong>
        </div>
      </div>
      <div>
        <span class="account-info-icon"><UserRound :size="18" /></span>
        <div>
          <span>用户名</span>
          <strong>{{ appState.user?.username || "-" }}</strong>
        </div>
      </div>
      <div>
        <span class="account-info-icon"><VenusAndMars :size="18" /></span>
        <div>
          <span>性别</span>
          <strong>{{ genderLabel(appState.user?.gender) }}</strong>
        </div>
      </div>
      <div>
        <span class="account-info-icon"><CalendarDays :size="18" /></span>
        <div>
          <span>生日</span>
          <strong>{{ appState.user?.birthday || "-" }}</strong>
        </div>
      </div>
      <div>
        <span class="account-info-icon"><BadgeCheck :size="18" /></span>
        <div>
          <span>邮箱状态</span>
          <strong>{{ appState.user?.emailVerified ? "已验证" : "未验证" }}</strong>
        </div>
      </div>
      <div>
        <span class="account-info-icon"><ShieldCheck :size="18" /></span>
        <div>
          <span>账号角色</span>
          <strong>{{ appState.user?.isAdmin ? "管理员" : "普通用户" }}</strong>
        </div>
      </div>
    </div>

    <AppModal v-model="profileOpen" title="编辑资料" wide>
      <form class="modal-form two-col" @submit.prevent="submitProfile().catch(handleError)">
        <label>昵称<input v-model="profileForm.nickname" maxlength="80" placeholder="请输入昵称" /></label>
        <label>显示名称<input v-model="profileForm.displayName" maxlength="80" placeholder="用于 OIDC name 字段" /></label>
        <label>性别
          <select v-model="profileForm.gender">
            <option value="">未设置</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
            <option value="unknown">不透露</option>
          </select>
        </label>
        <label>生日<input v-model="profileForm.birthday" type="date" placeholder="请选择生日" /></label>
        <label class="span-two">头像 URL<input v-model="profileForm.avatarUrl" type="url" placeholder="https://example.com/avatar.png" /></label>
        <FormActions class="span-two" :busy="profileBusy" @cancel="profileOpen = false" />
      </form>
    </AppModal>

    <AppModal v-model="modalOpen" title="修改密码">
      <form class="modal-form" @submit.prevent="submitPassword().catch(handleError)">
        <label>当前密码<input v-model="form.currentPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" /></label>
        <label>新密码<input v-model="form.newPassword" type="password" autocomplete="new-password" placeholder="请输入至少 6 位新密码" /></label>
        <label>确认新密码<input v-model="form.confirmPassword" type="password" autocomplete="new-password" placeholder="请再次输入新密码" /></label>
        <FormActions :busy="busy" @cancel="modalOpen = false" />
      </form>
    </AppModal>

    <AppModal v-model="emailOpen" title="更换邮箱">
      <form class="modal-form" @submit.prevent="submitEmail().catch(handleError)">
        <label>新邮箱<input v-model="emailForm.email" type="email" autocomplete="email" placeholder="请输入新的邮箱地址" /></label>
        <div class="code-row">
          <label>
            验证码
            <input v-model="emailForm.code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码" />
          </label>
          <el-button type="primary" plain :disabled="codeBusy || cooldown > 0" :loading="codeBusy" @click="sendEmailCode().catch(handleError)">
            {{ cooldown > 0 ? `${cooldown} 秒` : codeBusy ? "发送中" : "发送验证码" }}
          </el-button>
        </div>

        <TurnstileWidget
          v-if="showTurnstile"
          ref="turnstileWidget"
          :site-key="turnstileSettings?.siteKey || ''"
          @verify="handleTurnstileVerify"
        />

        <FormActions :busy="emailBusy" submit-text="确认更换" @cancel="emailOpen = false" />
      </form>
    </AppModal>
  </section>
</template>
