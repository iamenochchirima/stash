import {
  pgTable,
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
