<script setup lang="ts">
import { onMounted } from "vue";
import EmptyState from "../components/EmptyState.vue";
import { postJson } from "../api";
import { handleError, toast } from "../store";
import { consoleData, loadAccountData } from "../useConsoleData";
import { formatDate } from "../utils/format";
import type { Grant } from "../types";

onMounted(() => {
  loadAccountData().catch(handleError);
});

async function revokeGrant(grant: Grant) {
  await postJson(`/api/account/grants/${encodeURIComponent(grant.id)}/revoke`);
  await loadAccountData(true);
  toast("授权已撤销");
}

function openExternal(url?: string | null) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <section class="page-stack">
    <EmptyState v-if="consoleData.grants.length === 0" title="暂无授权应用" description="你允许过的应用会在这里集中管理。" />
    <div v-else class="grant-card-grid">
      <article
        v-for="grant in consoleData.grants"
        :key="grant.id"
        class="grant-card"
        :class="{ linkable: Boolean(grant.clientAppUrl) }"
        @click="openExternal(grant.clientAppUrl)"
      >
        <div class="grant-card-head">
          <span class="grant-card-icon" :class="{ 'has-image': Boolean(grant.clientLogoUrl) }">
            <img v-if="grant.clientLogoUrl" :src="grant.clientLogoUrl" alt="" />
            <template v-else>{{ grant.clientName.slice(0, 1).toUpperCase() }}</template>
          </span>
          <el-tag type="success" size="small" effect="light" round>已授权</el-tag>
        </div>
        <div class="grant-card-main">
          <strong>{{ grant.clientName }}</strong>
          <span>{{ grant.clientId }}</span>
        </div>
        <div class="grant-scope-list">
          <el-tag v-for="scope in grant.scopes" :key="scope" size="small" effect="plain" round>{{ scope }}</el-tag>
        </div>
        <div class="grant-card-foot">
          <small>最近授权 {{ formatDate(grant.updatedAt || grant.createdAt) }}</small>
          <el-button type="danger" plain size="small" @click.stop="revokeGrant(grant).catch(handleError)">撤销授权</el-button>
        </div>
      </article>
    </div>
  </section>
</template>
