import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const requests = pgTable("requests", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  slackChannelId: text("slack_channel_id").notNull(),
  slackThreadTs: text("slack_thread_ts").notNull(),
  teamId: text("team_id"),
  requestedBy: text("requested_by").notNull(),
  summary: text("summary"),
  aiAnalysis: text("ai_analysis"),
  lawyerNotes: text("lawyer_notes"),
  assignedLawyer: text("assigned_lawyer"),
  clientContact: text("client_contact"),
  priority: text("priority").notNull().default("normal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const requestMessages = pgTable("request_messages", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  slackFileId: text("slack_file_id"),
  content: text("content"),
  analysis: text("analysis"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const installations = pgTable("installations", {
  teamId: text("team_id").primaryKey(),
  teamName: text("team_name").notNull(),
  botToken: text("bot_token").notNull(),
  botId: text("bot_id"),
  botUserId: text("bot_user_id"),
  installedBy: text("installed_by"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  threadTs: text("thread_ts").primaryKey(),
  messages: text("messages").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userContacts = pgTable(
  "user_contacts",
  {
    slackUserId: text("slack_user_id").notNull(),
    teamId: text("team_id").notNull(),
    contact: text("contact").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.slackUserId, table.teamId] }),
  }),
);
