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
      `[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${(p.text || "").slice(0, 1000)}`
    ).join("\n\n");

    const excludeBlock = (exclude as string[]).length
      ? `\nDo NOT repeat these stems:\n${(exclude as string[]).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
      : "";

    const system = `You are MedPager, generating single-best-answer MCQs for Indian MBBS/NEET-PG exam preparation.

RULES:
1. Use ONLY facts present in the SOURCE TEXT.
2. Generate 6 new MCQs, different from any excluded stems.
3. Each MCQ has exactly 4 options. Mark the correct index (0-based).
4. Include a one-line "why" with the reasoning.
5. Include "citation_page" (from [PAGE n] in the source).
6. Write in ${lang} but keep drug names, eponyms, classifications in English.
7. Return ONLY valid JSON — no markdown, no backticks.${excludeBlock}

JSON shape: { "quiz": [ { "q": "stem", "options": ["a","b","c","d"], "correct": 0, "why": "reason", "citation_page": number | null } ] }`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.7,
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
