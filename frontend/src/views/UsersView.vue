<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import AppModal from "../components/AppModal.vue";
import EmptyState from "../components/EmptyState.vue";
import FormActions from "../components/FormActions.vue";
import { KeyRound, LogOut, Pencil, ShieldCheck, Trash2, UserRound } from "lucide-vue-next";
import { postJson } from "../api";
import { handleError, toast } from "../store";
import { consoleData, loadUsers } from "../useConsoleData";
import { avatarText, formatDate } from "../utils/format";
import type { AdminUser } from "../types";

const modalOpen = ref(false);
const passwordOpen = ref(false);
const editingId = ref("");
const busy = ref(false);
const keyword = ref("");
const roleFilter = ref<"all" | "admin" | "user">("all");
const statusFilter = ref<"all" | "active" | "inactive">("all");
const form = reactive({
  username: "",
  email: "",
  displayName: "",
  nickname: "",
  gender: "",
  birthday: "",
  avatarUrl: "",
  password: "",
  admin: false,
  active: true
});
const passwordForm = reactive({ user: null as AdminUser | null, password: "", confirmPassword: "" });
const pagination = reactive({ page: 1, pageSize: 10 });
const pagedUsers = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize;
  return filteredUsers.value.slice(start, start + pagination.pageSize);
});

const filteredUsers = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return consoleData.users.filter((user) => {
    const text = [user.username, user.email, user.displayName, user.nickname].filter(Boolean).join(" ").toLowerCase();
    const keywordMatched = !query || text.includes(query);
    const roleMatched = roleFilter.value === "all" || (roleFilter.value === "admin" ? user.admin : !user.admin);
    const statusMatched = statusFilter.value === "all" || (statusFilter.value === "active" ? user.active : !user.active);
    return keywordMatched && roleMatched && statusMatched;
  });
});

const userStats = computed(() => ({
  total: consoleData.users.length,
  admin: consoleData.users.filter((user) => user.admin).length,
  active: consoleData.users.filter((user) => user.active).length,
  sessions: consoleData.users.reduce((total, user) => total + Number(user.sessionCount || 0), 0)
}));

onMounted(() => loadUsers().catch(handleError));

watch([keyword, roleFilter, statusFilter], () => {
  pagination.page = 1;
});

function openCreate() {
  editingId.value = "";
  Object.assign(form, { username: "", email: "", displayName: "", nickname: "", gender: "", birthday: "", avatarUrl: "", password: "", admin: false, active: true });
  modalOpen.value = true;
}

function openEdit(user: AdminUser) {
  editingId.value = user.id;
  Object.assign(form, {
    username: user.username || "",
    email: user.email,
    displayName: user.displayName || "",
    nickname: user.nickname || "",
    gender: user.gender || "",
    birthday: user.birthday || "",
    avatarUrl: user.avatarUrl || "",
    password: "",
    admin: user.admin,
    active: user.active
  });
  modalOpen.value = true;
}

function openPassword(user: AdminUser) {
  Object.assign(passwordForm, { user, password: "", confirmPassword: "" });
  passwordOpen.value = true;
}

async function submitUser() {
  if (!editingId.value && form.password.length < 6) throw new Error("密码至少需要 6 位。");
  busy.value = true;
  try {
    const payload = {
      username: form.username,
      email: form.email,
      displayName: form.displayName,
      nickname: form.nickname,
      gender: form.gender,
      birthday: form.birthday,
      avatarUrl: form.avatarUrl,
      password: form.password,
      admin: form.admin,
      active: form.active
    };
    await postJson(editingId.value ? `/api/admin/users/${encodeURIComponent(editingId.value)}` : "/api/admin/users", payload);
    await loadUsers(true);
    modalOpen.value = false;
    toast(editingId.value ? "用户已保存" : "用户已创建");
  } finally {
    busy.value = false;
  }
}

async function resetPassword() {
  if (passwordForm.password.length < 6) throw new Error("密码至少需要 6 位。");
  if (passwordForm.password !== passwordForm.confirmPassword) throw new Error("两次输入的新密码不一致。");
  if (!passwordForm.user) return;
  busy.value = true;
  try {
    await postJson(`/api/admin/users/${encodeURIComponent(passwordForm.user.id)}/password`, { password: passwordForm.password });
    await loadUsers(true);
    passwordOpen.value = false;
    toast("密码已重置");
  } finally {
    busy.value = false;
  }
}

async function toggleUser(user: AdminUser) {
  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/status`, { active: !user.active });
  await loadUsers(true);
  toast(user.active ? "用户已停用" : "用户已启用");
}

async function revokeSessions(user: AdminUser) {
  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`);
  await loadUsers(true);
  toast("该用户会话已注销");
}

async function deleteUser(user: AdminUser) {
  if (!window.confirm(`确定删除用户 ${user.username || user.email}？`)) return;
  await postJson(`/api/admin/users/${encodeURIComponent(user.id)}/delete`);
  await loadUsers(true);
  toast("用户已删除");
}

function profileCompleteness(user: AdminUser): number {
  const fields = [user.displayName, user.nickname, user.gender, user.birthday, user.avatarUrl];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}
</script>

