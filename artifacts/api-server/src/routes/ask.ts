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

    // Up to 3000 chars per page for rich detail
    const source = pages.map((p: any) =>
      `[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${(p.text || "").slice(0, 3000)}`
    ).join("\n\n");

    const historyText = (history as any[]).slice(-8).map((m: any) =>
      `${m.role === "user" ? "Student" : "MedPager"}: ${m.content}`
    ).join("\n");

    const prevTopics = (history as any[])
      .filter((m: any) => m.role === "user")
      .map((m: any) => m.content)
      .join(", ");

    const system = `You are MedPager, an expert medical educator answering student questions from uploaded textbook material.

Your answer must be COMPREHENSIVE and EXAM-READY — suitable for a 10–20 mark MBBS/NEET-PG question.

━━━━━━━━━━━━━━━━━━━━━━
MANDATORY STANDARDS:
━━━━━━━━━━━━━━━━━━━━━━
• Write a DETAILED answer — minimum 400 words, target 600–900 words.
• Start with a precise DEFINITION if the question asks "what is" or "define" or "describe" — at least 2 full sentences.
• Use bullet points, numbered lists, and sub-headings to organise the answer.
• Include SPECIFIC DATA: drug doses, lab values, imaging findings, percentages, named signs/syndromes.
• DO NOT give the same answer as any previous question in the conversation history. If this question overlaps with a previous one, cover the DIFFERENT ASPECTS or go DEEPER into a specific sub-area.
• Cross-questions should probe mechanisms, exceptions, or clinical decision-making — not just restate facts.
• Cite the specific page from the source text where the answer comes from.
• Write in ${lang}. Keep medical terms, drug names, eponyms, and classifications in English.
${prevTopics ? `\nPrevious topics already covered: ${prevTopics}. Do NOT repeat what was already said — explore NEW angles.` : ""}

Return ONLY valid JSON — no markdown, no backticks.

JSON shape:
{
  "answer": "detailed exam-style answer using \\n for line breaks and • for bullet points, no markdown",
  "citation_page": number | null,
  "citation_quote": "verbatim quote from source ≤20 words" | null,
  "source_name": "source name" | null,
  "crossQuestions": [
    "specific follow-up cross-question 1 — probes mechanism or exception",
    "specific follow-up cross-question 2 — tests clinical decision making",
    "specific follow-up cross-question 3 — asks about complications or management detail"
  ]
}`;

    const user = `${historyText ? `Conversation history:\n${historyText}\n\n` : ""}Student question: ${question.trim()}\n\nSOURCE TEXT:\n${source}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2048,
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
