import { reactive } from "vue";
import { ApiError, requestJson } from "./api";
import type { CurrentUser, SystemConfig } from "./types";

interface AppState {
  checked: boolean;
  loading: boolean;
  user: CurrentUser | null;
  message: string;
  messageType: "success" | "error";
  modalOpen: boolean;
  system: SystemConfig;
}

export const appState = reactive<AppState>({
  checked: false,
  loading: false,
  user: null,
  message: "",
  messageType: "success",
  modalOpen: false,
  system: {
    siteName: "统一登陆平台",
    logoUrl: "/brand.svg",
    registrationEnabled: true
  }
});

let messageTimer = 0;
let systemLoaded = false;

export async function loadMe(force = false): Promise<CurrentUser | null> {
  if (appState.checked && !force) return appState.user;
  appState.loading = true;
  try {
    const result = await requestJson<{ authenticated: boolean; user?: CurrentUser }>("/api/me");
    appState.user = result.authenticated ? result.user || null : null;
    appState.checked = true;
    return appState.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      appState.user = null;
      appState.checked = true;
      return null;
    }
    throw error;
  } finally {
    appState.loading = false;
  }
}

export function setModalOpen(open: boolean): void {
  appState.modalOpen = open;
}

export async function loadSystemSettings(force = false): Promise<SystemConfig> {
  if (!force && systemLoaded) return appState.system;
  const settings = await requestJson<SystemConfig>("/api/system/settings");
  appState.system = settings;
  systemLoaded = true;
  return settings;
}

export function toast(message: string, type: "success" | "error" = "success"): void {
  window.clearTimeout(messageTimer);
  appState.message = message;
  appState.messageType = type;
  messageTimer = window.setTimeout(() => {
    appState.message = "";
  }, 2400);
}

export function handleError(error: unknown): void {
  toast(error instanceof Error ? error.message : "操作失败", "error");
}