<template>
  <section class="page-stack">
    <div class="user-summary-grid">
      <div><span>用户总数</span><strong>{{ userStats.total }}</strong></div>
      <div><span>管理员</span><strong>{{ userStats.admin }}</strong></div>
      <div><span>启用账号</span><strong>{{ userStats.active }}</strong></div>
      <div><span>有效会话</span><strong>{{ userStats.sessions }}</strong></div>
    </div>

    <div class="user-toolbar">
      <el-input v-model="keyword" clearable placeholder="搜索用户名、邮箱或显示名称" />
      <el-select v-model="roleFilter" placeholder="全部角色">
        <el-option label="全部角色" value="all" />
        <el-option label="管理员" value="admin" />
        <el-option label="普通用户" value="user" />
      </el-select>
      <el-select v-model="statusFilter" placeholder="全部状态">
        <el-option label="全部状态" value="all" />
        <el-option label="启用" value="active" />
        <el-option label="停用" value="inactive" />
      </el-select>
      <el-button type="primary" @click="openCreate">新增用户</el-button>
    </div>

    <EmptyState v-if="consoleData.users.length === 0" title="暂无用户" description="创建用户后会显示在这里。" />
    <el-table
      v-else
      class="clean-data-table"
      :data="pagedUsers"
      row-key="id"
      stripe
    >
      <el-table-column label="用户" min-width="300">
        <template #default="{ row }">
          <div class="user-table-main">
            <span class="user-table-avatar">
              <img v-if="row.avatarUrl" :src="row.avatarUrl" alt="" />
              <template v-else>{{ avatarText(row.nickname || row.displayName || row.username || row.email) }}</template>
            </span>
            <div class="user-table-copy">
              <strong>{{ row.nickname || row.displayName || row.username || row.email }}</strong>
              <span>{{ row.username || "-" }} · {{ row.email }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="资料" min-width="360">
        <template #default="{ row }">
          <div class="user-profile-cell">
            <span>生日：{{ row.birthday || "未设置" }}</span>
            <span>资料：{{ profileCompleteness(row) }}%</span>
            <span>会话：{{ row.sessionCount || 0 }}</span>
            <span>头像：{{ row.avatarUrl ? "已设置" : "未设置" }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="角色" width="110">
        <template #default="{ row }">
          <span class="role-pill" :class="{ admin: row.admin }">
            <ShieldCheck v-if="row.admin" :size="14" />
            <UserRound v-else :size="14" />
            {{ row.admin ? "管理员" : "用户" }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <el-switch
            :model-value="row.active"
            size="small"
            active-text="启用"
            inactive-text="停用"
            inline-prompt
            :active-value="true"
            :inactive-value="false"
            @change="toggleUser(row).catch(handleError)"
          />
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="330">
        <template #default="{ row }">
          <div class="table-actions">
            <el-button size="small" @click="openEdit(row)"><Pencil :size="14" />编辑</el-button>
            <el-button size="small" @click="openPassword(row)"><KeyRound :size="14" />密码</el-button>
            <el-button size="small" @click="revokeSessions(row).catch(handleError)"><LogOut :size="14" />会话</el-button>
            <el-button size="small" type="danger" plain @click="deleteUser(row).catch(handleError)"><Trash2 :size="14" />删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <div v-if="filteredUsers.length > pagination.pageSize" class="table-pagination">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :page-sizes="[10, 20, 50]"
        :total="filteredUsers.length"
        layout="total, sizes, prev, pager, next"
      />
    </div>

    <AppModal v-model="modalOpen" :title="editingId ? '编辑用户' : '新增用户'" wide>
      <form class="modal-form two-col" @submit.prevent="submitUser().catch(handleError)">
        <label>用户名<input v-model="form.username" placeholder="请输入用户名" /></label>
        <label>邮箱<input v-model="form.email" type="email" placeholder="请输入邮箱" /></label>
        <label>显示名称<input v-model="form.displayName" placeholder="请输入显示名称" /></label>
        <label>昵称<input v-model="form.nickname" placeholder="请输入昵称" /></label>
        <label>性别
          <select v-model="form.gender">
            <option value="">未设置</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
            <option value="unknown">不透露</option>
          </select>
        </label>
        <label>生日<input v-model="form.birthday" type="date" /></label>
        <label class="span-two">头像 URL<input v-model="form.avatarUrl" type="url" placeholder="https://example.com/avatar.png，可先留空" /></label>
        <label v-if="!editingId">密码<input v-model="form.password" type="password" placeholder="请输入至少 6 位密码" /></label>
        <div class="span-two settings-switch-grid">
          <label class="settings-switch-item">
            <span>
              <strong>管理员</strong>
              <small>允许访问用户、应用、邮件与审计管理</small>
            </span>
            <el-switch v-model="form.admin" />
          </label>
          <label class="settings-switch-item">
            <span>
              <strong>启用账号</strong>
              <small>停用后会立即阻止登录并清理会话</small>
            </span>
            <el-switch v-model="form.active" />
          </label>
        </div>
        <FormActions class="span-two" :busy="busy" @cancel="modalOpen = false" />
      </form>
    </AppModal>

    <AppModal v-model="passwordOpen" title="重置密码">
      <form class="modal-form" @submit.prevent="resetPassword().catch(handleError)">
        <label>新密码<input v-model="passwordForm.password" type="password" placeholder="请输入新密码" /></label>
        <label>确认新密码<input v-model="passwordForm.confirmPassword" type="password" placeholder="请再次输入新密码" /></label>
        <FormActions :busy="busy" @cancel="passwordOpen = false" />
      </form>
    </AppModal>
  </section>
</template>
