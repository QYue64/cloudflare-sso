<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import { ShieldCheck, MonitorCheck } from "lucide-vue-next";
import EmptyState from "../components/EmptyState.vue";
import { consoleData, loadAccountData } from "../useConsoleData";
import { formatDate } from "../utils/format";
import { handleError } from "../store";

onMounted(() => {
  loadAccountData().catch(handleError);
});
</script>

<template>
  <section class="page-stack">
    <div class="metric-grid two">
      <RouterLink to="/grants" class="metric-card">
        <ShieldCheck :size="24" />
        <span>授权应用</span>
        <strong>{{ consoleData.grants.length }}</strong>
      </RouterLink>
      <RouterLink to="/sessions" class="metric-card">
        <MonitorCheck :size="24" />
        <span>有效会话</span>
        <strong>{{ consoleData.sessions.length }}</strong>
      </RouterLink>
    </div>
    <section class="panel">
      <div class="panel-head">
        <strong>最近授权应用</strong>
        <RouterLink to="/grants">全部</RouterLink>
      </div>
      <EmptyState v-if="consoleData.grants.length === 0" title="暂无授权应用" description="授权后会在这里显示最近访问的应用。" />
      <div v-else class="dashboard-grant-list">
        <RouterLink v-for="grant in consoleData.grants.slice(0, 5)" :key="grant.id" to="/grants" class="dashboard-grant-row">
          <div class="dashboard-app-cell">
            <span class="dashboard-app-icon" :class="{ 'has-image': Boolean(grant.clientLogoUrl) }">
              <img v-if="grant.clientLogoUrl" :src="grant.clientLogoUrl" alt="" />
              <template v-else>{{ grant.clientName.slice(0, 1).toUpperCase() }}</template>
            </span>
            <div>
              <strong>{{ grant.clientName }}</strong>
              <span>{{ grant.clientId }}</span>
            </div>
          </div>
          <div class="dashboard-scope-cell">
            <el-tag v-for="scope in grant.scopes" :key="scope" size="small" effect="plain" round>{{ scope }}</el-tag>
          </div>
          <time>{{ formatDate(grant.updatedAt || grant.createdAt) }}</time>
        </RouterLink>
      </div>
    </section>
  </section>
</template>
