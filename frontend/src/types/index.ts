export interface CurrentUser {
  id: string;
  username?: string | null;
  email: string;
  displayName?: string | null;
  nickname?: string | null;
  gender?: string | null;
  birthday?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  isAdmin?: boolean;
}

export interface Grant {
  id: string;
  clientId: string;
  clientName: string;
  clientLogoUrl?: string | null;
  clientAppUrl?: string | null;
  scopes: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  id: string;
  current?: boolean;
  ip?: string | null;
  userAgent?: string | null;
  sourceName?: string | null;
  sourceLogoUrl?: string | null;
  sourceAppUrl?: string | null;
  createdAt?: string;
  lastSeenAt?: string;
  expiresAt: number;
}

export interface ClientProfile {
  clientId: string;
  clientName: string;
  clientLogoUrl?: string | null;
  clientAppUrl?: string | null;
  configured: boolean;
  username?: string | null;
  email?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  emailVerified: boolean;
  updatedAt?: string | null;
}

export interface AdminUser {
  id: string;
  username: string | null;
  email: string;
  displayName: string;
  nickname?: string | null;
  gender?: string | null;
  birthday?: string | null;
  avatarUrl?: string | null;
  emailVerified: boolean;
  admin: boolean;
  active: boolean;
  sessionCount: number;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Client {
  id: string;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  confidential: boolean;
  secretRevealable: boolean;
  logoUrl?: string | null;
  appUrl?: string | null;
  pkceRequired: boolean;
  returnRoles: boolean;
  allowRegistration: boolean;
  active: boolean;
  createdAt?: string;
}

export interface SmtpConfig {
  configured: boolean;
  provider: "resend" | "smtp";
  resendConfigured: boolean;
  resend?: {
    fromEmail?: string;
    fromName?: string;
  };
  smtp?: {
    host?: string;
    port?: number;
    secureMode?: string;
    username?: string;
    fromEmail?: string;
    fromName?: string;
  } | null;
}

export interface SystemConfig {
  siteName: string;
  logoUrl: string;
  registrationEnabled: boolean;
}

export interface TurnstileSettings {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
  enableOnLogin: boolean;
  enableOnRegister: boolean;
  enableOnPasswordReset: boolean;
  enableOnEmailChange: boolean;
}

export type PublicTurnstileSettings = Omit<TurnstileSettings, "secretKey">;

export interface SettingsConfig {
  system: SystemConfig;
  email: SmtpConfig;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  createdAt: string;
}
