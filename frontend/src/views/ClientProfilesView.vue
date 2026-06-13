<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { Pencil, Mail, Check, Clock } from "lucide-vue-next";
import AppModal from "../components/AppModal.vue";
import AppPagination from "../components/AppPagination.vue";
import EmptyState from "../components/EmptyState.vue";
import { postJson } from "../api";
import { appState, handleError, toast } from "../store";
import { consoleData, loadClientProfiles } from "../useConsoleData";
import { avatarText } from "../utils/format";
import type { ClientProfile } from "../types";

const clientProfileOpen = ref(false);
const clientProfileVerifyOpen = ref(false);
const clientProfileBusy = ref(false);
const clientProfileCodeBusy = ref(false);
const clientProfileCooldown = ref(0);
const selectedClientProfile = ref<ClientProfile | null>(null);
const currentPage = ref(1);
const pageSize = ref(8);
let clientProfileCooldownTimer = 0;

const clientProfileForm = reactive({
  username: "",
  email: "",
  nickname: "",
  avatarUrl: ""
});

const clientProfileVerifyForm = reactive({
  email: "",
  code: ""
});

onMounted(() => {
  loadClientProfiles(false, currentPage.value, pageSize.value)
    .then(() => {
      console.log('Client profiles loaded:', consoleData.clientProfiles.length, 'Total:', consoleData.clientProfilesTotal);
    })
    .catch(handleError);
});

async function handlePageChange(page: number) {
  currentPage.value = page;
  await loadClientProfiles(false, currentPage.value, pageSize.value).catch(handleError);
}

function openClientProfileModal(profile: ClientProfile) {
  selectedClientProfile.value = profile;
  Object.assign(clientProfileForm, {
    username: profile.username || "",
    email: profile.email || "",
    nickname: profile.nickname || "",
    avatarUrl: profile.avatarUrl || ""
  });
  clientProfileOpen.value = true;
}

function validateClientProfileEmail(requireEmail: boolean) {
  const email = clientProfileForm.email.trim();
  if (requireEmail && !email) {
    throw new Error("请输入应用邮箱。");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("请输入有效邮箱地址。");
  }
}

function startClientProfileCooldown(seconds: number) {
  clientProfileCooldown.value = seconds;
  window.clearInterval(clientProfileCooldownTimer);
  clientProfileCooldownTimer = window.setInterval(() => {
    clientProfileCooldown.value--;
    if (clientProfileCooldown.value <= 0) {
      window.clearInterval(clientProfileCooldownTimer);
    }
  }, 1000);
}

async function submitClientProfile() {
  if (!selectedClientProfile.value) return;
  validateClientProfileEmail(false);
  const nextEmail = clientProfileForm.email.trim().toLowerCase();
  const mainEmail = appState.user?.email.toLowerCase() || "";
  const currentEmail = selectedClientProfile.value.email?.toLowerCase() || mainEmail;
  const emailAlreadyVerified =
    nextEmail === mainEmail ||
    (nextEmail === currentEmail && selectedClientProfile.value.emailVerified);
  if (nextEmail && nextEmail !== mainEmail && !emailAlreadyVerified) {
    Object.assign(clientProfileVerifyForm, { email: clientProfileForm.email.trim(), code: "" });
    clientProfileVerifyOpen.value = true;
    return;
  }
  clientProfileBusy.value = true;
  try {
    await postJson(`/api/account/client-profiles/${encodeURIComponent(selectedClientProfile.value.clientId)}`, {
      username: clientProfileForm.username.trim(),
      email: clientProfileForm.email.trim(),
      nickname: clientProfileForm.nickname.trim(),
      avatarUrl: clientProfileForm.avatarUrl.trim()
    });
    await loadClientProfiles(false, currentPage.value, pageSize.value);
    clientProfileOpen.value = false;
    toast("应用身份已保存");
  } finally {
    clientProfileBusy.value = false;
  }
}

