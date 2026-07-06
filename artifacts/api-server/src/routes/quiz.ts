import { Router } from "express";

const router = Router();

router.post("/quiz", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) {
    res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." });
    return;
  }

  try {
    const { pages, book, language, exclude = [] } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) {
      res.json({ ok: false, error: "No chapter text. Please re-upload the PDF." });
      return;
    }

    const lang = (language || "English").trim();

    let budget = 40000;
    const tagged: string[] = [];
    for (const p of pages) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[PAGE ${p.page}]\n${chunk}`);
    }
    const source = tagged.join("\n\n");

    const excludeBlock = (exclude as string[]).length
      ? `\nDo NOT repeat these question stems:\n${(exclude as string[]).map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
      : "";

    const system = `You are MedPager, generating NEW single-best-answer MCQs for Indian MBBS/NEET-PG exam preparation.

RULES:
1. Use ONLY facts present in the SOURCE TEXT below.
2. Write 6 MCQs that are DIFFERENT from any excluded questions.
3. Each MCQ must have exactly 4 options (a–d). Mark the correct option index (0-based).
4. Include a one-line "why" explanation.
5. Include "citation_page" (the [PAGE n] number the fact came from).
6. Write question stems and options in ${lang} but keep drug names, eponyms, and medical terms in English.
7. Return ONLY valid JSON — no markdown, no backticks.${excludeBlock}

JSON shape (exactly):
{ "quiz": [ { "q": "stem", "options": ["a","b","c","d"], "correct": 0, "why": "one-line reason", "citation_page": number|null } ] }`;

    const user = `Chapter: ${book || "Uploaded chapter"}\n\nSOURCE TEXT:\n${source}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      res.json({ ok: false, error: `AI error (${resp.status}). ${t.slice(0, 160)}` });
      return;
    }

    const data = await resp.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) { res.json({ ok: false, error: "Empty response from AI." }); return; }

    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { res.json({ ok: false, error: "AI returned malformed output. Try again." }); return; }

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
