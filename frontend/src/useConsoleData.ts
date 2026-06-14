import { reactive } from "vue";
import { requestJson } from "./api";
import { appState } from "./store";
import type { AuditEvent, Client, ClientProfile, Grant, Session, SmtpConfig, SettingsConfig, AdminUser } from "./types";

export const consoleData = reactive({
  grants: [] as Grant[],
  sessions: [] as Session[],
  clientProfiles: [] as ClientProfile[],
  clientProfilesTotal: 0,
  users: [] as AdminUser[],
  clients: [] as Client[],
  clientsTotal: 0,
  smtp: null as SmtpConfig | null,
  settings: null as SettingsConfig | null,
  audit: [] as AuditEvent[],
  auditTotal: 0,
  accountLoaded: false,
  usersLoaded: false,
  clientsLoaded: false,
  smtpLoaded: false,
  settingsLoaded: false,
  auditLoaded: false
});

export async function loadAccountData(force = false) {
  if (!appState.user) return;
  if (consoleData.accountLoaded && !force) return;
  const [grants, sessions] = await Promise.all([
    requestJson<{ grants: Grant[] }>("/api/account/grants"),
    requestJson<{ sessions: Session[] }>("/api/account/sessions")
  ]);
  consoleData.grants = grants.grants || [];
  consoleData.sessions = sessions.sessions || [];
  consoleData.accountLoaded = true;
}

export async function loadClientProfiles(force = false, page = 1, pageSize = 8) {
  if (!appState.user) return;
  const result = await requestJson<{ profiles: ClientProfile[]; total?: number; page?: number; pageSize?: number }>(`/api/account/client-profiles?page=${page}&pageSize=${pageSize}`);
  consoleData.clientProfiles = result.profiles || [];
  consoleData.clientProfilesTotal = result.total || 0;
}

export async function loadUsers(force = false) {
  if (!appState.user?.isAdmin) return;
  if (consoleData.usersLoaded && !force) return;
  const result = await requestJson<{ users: AdminUser[] }>("/api/admin/users");
  consoleData.users = result.users || [];
  consoleData.usersLoaded = true;
}

export async function loadClients(force = false, page = 1, pageSize = 2) {
  if (!appState.user?.isAdmin) return;
  if (consoleData.clientsLoaded && !force && page === 1) return;
  const result = await requestJson<{ clients: Client[]; total?: number }>(`/api/admin/clients?page=${page}&pageSize=${pageSize}`);
  consoleData.clients = result.clients || [];
  consoleData.clientsTotal = result.total || 0;
  consoleData.clientsLoaded = true;
}

export async function loadSmtp(force = false) {
  if (!appState.user?.isAdmin) return;
  if (consoleData.smtpLoaded && !force) return;
  consoleData.smtp = await requestJson<SmtpConfig>("/api/admin/smtp");
  consoleData.smtpLoaded = true;
}

export async function loadSettings(force = false) {
  if (!appState.user?.isAdmin) return;
  if (consoleData.settingsLoaded && !force) return;
  consoleData.settings = await requestJson<SettingsConfig>("/api/admin/settings");
  consoleData.smtp = consoleData.settings.email;
  consoleData.settingsLoaded = true;
  consoleData.smtpLoaded = true;
}

export async function loadAudit(force = false, page = 1, pageSize = 8) {
  if (!appState.user?.isAdmin) return;
  if (consoleData.auditLoaded && !force) return;
  const result = await requestJson<{ events: AuditEvent[]; total?: number }>(`/api/admin/audit-events?page=${page}&pageSize=${pageSize}`);
  consoleData.audit = result.events || [];
  consoleData.auditTotal = result.total || 0;
  consoleData.auditLoaded = true;
}
