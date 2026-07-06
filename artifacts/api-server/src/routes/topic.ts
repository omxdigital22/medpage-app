import { Router } from "express";

const router = Router();

router.post("/topic", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) { res.json({ ok: false, error: "Server is missing OPENAI_API_KEY." }); return; }

  try {
    const { topic, pages, language } = req.body || {};
    if (!topic) { res.json({ ok: false, error: "No topic provided." }); return; }
    if (!Array.isArray(pages) || pages.length === 0) { res.json({ ok: false, error: "No source text provided." }); return; }

    const lang = (language || "English").trim();

    const source = pages.map((p: any) =>
      `[SOURCE: ${p.sourceName || "Book"} | PAGE ${p.page}]\n${(p.text || "").slice(0, 1200)}`
    ).join("\n\n");

    const system = `You are MedPager, generating a structured long answer for medical examinations (MBBS / NEET-PG style).

RULES:
1. Use ONLY information found in the SOURCE TEXT provided. Do not add facts from your own knowledge.
2. Write the answer strictly in this JSON structure:
   - introduction: brief definition and overview
   - epidemiology: incidence, prevalence, age/sex distribution, risk factors
   - clinicalFeatures: symptoms, signs, history, examination findings
   - pathologicalFeatures: pathogenesis, pathology, gross/microscopic changes
   - investigations: lab tests, imaging, special tests, their expected findings
   - management: medical treatment, surgical options, follow-up, prognosis
   - complications: early and late complications, their mechanisms
3. For each section, include a citation from the source text with:
   - section (key name), page (number), quote (verbatim ≤20 words), sourceName
4. If a section topic is not in the source, write "Not covered in the provided sources." for that section.
5. Write prose in ${lang}. Keep medical terms, drug names, and classifications in English.
6. Return ONLY valid JSON — no markdown, no backticks, no commentary.

JSON shape (exactly):
{
  "topic": "string",
  "sections": {
    "introduction": "string",
    "epidemiology": "string",
    "clinicalFeatures": "string",
    "pathologicalFeatures": "string",
    "investigations": "string",
    "management": "string",
    "complications": "string"
  },
  "citations": [
    { "section": "introduction", "page": 0, "quote": "string", "sourceName": "string" }
  ]
}`;

    const user = `Topic: ${topic}\nLanguage: ${lang}\n\nSOURCE TEXT:\n${source}`;

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
    if (!content) { res.json({ ok: false, error: "Empty response from AI." }); return; }

    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch { res.json({ ok: false, error: "AI returned malformed output. Try again." }); return; }

    res.json({ ok: true, answer: parsed });
  } catch (e) {
    res.json({ ok: false, error: String(e).slice(0, 200) });
  }
});

export default router;
