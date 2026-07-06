import { Router } from "express";

const router = Router();

router.post("/quiz", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) { res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." }); return; }

  try {
    const { pages, language, exclude = [] } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) { res.json({ ok: false, error: "No source text provided." }); return; }

    const lang = (language || "English").trim();

    const source = pages.map((p: any) =>
      `[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${(p.text || "").slice(0, 2000)}`
    ).join("\n\n");

    const excludeBlock = (exclude as string[]).length
      ? `\nDo NOT repeat or rephrase any of these question stems:\n${(exclude as string[]).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
      : "";

    const system = `You are MedPager, generating high-quality single-best-answer MCQs for MBBS/NEET-PG examination preparation.

RULES:
1. Use ONLY facts present in the SOURCE TEXT.
2. Generate exactly 6 new MCQs.
3. Write CHALLENGING, CLINICAL questions — scenario-based (vignette) where possible, not just fact-recall.
4. Each MCQ has exactly 4 options — make distractors plausible, not obviously wrong.
5. Include a thorough "why" explanation (2–4 sentences) — explain why the correct answer is right AND briefly why each distractor is wrong.
6. Include "citation_page" (page number from SOURCE TEXT).
7. Vary question types: some scenario-based, some mechanism-based, some "next best step", some "investigation of choice", some "drug of choice".
8. Write in ${lang} but keep drug names, eponyms, lab values, and medical terms in English.
9. Return ONLY valid JSON — no markdown, no backticks.${excludeBlock}

JSON shape:
{
  "quiz": [
    {
      "q": "clinical scenario or direct question stem (50–120 words)",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "why": "detailed explanation of the correct answer and why distractors are wrong",
      "citation_page": number | null
    }
  ]
}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: `SOURCE TEXT:\n${source}` }],
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
    catch { res.json({ ok: false, error: "Malformed AI output." }); return; }

    if (!Array.isArray(parsed.quiz) || parsed.quiz.length === 0) {
      res.json({ ok: false, error: "No questions returned. Try again." });
      return;
    }

    res.json({ ok: true, quiz: parsed.quiz });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
