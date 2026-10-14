import {
  pgTable,
  bigint,
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
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
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
    uniqueIndex("resource_owner_url").on(t.userId, t.url),
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
