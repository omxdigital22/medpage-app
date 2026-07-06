import { Router } from "express";

const router = Router();

router.post("/generate", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) {
    res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." });
    return;
  }

  try {
    const { pages, title, language } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) {
      res.json({ ok: false, error: "No document text received." });
      return;
    }

    const lang = (language || "English").trim();

    let budget = 28000;
    const tagged: string[] = [];
    for (const p of pages) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[PAGE ${p.page}]\n${chunk}`);
    }
    const source = tagged.join("\n\n");
    const truncated = budget <= 0;

    const system = `You are MedPager, a study-notes generator for Indian medical examinations (MBBS / NEET-PG written theory style).

ABSOLUTE RULES:
1. Use ONLY information found in the SOURCE TEXT below. Never add facts from your own knowledge.
2. For EVERY pager block and EVERY answer, you MUST include:
   - "citation_page": the [PAGE n] number the information came from.
   - "citation_quote": a SHORT VERBATIM excerpt (max 20 words) copied exactly from the source.
   If you cannot find supporting text, set body to "Not covered in this chapter" and citation_page to null. NEVER invent a quote.
3. Do not paraphrase a citation_quote — it must be copied character-for-character.
4. Output language: write all explanatory prose in ${lang}. Keep medical/technical terms in English. citation_quote stays in the original source language.
5. Return ONLY valid JSON. No markdown, no backticks, no commentary.

JSON shape (exactly):
{
  "heading": "string",
  "pager": [ { "label": "Definition|Classification|Clinical Features|Investigations|Management|Complications", "body": "string", "citation_page": number|null, "citation_quote": "string|null" } ],
  "qa": [ { "q": "likely exam question", "a": "model answer", "citation_page": number|null, "citation_quote": "string|null" } ],
  "quiz": [ { "q": "MCQ stem", "options": ["a","b","c","d"], "correct": 0, "why": "one-line explanation", "citation_page": number|null } ],
  "revision": [ { "front": "recall prompt", "back": "short answer" } ]
}

Provide 4-6 pager blocks, 3 qa items, 4 quiz items, 6 revision cards.`;

    const user = `Chapter title: ${title || "Untitled"}\nTarget language: ${lang}\n\nSOURCE TEXT (page-tagged):\n${source}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      res.json({ ok: false, error: `AI service error (${resp.status}). ${t.slice(0, 160)}` });
      return;
    }

    const data = await resp.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) { res.json({ ok: false, error: "Empty response from AI." }); return; }

    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { res.json({ ok: false, error: "AI returned malformed output. Try again." }); return; }

    const sourceFlat = source.toLowerCase().replace(/\s+/g, " ");
    const verifyQuote = (q: string | null) => {
      if (!q) return null;
      const needle = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (needle.length < 4) return "unverified";
      return sourceFlat.includes(needle) ? "verified" : "unverified";
    };
    const stamp = (item: any) => {
      if ("citation_quote" in item) item.citation_status = verifyQuote(item.citation_quote);
      return item;
    };
    if (Array.isArray(parsed.pager)) parsed.pager = parsed.pager.map(stamp);
    if (Array.isArray(parsed.qa)) parsed.qa = parsed.qa.map(stamp);

    res.json({ ok: true, data: parsed, truncated, book: title || "Uploaded chapter" });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
