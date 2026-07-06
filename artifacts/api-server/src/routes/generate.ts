import { Router } from "express";

const router = Router();

router.post("/generate", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) { res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." }); return; }

  try {
    const { pages, language } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) { res.json({ ok: false, error: "No source text." }); return; }

    const lang = (language || "English").trim();

    // Build source — first 200 pages, trimmed for token budget
    let budget = 30000;
    const tagged: string[] = [];
    for (const p of pages.slice(0, 200)) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${chunk}`);
    }
    const source = tagged.join("\n\n");

    const system = `You are MedPager analyzing medical study material to extract a list of topics students should learn.

RULES:
1. Read the SOURCE TEXT carefully. Identify the main medical topics, diseases, conditions, procedures, or concepts covered.
2. Return a flat list of 8–20 topic names. Each should be a standalone medical topic suitable for a long-answer exam question (e.g. "Fracture of the Neck of Femur", "Acute Pancreatitis", "Pulmonary Tuberculosis").
3. Topics should reflect what is actually in the source — do not invent topics not covered.
4. Return ONLY valid JSON. No markdown, no backticks.

JSON shape: { "topics": ["string", ...] }`;

    const user = `Language: ${lang}\n\nSOURCE TEXT:\n${source}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.1,
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
    catch { res.json({ ok: false, error: "AI returned malformed output." }); return; }

    res.json({ ok: true, topics: parsed.topics || [] });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