async function sendClientProfileEmailCode() {
  if (!selectedClientProfile.value) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientProfileVerifyForm.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
  clientProfileCodeBusy.value = true;
  try {
    const result = await postJson<{ expiresIn?: number }>(
      `/api/account/client-profiles/${encodeURIComponent(selectedClientProfile.value.clientId)}/email/start`,
      { email: clientProfileVerifyForm.email.trim() }
    );
    toast("验证码已发送，请查看应用邮箱。");
    startClientProfileCooldown(result.expiresIn || 60);
  } finally {
    clientProfileCodeBusy.value = false;
  }
}

async function verifyClientProfileEmail() {
  if (!selectedClientProfile.value) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientProfileVerifyForm.email.trim())) {
    throw new Error("请输入有效邮箱地址。");
  }
  if (!/^\d{6}$/.test(clientProfileVerifyForm.code.trim())) throw new Error("请输入 6 位数字验证码。");
  clientProfileBusy.value = true;
  try {
    await postJson(`/api/account/client-profiles/${encodeURIComponent(selectedClientProfile.value.clientId)}/email/verify`, {
      email: clientProfileVerifyForm.email.trim(),
      code: clientProfileVerifyForm.code.trim()
    });
    await postJson(`/api/account/client-profiles/${encodeURIComponent(selectedClientProfile.value.clientId)}`, {
      username: clientProfileForm.username.trim(),
      email: clientProfileVerifyForm.email.trim(),
      nickname: clientProfileForm.nickname.trim(),
      avatarUrl: clientProfileForm.avatarUrl.trim()
    });
    await loadClientProfiles(false, currentPage.value, pageSize.value);
    clientProfileVerifyOpen.value = false;
    clientProfileOpen.value = false;
    toast("应用身份已保存，邮箱已验证");
  } finally {
    clientProfileBusy.value = false;
  }
}

function clientProfileEmailStatus(profile: ClientProfile): string {
  if (!profile.email) return "沿用主邮箱";
  return profile.emailVerified ? "邮箱已验证" : "邮箱待验证";
}
</script>

