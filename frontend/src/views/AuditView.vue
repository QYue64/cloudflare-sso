<script setup lang="ts">
import { onMounted, ref } from "vue";
import AppPagination from "../components/AppPagination.vue";
import EmptyState from "../components/EmptyState.vue";
import { consoleData, loadAudit } from "../useConsoleData";
import { formatDate } from "../utils/format";
import { handleError } from "../store";
import type { AuditEvent } from "../types";

const currentPage = ref(1);
const pageSize = ref(8);

async function refreshAudit() {
  await loadAudit(true, currentPage.value, pageSize.value);
}

function handlePageChange(page: number) {
  currentPage.value = page;
  refreshAudit().catch(handleError);
}

onMounted(() => refreshAudit().catch(handleError));

const eventLabels: Record<string, string> = {
  user_registered: "用户注册",
  profile_updated: "更新资料",
  password_changed: "修改密码",
  email_bound: "更换邮箱",
  email_code_sent: "发送邮箱验证码",
  email_code_rate_limited: "邮箱验证码限流",
  oauth_authorization_granted: "同意授权",
  oauth_grant_revoked: "撤销授权",
  client_created: "创建应用",
  client_updated: "更新应用",
  client_status_updated: "更新应用状态",
  client_secret_rotated: "轮换应用密钥",
  client_secret_revealed: "查看应用密钥",
  client_deleted: "删除应用",
  user_created: "创建用户",
  user_updated: "更新用户",
  user_status_updated: "更新用户状态",
  user_password_reset: "重置用户密码",
  user_sessions_revoked: "注销用户会话",
  user_deleted: "删除用户",
  email_delivery_test_sent: "发送测试邮件",
  email_delivery_config_updated: "更新邮件配置"
};

const actorLabels: Record<string, string> = {
  admin: "管理员",
  user: "用户",
  system: "系统"
};

const targetLabels: Record<string, string> = {
  client: "应用",
  user: "用户",
  email: "邮箱",
  session: "会话"
};

function eventLabel(event: AuditEvent): string {
  return eventLabels[event.eventType] || event.eventType;
}

function actorLabel(actorType: string): string {
  return actorLabels[actorType] || actorType;
}

function targetLabel(event: AuditEvent): string {
  if (!event.targetType && !event.targetId) return "-";
  const type = event.targetType ? targetLabels[event.targetType] || event.targetType : "对象";
  return `${type}：${event.targetId || "-"}`;
}
</script>

<template>
  <section class="page-stack">
    <EmptyState v-if="consoleData.audit.length === 0" title="暂无审计日志" description="重要管理操作会记录在这里。" />
    <template v-else>
      <el-table class="clean-data-table" :data="consoleData.audit" row-key="id" stripe>
        <el-table-column label="事件" min-width="240">
          <template #default="{ row }">
            <div class="audit-event-cell">
              <strong>{{ eventLabel(row) }}</strong>
              <span>{{ targetLabel(row) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作者" width="150">
          <template #default="{ row }">
            <el-tag size="small" effect="light">{{ actorLabel(row.actorType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作者 ID" min-width="220">
          <template #default="{ row }">{{ row.actorId || "-" }}</template>
        </el-table-column>
        <el-table-column label="时间" width="190">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
      </el-table>

      <AppPagination
        :current-page="currentPage"
        :page-size="pageSize"
        :total="consoleData.auditTotal"
        @update:current-page="handlePageChange"
      />
    </template>
  </section>
</template>
