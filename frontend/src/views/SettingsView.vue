<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import AppModal from "../components/AppModal.vue";
import { postJson } from "../api";
import { handleError, toast } from "../store";
import { consoleData, loadSettings } from "../useConsoleData";

const systemOpen = ref(false);
const emailOpen = ref(false);
const systemBusy = ref(false);
const emailBusy = ref(false);
const testBusy = ref(false);
const systemForm = reactive({
  siteName: "统一登陆平台",
  logoUrl: "/brand.svg",
  registrationEnabled: true
});
const emailForm = reactive({
  provider: "resend",
  fromEmail: "noreply@aiku.qzz.io",
  fromName: "统一登陆平台",
  host: "",
  port: 465,
  secureMode: "ssl",
  username: "",
  password: "",
  testEmail: ""
});

function useDefaultSystemSettings() {
  Object.assign(systemForm, {
    siteName: "统一登陆平台",
    logoUrl: "/brand.svg",
    registrationEnabled: true
  });
}

onMounted(() => loadSettings().catch(handleError));

watch(systemOpen, (open) => {
  if (!open) return;
  Object.assign(systemForm, {
    siteName: consoleData.settings?.system.siteName || "统一登陆平台",
    logoUrl: consoleData.settings?.system.logoUrl || "/brand.svg",
    registrationEnabled: consoleData.settings?.system.registrationEnabled !== false
  });
});

watch(emailOpen, (open) => {
  if (!open) return;
  const email = consoleData.settings?.email || consoleData.smtp;
  Object.assign(emailForm, {
    provider: email?.provider || "resend",
    fromEmail: email?.provider === "smtp" ? email.smtp?.fromEmail || "noreply@aiku.qzz.io" : email?.resend?.fromEmail || "noreply@aiku.qzz.io",
    fromName: email?.provider === "smtp" ? email.smtp?.fromName || "统一登陆平台" : email?.resend?.fromName || "统一登陆平台",
    host: email?.smtp?.host || "",
    port: email?.smtp?.port || 465,
    secureMode: email?.smtp?.secureMode || "ssl",
    username: email?.smtp?.username || "",
    password: "",
    testEmail: ""
  });
});

async function submitSystem() {
  systemBusy.value = true;
  try {
    await postJson("/api/admin/settings", {
      siteName: systemForm.siteName.trim(),
      logoUrl: systemForm.logoUrl.trim(),
      registrationEnabled: systemForm.registrationEnabled
    });
    await loadSettings(true);
    systemOpen.value = false;
    toast("系统配置已保存");
    window.setTimeout(() => window.location.reload(), 500);
  } finally {
    systemBusy.value = false;
  }
}

async function submitEmail() {
  emailBusy.value = true;
  try {
    await postJson("/api/admin/smtp", {
      provider: emailForm.provider,
      fromEmail: emailForm.fromEmail,
      fromName: emailForm.fromName,
      host: emailForm.host,
      port: Number(emailForm.port),
      secureMode: emailForm.secureMode,
      username: emailForm.username,
      password: emailForm.password
    });
    await loadSettings(true);
    emailOpen.value = false;
    toast("邮件配置已保存");
  } finally {
    emailBusy.value = false;
  }
}

async function testEmail() {
  testBusy.value = true;
  try {
    await postJson("/api/admin/smtp/test", { testEmail: emailForm.testEmail });
    toast("测试邮件已发送");
  } finally {
    testBusy.value = false;
  }
}
</script>

