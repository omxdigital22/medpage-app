import { pgTable, varchar, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const studySessionsTable = pgTable("study_sessions", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  mode: varchar("mode").notNull().default("longAnswer"),
  language: varchar("language").notNull().default("English"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const sourceFilesTable = pgTable("source_files", {
  id: varchar("id").primaryKey(),
  studySessionId: varchar("study_session_id").notNull().references(() => studySessionsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  name: varchar("name").notNull(),
  fileType: varchar("file_type").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: varchar("id").primaryKey(),
  studySessionId: varchar("study_session_id").notNull().references(() => studySessionsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  role: varchar("role").notNull(),
  content: text("content").notNull(),
  citationPage: integer("citation_page"),
  citationQuote: text("citation_quote"),
  sourceName: varchar("source_name"),
  crossQuestions: jsonb("cross_questions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const savedAnswersTable = pgTable("saved_answers", {
  id: varchar("id").primaryKey(),
  studySessionId: varchar("study_session_id").notNull().references(() => studySessionsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  topic: varchar("topic").notNull(),
  sections: jsonb("sections").notNull(),
  citations: jsonb("citations").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StudySession = typeof studySessionsTable.$inferSelect;
export type SourceFile = typeof sourceFilesTable.$inferSelect;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
export type SavedAnswer = typeof savedAnswersTable.$inferSelect;
