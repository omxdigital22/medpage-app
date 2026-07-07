import { Router, type IRouter, type Request, type Response } from "express";
import { db, studySessionsTable, sourceFilesTable, chatMessagesTable, savedAnswersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ ok: false, error: "Not authenticated." });
    return false;
  }
  return true;
}

function uid() { return crypto.randomBytes(12).toString("hex"); }

function routeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

// ── Study Sessions ──────────────────────────────────────────────────────────

router.get("/data/sessions", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessions = await db
    .select()
    .from(studySessionsTable)
    .where(eq(studySessionsTable.userId, req.user!.id))
    .orderBy(desc(studySessionsTable.updatedAt))
    .limit(50);
  // attach source counts
  const withCounts = await Promise.all(sessions.map(async (s) => {
    const sources = await db.select().from(sourceFilesTable).where(eq(sourceFilesTable.studySessionId, s.id));
    const msgs = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.studySessionId, s.id));
    const answers = await db.select().from(savedAnswersTable).where(eq(savedAnswersTable.studySessionId, s.id));
    return { ...s, sourceCount: sources.length, messageCount: msgs.length, answerCount: answers.length };
  }));
  res.json({ ok: true, sessions: withCounts });
});

router.post("/data/sessions", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const { title, mode, language } = req.body || {};
  if (!title) { res.status(400).json({ ok: false, error: "title is required" }); return; }
  const id = uid();
  const [session] = await db.insert(studySessionsTable).values({
    id, userId: req.user!.id,
    title: String(title).slice(0, 200),
    mode: mode || "longAnswer",
    language: language || "English",
  }).returning();
  res.json({ ok: true, session });
});

router.delete("/data/sessions/:id", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  await db.delete(studySessionsTable).where(
    and(eq(studySessionsTable.id, sessionId), eq(studySessionsTable.userId, req.user!.id))
  );
  res.json({ ok: true });
});

// ── Source Files ────────────────────────────────────────────────────────────

router.post("/data/sessions/:id/sources", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const { files } = req.body || {};
  if (!Array.isArray(files)) { res.status(400).json({ ok: false, error: "files array required" }); return; }
  const rows = await db.insert(sourceFilesTable).values(
    files.map((f: any) => ({
      id: uid(),
      studySessionId: sessionId,
      userId: req.user!.id,
      name: String(f.name).slice(0, 200),
      fileType: String(f.type || "pdf"),
      pageCount: Number(f.pageCount) || 0,
    }))
  ).returning();
  res.json({ ok: true, sources: rows });
});

router.get("/data/sessions/:id/sources", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const sources = await db.select().from(sourceFilesTable).where(
    and(eq(sourceFilesTable.studySessionId, sessionId), eq(sourceFilesTable.userId, req.user!.id))
  );
  res.json({ ok: true, sources });
});

// ── Chat Messages ───────────────────────────────────────────────────────────

router.get("/data/sessions/:id/messages", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const messages = await db.select().from(chatMessagesTable)
    .where(and(eq(chatMessagesTable.studySessionId, sessionId), eq(chatMessagesTable.userId, req.user!.id)))
    .orderBy(chatMessagesTable.createdAt);
  res.json({ ok: true, messages });
});

router.post("/data/sessions/:id/messages", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const { role, content, citationPage, citationQuote, sourceName, crossQuestions } = req.body || {};
  if (!role || !content) { res.status(400).json({ ok: false, error: "role and content required" }); return; }
  const [msg] = await db.insert(chatMessagesTable).values({
    id: uid(),
    studySessionId: sessionId,
    userId: req.user!.id,
    role: String(role),
    content: String(content),
    citationPage: citationPage || null,
    citationQuote: citationQuote || null,
    sourceName: sourceName || null,
    crossQuestions: crossQuestions || null,
  }).returning();
  // bump session updatedAt
  await db.update(studySessionsTable).set({ updatedAt: new Date() }).where(eq(studySessionsTable.id, sessionId));
  res.json({ ok: true, message: msg });
});

// ── Saved Answers ───────────────────────────────────────────────────────────

router.get("/data/sessions/:id/answers", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const answers = await db.select().from(savedAnswersTable)
    .where(and(eq(savedAnswersTable.studySessionId, sessionId), eq(savedAnswersTable.userId, req.user!.id)))
    .orderBy(desc(savedAnswersTable.createdAt));
  res.json({ ok: true, answers });
});

router.post("/data/sessions/:id/answers", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;
  const sessionId = routeParam(req.params.id);
  const { topic, sections, citations } = req.body || {};
  if (!topic || !sections) { res.status(400).json({ ok: false, error: "topic and sections required" }); return; }
  const [ans] = await db.insert(savedAnswersTable).values({
    id: uid(),
    studySessionId: sessionId,
    userId: req.user!.id,
    topic: String(topic).slice(0, 300),
    sections: sections as Record<string,unknown>,
    citations: (citations || []) as unknown[],
  }).returning();
  await db.update(studySessionsTable).set({ updatedAt: new Date() }).where(eq(studySessionsTable.id, sessionId));
  res.json({ ok: true, answer: ans });
});

export default router;
