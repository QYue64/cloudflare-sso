export const configuredApiBase = window.OIDC_API_BASE ?? "";
export const apiBase = configuredApiBase || window.location.origin;

const tokenKey = "sso_admin_token";

export function getSavedAdminToken() {
  return window.localStorage.getItem(tokenKey) ?? "";
}

export function saveAdminToken(token) {
  const normalized = String(token ?? "").trim();
  if (normalized) {
    window.localStorage.setItem(tokenKey, normalized);
  }
  return normalized;
}

export function hydrateTokenInput(form) {
  const input = form?.elements?.token;
  if (input && !input.value) {
    input.value = getSavedAdminToken();
  }
}

export async function requireSignedIn() {
  const response = await fetch(`${apiBase}/api/me`, { credentials: "include" });
  const result = await response.json();
  if (!result.authenticated) {
    window.location.assign(`/login?return_to=${encodeURIComponent(window.location.pathname)}`);
    return null;
  }
  return result.user;
}

export async function requireAdmin() {
  const user = await requireSignedIn();
  if (!user) {
    return null;
  }
  if (!user.isAdmin) {
    window.location.assign("/");
    return null;
  }
  return user;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
