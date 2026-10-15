import { sql } from "drizzle-orm";
import {
  pgTable,
  boolean,
  bigint,
  numeric,
  integer,
  jsonb,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  bio: text("bio").notNull().default(""),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  avatar: text("avatar"),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
  firstSavedAt: timestamp("first_saved_at", { withTimezone: true }),
  firstOrganizedAt: timestamp("first_organized_at", { withTimezone: true }),
  agentConnectedAt: timestamp("agent_connected_at", { withTimezone: true }),
  agentRetrievedAt: timestamp("agent_retrieved_at", { withTimezone: true }),
  interests: text("interests").array().notNull().default([]),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const sessions = pgTable("sessions", {
  hash: text("hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const backupDownloads = pgTable("backup_downloads", {
  format: text("format",{enum:["zip","json","bookmarks"]}).notNull().default("zip"),
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").notNull().references(() => sessions.hash, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
});
export const collections = pgTable(
  "collections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("collection_owner_name").on(t.userId, t.name),
    uniqueIndex("collection_id_owner").on(t.id, t.userId),
  ],
);
export const projects = pgTable("projects", {
 importOriginId: uuid("import_origin_id"),
 id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
 name: text("name").notNull(), description: text("description").notNull().default(""), repositoryUrl: text("repository_url"),
 revision: integer("revision").notNull().default(1), archivedAt: timestamp("archived_at", { withTimezone: true }),
 createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id),
    projectSourceId: uuid("project_source_id"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url"),
  kind: text("kind", { enum: ["link", "note", "idea", "pdf"] }).notNull().default("link"),
  body: text("body").notNull().default(""),
  extractedText: text("extracted_text").notNull().default(""),
  importOriginId: uuid("import_origin_id"),
  knownSourceHash: text("known_source_hash"),
  sourceRevision: integer("source_revision").notNull().default(1),
  revision: integer("revision").notNull().default(1),
  favourite: boolean("favourite").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    description: text("description").notNull().default(""),
    metadataStatus: text("metadata_status", {
      enum: ["manual", "extracted", "unavailable"],
    })
      .notNull()
      .default("manual"),
    status: text("status", { enum: ["unread", "reading", "done"] })
      .notNull()
      .default("unread"),
    sourceAgent: text("source_agent").notNull().default("web"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("resource_id_owner").on(t.id, t.userId),
    uniqueIndex("resource_library_url").on(t.userId, t.url).where(sql`${t.projectId} is null`),
    uniqueIndex("resource_project_url").on(t.userId, t.projectId, t.url).where(sql`${t.projectId} is not null`),
    index("resource_owner_created").on(t.userId, t.createdAt),
  ],
);
export const apiKeys = pgTable("api_keys", {
  oauthResource: text("oauth_resource"),
  oauthClientId: text("oauth_client_id").references(() => oauthClients.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hash: text("hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  name: text("name").notNull(),
  scope: text("scope", { enum: ["read", "write"] }).notNull(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const accountTokens = pgTable("account_tokens", {
  hash: text("hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const resourceCollections = pgTable(
  "resource_collections",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    collectionId: uuid("collection_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceId, t.collectionId] }),
    foreignKey({
      columns: [t.resourceId, t.userId],
      foreignColumns: [resources.id, resources.userId],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.collectionId, t.userId],
      foreignColumns: [collections.id, collections.userId],
    }).onDelete("cascade"),
  ],
);

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: createdAt(),
});
export const oauthRequests = pgTable("oauth_requests", {
  hash: text("hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id),
  redirectUri: text("redirect_uri").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  state: text("state").notNull(),
  challenge: text("challenge").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const oauthCodes = pgTable("oauth_codes", {
  hash: text("hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id),
  redirectUri: text("redirect_uri").notNull(),
  resource: text("resource").notNull(),
  scope: text("scope").notNull(),
  challenge: text("challenge").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const oauthRefreshTokens = pgTable("oauth_refresh_tokens", {
  hash: text("hash").primaryKey(),
  keyId: uuid("key_id")
    .notNull()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});


export const adminUsers = pgTable("admin_users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(), name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "operator", "viewer"] }).notNull(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  recoveryPendingAt: timestamp("recovery_pending_at", { withTimezone: true }),
  mfaSecret: text("mfa_secret").notNull(),
  pendingMfaSecret: text("pending_mfa_secret"),
  lastTotpStep: bigint("last_totp_step", { mode: "number" }).notNull().default(-1),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const adminSessions = pgTable("admin_sessions", {
  hash: text("hash").primaryKey(),
  adminId: uuid("admin_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
  authenticatedAt: timestamp("authenticated_at", { withTimezone: true }).notNull(),
});
export const adminInvites = pgTable("admin_invites", {
  id: uuid("id").defaultRandom().notNull().unique(),
  purpose: text("purpose", { enum: ["enroll", "recover"] }).notNull().default("enroll"),
  hash: text("hash").primaryKey(), email: text("email").notNull(), name: text("name").notNull(),
  role: text("role", { enum: ["owner", "operator", "viewer"] }).notNull(),
  invitedBy: uuid("invited_by").references(() => adminUsers.id, { onDelete: "set null" }),
  mfaSecret: text("mfa_secret"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), createdAt: createdAt(),
});
export const adminRecoveryCodes = pgTable("admin_recovery_codes", {
  hash: text("hash").primaryKey(),
  adminId: uuid("admin_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});
export const adminAudit = pgTable("admin_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),
  targetId: text("target_id"), action: text("action").notNull(), reason: text("reason").notNull(),
  outcome: text("outcome", { enum: ["success", "failed"] }).notNull(),
  changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
  operationId: uuid("operation_id"), createdAt: createdAt(),
});

export const adminEmailJobs = pgTable("admin_email_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  payload: text("payload"), status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), createdAt: createdAt(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const itemRequests = pgTable("item_requests", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  itemId: uuid("item_id").notNull().references(() => resources.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.requestId] })]);

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "cascade" }).unique(),
  storageKey: text("storage_key").unique(),
  captureInput: jsonb("capture_input").$type<Record<string, unknown>>().notNull().default({}), requestId: uuid("request_id"), requestFingerprint: text("request_fingerprint"),
  filename: text("filename").notNull(), byteSize: integer("byte_size").notNull(), contentHash: text("content_hash"),
  state: text("state", { enum: ["pending", "uploading", "queued", "processing", "ready", "failed", "missing"] }).notNull().default("pending"),
  uploadTokenHash: text("upload_token_hash").unique(), uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }).notNull(),
  pages: jsonb("pages").$type<{ page: number; text: string }[]>().notNull().default([]), pageCount: integer("page_count"), parserVersion: text("parser_version"), errorCode: text("error_code"),
  createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const blobCleanup = pgTable("blob_cleanup", {
  byteSize: integer("byte_size").notNull().default(20971520),
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull(), storageKey: text("storage_key").unique(),
  attempts: integer("attempts").notNull().default(0), notBefore: timestamp("not_before", { withTimezone: true }).notNull().default(sql`now()+interval '10 minutes'`),
  leaseUntil: timestamp("lease_until", { withTimezone: true }), createdAt: createdAt(),
});
export const itemJobs = pgTable("item_jobs", {
  id: uuid("id").defaultRandom().primaryKey(), userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").notNull().references(() => resources.id, { onDelete: "cascade" }), keyId: uuid("key_id"),
  kind: text("kind", { enum: ["extract", "summary"] }).notNull(),
  state: text("state", { enum: ["queued", "running", "succeeded", "failed", "cancelled", "unknown"] }).notNull().default("queued"),
  sourceRevision: integer("source_revision").notNull().default(1),
  requestId: uuid("request_id"), dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  inputRevision: integer("input_revision").notNull(), attempts: integer("attempts").notNull().default(0),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(), leaseUntil: timestamp("lease_until", { withTimezone: true }),
  errorCode: text("error_code"), sourceHash: text("source_hash"), sourceSnapshot: text("source_snapshot"), result: jsonb("result"),
  createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const itemSummaries = pgTable("item_summaries", {
  resourceId: uuid("resource_id").primaryKey().references(() => resources.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceRevision: integer("source_revision").notNull(), sourceHash: text("source_hash").notNull(),
  sourceSnapshot: jsonb("source_snapshot").notNull(), result: jsonb("result").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  model: text("model").notNull(), promptVersion: text("prompt_version").notNull(), createdAt: createdAt(),
});
export const summaryUsage = pgTable("summary_usage", {
  jobId: uuid("job_id").primaryKey(), userId: uuid("user_id").notNull(),
  reservedTokens: integer("reserved_tokens").notNull(), actualTokens: integer("actual_tokens"),
  costUsd: numeric("cost_usd", { precision: 14, scale: 8 }).notNull().default("0"),
  outcome: text("outcome").notNull().default("reserved"), createdAt: createdAt(),
});

export const summaryRequests = pgTable("summary_requests", {
  userId: uuid("user_id").notNull().references(()=>users.id,{onDelete:"cascade"}), requestId: uuid("request_id").notNull(),
  jobId: uuid("job_id").notNull().references(()=>itemJobs.id,{onDelete:"cascade"}),
  resourceId: uuid("resource_id").notNull().references(()=>resources.id,{onDelete:"cascade"}), requestedRevision: integer("requested_revision").notNull(),createdAt:createdAt(),
},t=>[primaryKey({columns:[t.userId,t.requestId]})]);

export const backupRestores = pgTable("backup_restores", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  sessionHash: text("session_hash").references(() => sessions.hash, { onDelete: "set null" }),
  manifest: jsonb("manifest"), manifestHash: text("manifest_hash"),
  createdProjects: uuid("created_projects").array().notNull().default(sql`'{}'`),
  busyUntil: timestamp("busy_until", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now()+interval '30 minutes'`),
  createdAt: createdAt(),
});
export const backupRestoreItems = pgTable("backup_restore_items", {
  transferHash: text("transfer_hash").notNull().references(() => backupRestores.tokenHash, { onDelete: "cascade", onUpdate: "cascade" }),
  originId: uuid("origin_id").notNull(),
  resourceId: uuid("resource_id").references(() => resources.id, { onDelete: "set null" }),
  sourceOriginId: uuid("source_origin_id"), created: boolean("created").notNull().default(false),
}, t => [primaryKey({ columns: [t.transferHash,t.originId] })]);
