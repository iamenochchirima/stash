import { z } from "zod";
export const adminRole = z.enum(["viewer", "operator", "owner"]);
export type AdminRole = z.infer<typeof adminRole>;
// Wire types contain public administration metadata only; never credential material.
export interface AdminProfile {
  id: string; name: string; email: string; role: AdminRole; disabledAt: string | null; recoveryPendingAt: string | null;
  mfaEnabled: boolean; verifiedAt: string; lastSignedInAt: string | null; createdAt: string;
}
export interface AdminUserSummary {
  id: string; email: string; name: string; emailVerifiedAt: string | null;
  suspendedAt: string | null; suspensionReason: string | null; createdAt: string;
  lastActiveAt: string | null; resourceCount: number; connectionCount: number;
}
export interface AdminConnectionSummary {
  id: string; name: string; userId: string; userEmail: string; userName: string;
  authentication: "key" | "oauth"; scope: "read" | "write";
  state: "active" | "expired" | "suspended";
  createdAt: string; lastUsedAt: string | null; accessExpiresAt: string | null;
}
export interface AdminAuditEvent {
  id: string; actor: string; targetId: string | null; action: string; reason: string;
  outcome: "success" | "failed"; targetName: string; targetKind: "user" | "admin" | "unavailable"; createdAt: string; changes: Record<string, unknown>;
}
export interface AdminOverview {
  metrics: { users: number; newUsers: number; activeUsers: number; suspendedUsers: number; resources: number; connectedAccounts: number };
  days: 7 | 30;
  library: { links: number; notes: number; ideas: number; pdfs: number; active: number; archived: number; trash: number; storedBytes: number; pdfPending: number; pdfFailed: number; summaryPending: number; summaryFailed: number; summaryRequestsToday: number; summaryTokensToday: number; summaryCostMonth: number };
  health: { storage: string; summaries: string; api: string; database: string; email: string; backups: string; alerts: string; checkedAt: string };
}
export const adminMutation = z.object({ reason: z.string().trim().min(5).max(300), confirmation: z.string().min(1).max(200), operationId: z.string().uuid() });

export const adminActionLabels: Record<string,string> = {
  "user.suspend":"Account suspended", "user.restore":"Access restored", "user.signout":"Sessions revoked",
  "user.disconnect":"Agents disconnected", "user.delete":"Account deleted", "user.delete.requested":"Account deletion requested",
  "connection.revoke":"Connection revoked", "admin.login":"Signed in", "admin.enroll":"Administrator enrolled",
  "admin.recover":"Admin access recovered", "admin.invite":"Administrator invited", "admin.role":"Admin role changed",
  "admin.disable":"Admin access updated", "admin.sessions":"Admin sessions revoked", "admin.reauthenticate":"Identity confirmed",
  "admin.mfa.rotation.requested":"Authenticator replacement started", "admin.mfa.rotation":"Authenticator replaced",
};
export const adminEventLabel = (action:string) => adminActionLabels[action] || action.replace(/^user\.email\.verify/,"Verification email").replace(/^user\.email\.reset/,"Recovery email").replaceAll("."," · ");