<template>
  <section class="page-stack">
    <section class="settings-section">
      <div class="section-heading">
        <div>
          <span class="account-kicker">基础配置</span>
          <strong>系统信息</strong>
        </div>
        <el-button type="primary" @click="systemOpen = true">编辑系统配置</el-button>
      </div>
      <div class="settings-grid">
        <div>
          <span>系统名</span>
          <strong>{{ consoleData.settings?.system.siteName || "统一登陆平台" }}</strong>
        </div>
        <div>
          <span>系统图标</span>
          <span class="settings-logo-preview">
            <img :src="consoleData.settings?.system.logoUrl || '/brand.svg'" alt="" />
            <strong>{{ consoleData.settings?.system.logoUrl || "/brand.svg" }}</strong>
          </span>
        </div>
        <div>
          <span>账号注册</span>
          <strong>{{ consoleData.settings?.system.registrationEnabled === false ? "已关闭" : "已开放" }}</strong>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading">
        <div>
          <span class="account-kicker">邮件配置</span>
          <strong>验证码与系统通知</strong>
        </div>
        <el-button type="primary" plain @click="emailOpen = true">编辑邮件配置</el-button>
      </div>
      <div class="settings-grid">
        <div><span>当前通道</span><strong>{{ consoleData.settings?.email.provider === "smtp" ? "SMTP" : "Resend API" }}</strong></div>
        <template v-if="consoleData.settings?.email.provider === 'smtp'">
          <div><span>SMTP 主机</span><strong>{{ consoleData.settings?.email.smtp?.host || "未配置" }}</strong></div>
          <div><span>发件邮箱</span><strong>{{ consoleData.settings?.email.smtp?.fromEmail || "-" }}</strong></div>
        </template>
        <template v-else>
          <div><span>API Key</span><strong>{{ consoleData.settings?.email.resendConfigured ? "已配置" : "未配置" }}</strong></div>
          <div><span>发件邮箱</span><strong>{{ consoleData.settings?.email.resend?.fromEmail || "noreply@aiku.qzz.io" }}</strong></div>
        </template>
      </div>
    </section>

    <AppModal v-model="systemOpen" title="系统配置" wide>
      <form class="modal-form two-col" @submit.prevent="submitSystem().catch(handleError)">
        <label>系统名<input v-model="systemForm.siteName" maxlength="40" placeholder="统一登陆平台" /></label>
        <label>系统图标<input v-model="systemForm.logoUrl" placeholder="/brand.svg 或 https://example.com/logo.png" /></label>
        <label class="settings-switch-item span-two">
          <span>
            <strong>开放注册</strong>
            <small>关闭后，注册页和注册验证码接口会停止创建新账号。</small>
          </span>
          <el-switch v-model="systemForm.registrationEnabled" />
        </label>
        <div class="form-actions span-two">
          <el-button @click="systemOpen = false">取消</el-button>
          <el-button @click="useDefaultSystemSettings">恢复系统默认</el-button>
          <el-button type="primary" native-type="submit" :loading="systemBusy">保存</el-button>
        </div>
      </form>
    </AppModal>

    <AppModal v-model="emailOpen" title="邮件配置" wide>
      <form class="modal-form two-col" @submit.prevent="submitEmail().catch(handleError)">
        <label>发送通道
          <select v-model="emailForm.provider">
            <option value="resend">Resend API</option>
            <option value="smtp">SMTP</option>
          </select>
        </label>
        <label>发件名称<input v-model="emailForm.fromName" :placeholder="consoleData.settings?.system.siteName || '统一登陆平台'" /></label>
        <label>发件邮箱<input v-model="emailForm.fromEmail" type="email" placeholder="noreply@aiku.qzz.io" /></label>
        <template v-if="emailForm.provider === 'smtp'">
          <label>SMTP 主机<input v-model="emailForm.host" placeholder="smtp.example.com" /></label>
          <label>端口<input v-model.number="emailForm.port" type="number" placeholder="465" /></label>
          <label>加密方式
            <select v-model="emailForm.secureMode">
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </label>
          <label>用户名<input v-model="emailForm.username" placeholder="请输入 SMTP 用户名" /></label>
          <label>密码/授权码<input v-model="emailForm.password" type="password" placeholder="已配置时可留空" /></label>
        </template>
        <label class="span-two">测试邮箱<input v-model="emailForm.testEmail" type="email" placeholder="输入邮箱后可发送测试邮件" /></label>
        <div class="form-actions span-two">
          <el-button :loading="testBusy" @click="testEmail().catch(handleError)">发送测试</el-button>
          <el-button type="primary" native-type="submit" :loading="emailBusy">保存</el-button>
        </div>
      </form>
    </AppModal>
  </section>
</template>