<template>
  <section class="page-stack">
    <div class="client-profile-stats">
      <strong>{{ consoleData.clientProfilesTotal }} 个应用可配置</strong>
    </div>

    <EmptyState
      v-if="consoleData.clientProfiles.length === 0"
      title="暂无应用"
      description="创建并授权应用后，可以在这里配置该应用看到的身份信息。"
    />

    <div v-else class="client-profile-grid">
      <article v-for="profile in consoleData.clientProfiles" :key="profile.clientId" class="client-profile-card">
        <div class="client-profile-head">
          <span class="client-avatar" :class="{ 'has-image': Boolean(profile.clientLogoUrl) }">
            <img v-if="profile.clientLogoUrl" :src="profile.clientLogoUrl" alt="" />
            <template v-else>{{ avatarText(profile.clientName) }}</template>
          </span>
          <div class="client-profile-info">
            <strong>{{ profile.clientName }}</strong>
            <span class="client-profile-username">{{ profile.username || appState.user?.username || "未设置应用用户名" }}</span>
          </div>
        </div>

        <div class="client-profile-details">
          <div class="detail-row">
            <Mail :size="16" class="detail-icon" />
            <span class="detail-label">邮箱</span>
            <span class="detail-value">{{ profile.email || appState.user?.email }}</span>
          </div>
          <div class="detail-row">
            <component :is="profile.email && !profile.emailVerified ? Clock : Check" :size="16" class="detail-icon" :class="{ warning: profile.email && !profile.emailVerified }" />
            <span class="detail-label">状态</span>
            <el-tag :type="profile.email && !profile.emailVerified ? 'warning' : 'success'" size="small" effect="light" round>
              {{ clientProfileEmailStatus(profile) }}
            </el-tag>
          </div>
          <div v-if="profile.nickname" class="detail-row">
            <span class="detail-label">昵称</span>
            <span class="detail-value">{{ profile.nickname }}</span>
          </div>
        </div>

        <div class="client-profile-actions">
          <el-button size="small" type="primary" @click="openClientProfileModal(profile)">
            <Pencil :size="14" />
            配置身份
          </el-button>
        </div>
      </article>
    </div>

    <AppPagination
      v-if="consoleData.clientProfilesTotal > 0"
      :current-page="currentPage"
      :page-size="pageSize"
      :total="consoleData.clientProfilesTotal"
      @update:current-page="handlePageChange"
    />

    <AppModal v-model="clientProfileOpen" :title="selectedClientProfile ? `${selectedClientProfile.clientName} 应用身份` : '应用身份'" wide>
      <form class="modal-form two-col" @submit.prevent="submitClientProfile().catch(handleError)">
        <label>应用用户名<input v-model="clientProfileForm.username" maxlength="64" placeholder="请输入该应用看到的用户名" /></label>
        <label>应用邮箱<input v-model="clientProfileForm.email" type="email" autocomplete="email" placeholder="请输入该应用看到的邮箱" /></label>
        <label>昵称<input v-model="clientProfileForm.nickname" maxlength="80" placeholder="该应用看到的昵称" /></label>
        <label class="span-two">头像 URL<input v-model="clientProfileForm.avatarUrl" type="url" placeholder="请输入该应用看到的头像地址" /></label>
        <div class="form-actions span-two">
          <el-button @click="clientProfileOpen = false">取消</el-button>
          <el-button type="primary" native-type="submit" :loading="clientProfileBusy">保存资料</el-button>
        </div>
      </form>
    </AppModal>

    <AppModal v-model="clientProfileVerifyOpen" title="验证应用邮箱">
      <form class="modal-form" @submit.prevent="verifyClientProfileEmail().catch(handleError)">
        <p class="modal-hint">该邮箱和主账号邮箱不同，需要先验证后才能保存给应用使用。</p>
        <label>应用邮箱<input v-model="clientProfileVerifyForm.email" type="email" readonly /></label>
        <div class="code-row">
          <label>
            验证码
            <input v-model="clientProfileVerifyForm.code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="请输入 6 位验证码" />
          </label>
          <el-button type="primary" plain :disabled="clientProfileCodeBusy || clientProfileCooldown > 0" :loading="clientProfileCodeBusy" @click.prevent="sendClientProfileEmailCode().catch(handleError)">
            {{ clientProfileCooldown > 0 ? `${clientProfileCooldown} 秒` : clientProfileCodeBusy ? "发送中" : "发送验证码" }}
          </el-button>
        </div>
        <div class="form-actions">
          <el-button @click="clientProfileVerifyOpen = false">返回修改</el-button>
          <el-button type="primary" native-type="submit" :loading="clientProfileBusy">验证并保存</el-button>
        </div>
      </form>
    </AppModal>
  </section>
</template>

<style scoped>
.client-profile-stats {
  padding: 0 0 16px 0;
}

.client-profile-stats strong {
  font-size: 18px;
  font-weight: 600;
  color: #0f9f9a;
  line-height: 1.4;
}

.client-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 20px;
}

.client-profile-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  transition: all 0.2s ease;
}

.client-profile-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.client-profile-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.client-avatar {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0f9f9a 0%, #0d8883 100%);
  color: #ffffff;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.client-avatar.has-image {
  background: #f1f5f9;
}

.client-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.client-profile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.client-profile-info strong {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-profile-username {
  font-size: 14px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-profile-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 8px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.detail-icon {
  color: #0f9f9a;
  flex-shrink: 0;
}

.detail-icon.warning {
  color: #f59e0b;
}

.detail-label {
  color: #64748b;
  font-weight: 500;
  min-width: 48px;
}

.detail-value {
  color: #1e293b;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-profile-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

@media (max-width: 768px) {
  .client-profile-grid {
    grid-template-columns: 1fr;
  }
}
</style>
