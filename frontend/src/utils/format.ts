import type { CurrentUser } from "../types";

export function displayName(user?: CurrentUser | null): string {
  return user?.nickname || user?.displayName || user?.username || user?.email || "-";
}

export function genderLabel(value?: string | null): string {
  const map: Record<string, string> = {
    male: "男",
    female: "女",
    other: "其他",
    unknown: "不透露"
  };
  return value ? map[value] || "-" : "-";
}

export function avatarText(value?: string | null): string {
  const text = String(value || "").trim();
  if (!text) return "?";
  const match = text.match(/[A-Za-z0-9\u4e00-\u9fa5]/u);
  return (match?.[0] || text[0] || "?").toUpperCase();
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN");
}

export function formatDateFromSeconds(value?: number | string | null): string {
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN");
}

export function splitLines(value: string): string[] {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitWords(value: string): string[] {
  return String(value || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
