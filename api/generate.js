// ─────────────────────────────────────────────────────────────────────────────
// MedPager backend — Vercel serverless function.
// Holds the OpenAI key server-side (never exposed to the browser), enforces the
// anti-hallucination contract, and returns structured study output where EVERY
// item carries a verbatim source quote + page so it can be verified against the book.
//
// Swap to Anthropic Claude later by changing ONLY the fetch block marked below.
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) return res.status(200).json({ ok: false, error: "Server is missing OPENAI_API_KEY." });

  try {
    const { pages, title, language } = req.body || {};
    // `pages` is an array of { page: number, text: string } extracted in the browser.
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(200).json({ ok: false, error: "No document text received." });
    }

    const lang = (language || "English").trim();

    // Build a page-tagged source so the model can cite exact pages.
    // Trim to keep a single chapter within budget (~28k chars).
    let budget = 28000;
    const tagged = [];
    for (const p of pages) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[PAGE ${p.page}]\n${chunk}`);
    }
    const source = tagged.join("\n\n");
    const truncated = budget <= 0;

    const system = `You are MedPager, a study-notes generator for Indian medical examinations (MBBS / NEET-PG written theory style).

ABSOLUTE RULES — these protect students who are studying for medical exams, so follow them exactly:
1. Use ONLY information found in the SOURCE TEXT below. Never add facts, drugs, doses, mechanisms, figures or classifications from your own knowledge.
2. For EVERY pager block and EVERY answer, you MUST include:
   - "citation_page": the [PAGE n] number the information came from.
   - "citation_quote": a SHORT VERBATIM excerpt (max 20 words) copied exactly from the source that supports the point.
   If you cannot find supporting text in the source, set the body to "Not covered in this chapter" and citation_page to null. NEVER invent a quote.
3. Do not paraphrase a citation_quote — it must be copied character-for-character from the source so a reader can find it in the book.
4. Output language: write all explanatory prose in ${lang}. BUT keep medical/technical terms (drug names, anatomy, eponyms, classifications) in English, as Indian exams expect. citation_quote stays in the original source language.
5. Return ONLY valid JSON. No markdown, no backticks, no commentary.

JSON shape (exactly):
{
  "heading": "string — the main topic of the chapter",
  "pager": [ { "label": "Definition|Classification|Clinical Features|Investigations|Management|Complications", "body": "string", "citation_page": number|null, "citation_quote": "string|null" } ],
  "qa": [ { "q": "likely exam question", "a": "model answer in exam style", "citation_page": number|null, "citation_quote": "string|null" } ],
  "quiz": [ { "q": "MCQ stem", "options": ["a","b","c","d"], "correct": 0, "why": "one-line explanation", "citation_page": number|null } ],
  "revision": [ { "front": "recall prompt", "back": "short answer" } ]
}

Provide 4-6 pager blocks, 3 qa items, 4 quiz items, 6 revision cards.`;

    const user = `Chapter title: ${title || "Untitled"}\nTarget language: ${lang}\n\nSOURCE TEXT (page-tagged):\n${source}`;

    // ── OpenAI call. To switch to Claude, replace this fetch + parsing block. ──
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
      return res.status(200).json({ ok: false, error: `AI service error (${resp.status}). ${t.slice(0, 160)}` });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return res.status(200).json({ ok: false, error: "Empty response from AI." });

    let parsed;
    try { parsed = JSON.parse(content); }
    catch { return res.status(200).json({ ok: false, error: "AI returned malformed output. Try again." }); }

    // ── Verification pass: confirm each citation_quote actually exists in the source.
    // This is the anti-hallucination safety net. Quotes that can't be found are flagged.
    const sourceFlat = source.toLowerCase().replace(/\s+/g, " ");
    const verifyQuote = (q) => {
      if (!q) return null;
      const needle = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (needle.length < 4) return "unverified";
      return sourceFlat.includes(needle) ? "verified" : "unverified";
    };
    const stamp = (item) => {
      if ("citation_quote" in item) item.citation_status = verifyQuote(item.citation_quote);
      return item;
    };
    if (Array.isArray(parsed.pager)) parsed.pager = parsed.pager.map(stamp);
    if (Array.isArray(parsed.qa)) parsed.qa = parsed.qa.map(stamp);

    return res.status(200).json({ ok: true, data: parsed, truncated, book: title || "Uploaded chapter" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e).slice(0, 200) });
  }
}
