import { Router } from "express";

const router = Router();

router.post("/ask", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) { res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." }); return; }

  try {
    const { question, pages, language, history = [] } = req.body || {};
    if (!question?.trim()) { res.json({ ok: false, error: "No question provided." }); return; }
    if (!Array.isArray(pages) || pages.length === 0) { res.json({ ok: false, error: "No source text available." }); return; }

    const lang = (language || "English").trim();

    const source = pages.map((p: any) =>
      `[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${(p.text || "").slice(0, 1000)}`
    ).join("\n\n");

    const historyText = (history as any[]).slice(-8).map((m: any) =>
      `${m.role === "user" ? "Student" : "MedPager"}: ${m.content}`
    ).join("\n");

    const system = `You are MedPager, a medical study assistant answering student questions from uploaded textbook material.

RULES:
1. Read the SOURCE TEXT carefully before answering.
2. Base your answer on the SOURCE TEXT. Do not fabricate facts.
3. Respond in ${lang}, keeping medical terms, drug names, eponyms, and classifications in English.
4. After your answer, generate 3 brief follow-up cross-questions a student might ask next — these help deepen understanding.
5. Return ONLY valid JSON — no markdown, no backticks.

JSON shape:
{
  "answer": "detailed exam-style answer",
  "citation_page": number | null,
  "citation_quote": "short verbatim quote from source (max 20 words)" | null,
  "source_name": "name of the source the answer came from" | null,
  "crossQuestions": ["follow-up question 1", "follow-up question 2", "follow-up question 3"]
}`;

    const user = `${historyText ? `Conversation so far:\n${historyText}\n\n` : ""}Student question: ${question.trim()}\n\nSOURCE TEXT:\n${source}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      res.json({ ok: false, error: `AI error (${resp.status}). ${t.slice(0, 200)}` });
      return;
    }

    const data = await resp.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) { res.json({ ok: false, error: "Empty AI response." }); return; }

    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { res.json({ ok: false, error: "Malformed AI output. Try again." }); return; }

    res.json({
      ok: true,
      answer: parsed.answer || "",
      citation_page: parsed.citation_page ?? null,
      citation_quote: parsed.citation_quote ?? null,
      source_name: parsed.source_name ?? null,
      crossQuestions: Array.isArray(parsed.crossQuestions) ? parsed.crossQuestions.slice(0, 3) : [],
    });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
