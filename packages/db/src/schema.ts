import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar
} from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  jid: varchar("jid", { length: 255 }).primaryKey(),
  displayName: text("display_name"),
  isGroup: boolean("is_group").notNull().default(false),
  allowlisted: boolean("allowlisted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    jid: varchar("jid", { length: 255 })
      .notNull()
      .references(() => conversations.jid),
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    jidCreatedAtIdx: index("messages_jid_created_at_idx").on(table.jid, table.createdAt)
  })
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    jid: varchar("jid", { length: 255 }).notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.jid, table.windowStart] })
  })
);

export const incidents = pgTable("incidents", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  jid: varchar("jid", { length: 255 }),
  kind: varchar("kind", { length: 64 }).notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const config = pgTable("config", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const controlEvents = pgTable("control_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
  kind: varchar("kind", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const workerStatus = pgTable("worker_status", {
  id: integer("id").primaryKey().default(1),
  connected: boolean("connected").notNull().default(false),
  qr: text("qr"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  lastError: text("last_error")
});
