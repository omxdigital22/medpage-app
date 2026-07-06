// MedPager — generate a fresh set of MCQs from the uploaded chapter.
// Receives: { pages, book, language, exclude }  (exclude = array of question stems already seen)
// Returns:  { ok, quiz: [ { q, options, correct, why, citation_page } ] }

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) return res.status(200).json({ ok: false, error: "Server is missing OPENAI_API_KEY." });

  try {
    const { pages, book, language, exclude = [] } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(200).json({ ok: false, error: "No chapter text. Please re-upload the PDF." });
    }

    const lang = (language || "English").trim();

    let budget = 40000;
    const tagged = [];
    for (const p of pages) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[PAGE ${p.page}]\n${chunk}`);
    }
    const source = tagged.join("\n\n");

    const excludeBlock = exclude.length
      ? `\nDo NOT repeat these question stems:\n${exclude.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n`
      : "";

    const system = `You are MedPager, generating NEW single-best-answer MCQs for Indian MBBS/NEET-PG exam preparation.

RULES:
1. Use ONLY facts present in the SOURCE TEXT below.
2. Write 6 MCQs that are DIFFERENT from any excluded questions.
3. Each MCQ must have exactly 4 options (a–d). Mark the correct option index (0-based).
4. Include a one-line "why" explanation citing why the correct answer is right.
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
      return res.status(200).json({ ok: false, error: `AI error (${resp.status}). ${t.slice(0, 160)}` });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(200).json({ ok: false, error: "Empty response from AI." });

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(200).json({ ok: false, error: "AI returned malformed output. Try again." }); }

    if (!Array.isArray(parsed.quiz) || parsed.quiz.length === 0) {
      return res.status(200).json({ ok: false, error: "No questions returned. Try again." });
    }

    return res.status(200).json({ ok: true, quiz: parsed.quiz });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e).slice(0, 200) });
  }
}
