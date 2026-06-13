<script setup lang="ts">
import { onMounted } from "vue";
import { Clock3, MonitorCheck, RadioTower, ShieldCheck } from "lucide-vue-next";
import EmptyState from "../components/EmptyState.vue";
import { postJson } from "../api";
import { handleError, toast } from "../store";
import { consoleData, loadAccountData } from "../useConsoleData";
import { formatDate, formatDateFromSeconds } from "../utils/format";
import type { Session } from "../types";

onMounted(() => {
  loadAccountData().catch(handleError);
});

async function revokeSession(session: Session) {
  await postJson(`/api/account/sessions/${encodeURIComponent(session.id)}/revoke`);
  await loadAccountData(true);
  toast("会话已注销");
}

function openExternal(url?: string | null) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <section class="page-stack">
    <EmptyState v-if="consoleData.sessions.length === 0" title="暂无有效会话" description="登录后的设备会话会显示在这里。" />
    <div v-else class="session-card-grid">
      <article
        v-for="session in consoleData.sessions"
        :key="session.id"
        class="session-card"
        :class="{ current: session.current, linkable: Boolean(session.sourceAppUrl) }"
        @click="openExternal(session.sourceAppUrl)"
      >
        <div class="session-card-top">
          <span class="session-card-icon" :class="{ 'has-image': Boolean(session.sourceLogoUrl) }">
            <img v-if="session.sourceLogoUrl" :src="session.sourceLogoUrl" alt="" />
            <MonitorCheck v-else :size="20" />
          </span>
          <div>
            <strong>{{ session.current ? "当前会话" : "登录会话" }}</strong>
            <span>{{ session.sourceName || "统一登陆平台控制台" }}</span>
          </div>
          <el-tag :type="session.current ? 'success' : 'info'" size="small" effect="light" round>
            {{ session.current ? "正在使用" : "有效" }}
          </el-tag>
        </div>

        <div class="session-card-body">
          <div>
            <RadioTower :size="16" />
            <span>{{ session.ip || "未知 IP" }}</span>
          </div>
          <div>
            <Clock3 :size="16" />
            <span>最近活动 {{ formatDate(session.lastSeenAt || session.createdAt) }}</span>
          </div>
          <div>
            <ShieldCheck :size="16" />
            <span>过期时间 {{ formatDateFromSeconds(session.expiresAt) }}</span>
          </div>
        </div>

        <div class="session-card-foot">
          <span>{{ session.current ? "此设备正在访问控制台" : "可远程注销该会话" }}</span>
          <el-button v-if="!session.current" type="danger" plain size="small" @click.stop="revokeSession(session).catch(handleError)">注销会话</el-button>
        </div>
      </article>
    </div>
  </section>
</template>
