// MedPager — free-text Q&A against an uploaded chapter.
// Receives: { question, pages, book, language }
// Returns:  { ok, answer, citation_page, citation_quote, citation_status }
//
// Strategy: extract keywords from the question, rank pages by relevance,
// send the most relevant pages first so the answer is never buried by the
// sequential budget cut-off.

function scorePageRelevance(pageText, keywords) {
  const lower = pageText.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    let pos = 0;
    while ((pos = lower.indexOf(kw, pos)) !== -1) { score++; pos++; }
  }
  return score;
}

function extractKeywords(question) {
  const stopwords = new Set(["what","is","are","the","a","an","of","in","on","by","to","how","why","when","does","do","was","were","has","have","explain","define","describe","give","list","name"]);
  return question.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  if (!key) return res.status(200).json({ ok: false, error: "Server is missing OPENAI_API_KEY." });

  try {
    const { question, pages, book, language } = req.body || {};
    if (!question || !question.trim()) {
      return res.status(200).json({ ok: false, error: "No question provided." });
    }
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(200).json({ ok: false, error: "No chapter text available. Please re-upload the PDF." });
    }

    const lang = (language || "English").trim();
    const keywords = extractKeywords(question);

    // Score every page by keyword hits, then sort: relevant pages first, rest after.
    const scored = pages.map(p => ({
      ...p,
      score: scorePageRelevance(p.text || "", keywords),
    }));
    scored.sort((a, b) => b.score - a.score || a.page - b.page);

    // Fill up to 50k chars, relevant pages first.
    let budget = 50000;
    const tagged = [];
    for (const p of scored) {
      if (budget <= 0) break;
      const chunk = (p.text || "").slice(0, budget);
      budget -= chunk.length;
      tagged.push(`[PAGE ${p.page}]\n${chunk}`);
    }
    // Re-sort by page number so the model sees them in reading order.
    tagged.sort((a, b) => {
      const pa = parseInt(a.match(/^\[PAGE (\d+)\]/)?.[1] || "0");
      const pb = parseInt(b.match(/^\[PAGE (\d+)\]/)?.[1] || "0");
      return pa - pb;
    });
    const source = tagged.join("\n\n");

    const system = `You are MedPager, a medical study assistant answering student questions from a textbook chapter.

RULES:
1. Search the ENTIRE SOURCE TEXT carefully before deciding the topic is absent.
2. Answer from the SOURCE TEXT. Do not invent facts not present in the source.
3. Respond in ${lang}, keeping all medical/technical terms, drug names, eponyms and classifications in English.
4. Return ONLY valid JSON — no markdown, no backticks.
5. Only set answer to "This topic is not covered in the uploaded chapter." if you have genuinely searched the full source and found nothing relevant. If you find even partial information, use it and note what is and isn't covered.

JSON shape (exactly):
{
  "answer": "clear exam-style answer",
  "citation_page": number | null,
  "citation_quote": "verbatim short quote (max 20 words) copied exactly from the source" | null
}`;

    const user = `Chapter: ${book || "Uploaded chapter"}
Question: ${question.trim()}

SOURCE TEXT (full chapter, page-tagged):
${source}`;

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

    // Verify citation quote exists verbatim in source
    const sourceFlat = source.toLowerCase().replace(/\s+/g, " ");
    let citation_status = null;
    if (parsed.citation_quote) {
      const needle = parsed.citation_quote.toLowerCase().replace(/\s+/g, " ").trim();
      citation_status = needle.length >= 4 && sourceFlat.includes(needle) ? "verified" : "unverified";
    }

    return res.status(200).json({
      ok: true,
      answer: parsed.answer || "",
      citation_page: parsed.citation_page ?? null,
      citation_quote: parsed.citation_quote ?? null,
      citation_status,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e).slice(0, 200) });
  }
}
