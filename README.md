# MedPager — Phase 1 (live, cited, multi-language)

A study platform for Indian medical studentss. Upload a textbook **chapter** PDF →
get an exam-format pager, a tutor, a quiz, and revision cards — in the student's
chosen language. **Every point shows the book, page, and the exact source line**,
so it can be verified against the textbook.

This is a deployable, self-contained app: a Vite + React frontend and one Vercel
serverless function that calls the OpenAI API. The API key never reaches the browser.

---

## Quick deploy (Vercel — recommended, ~10 min)

1. Push this folder to a GitHub repo.
2. vercel.com → **New Project** → import the repo. Vercel auto-detects Vite.
3. **Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = the OpenAI key
   - `OPENAI_MODEL` = `gpt-4o` (recommended for medical accuracy) or `gpt-4o-mini` (cheaper)
4. **Deploy.** The frontend is served statically; `/api/generate` runs as a function.

Works the same on any platform that supports Vite static build + Node serverless
functions. For a plain static host (Netlify static, GitHub Pages) you'd need to
host the `/api` function separately (e.g. as a Netlify/Cloud function) — Vercel is
simplest because it does both.

## Run locally

```bash
npm install
cp .env.example .env.local      # put the real key in .env.local
npm run dev                     # UI loads; for the live /api function use `vercel dev`
```
Without the function running, the app shows the built-in **sample** output (it never breaks).

---

## How hallucination is controlled (important — this is a medical tool)

The whole pipeline is built around **"don't make things up, and prove every claim."**

1. **Grounding.** Only the uploaded chapter's text is sent to the model. The system
   prompt forbids using outside knowledge.
2. **Mandatory citations.** For every pager block and every answer, the model must
   return `citation_page` and a **verbatim** `citation_quote` copied from the source.
   If it can't find support, it must write "Not covered in this chapter" — never guess.
3. **Server-side verification pass** (`api/generate.js`). After the model responds,
   the backend checks that each `citation_quote` actually exists in the source text.
   - Found → marked `verified` (green ✓ source · Book, p.N — "quote").
   - Not found → marked `unverified` (orange ⚠) with a warning shown to the user.
   This makes any hallucinated citation **visible instead of hidden** — the single
   most important safety property for a doctor-facing product.
4. **Low temperature (0.1)** for conservative output.
5. **Model choice.** `gpt-4o` hallucinates less than the mini tier; default to it here.
6. **In-product disclaimer** on every results screen: verify against the textbook.

No system makes hallucination literally impossible. This design ensures that when
it happens, the user can see it and check the book — which is exactly what was asked for.

---

## Language

The student picks a language in the header (English, Hindi, Bengali, Tamil, Telugu,
Marathi, Kannada — extend the `LANGS` array in `src/App.jsx`). Explanatory prose is
written in that language; **medical/technical terms (drug names, anatomy, eponyms,
classifications) stay in English**, matching Indian exam convention. The verbatim
citation quote stays in the source's original language.

---

## PDF size

The browser extracts text **page by page** (so citations get real page numbers) and
the backend trims to ~28k characters to keep one chapter within model limits and cost.
A "long PDF trimmed to fit" badge shows when this happens.

**For whole-book support**, implement chunking + retrieval (RAG) — see §6 of the
build spec. That is the Phase 3 milestone and is out of scope for this Phase 1 app.

---

## Switching from OpenAI to Anthropic Claude later

Only `api/generate.js` changes — specifically the single `fetch` block marked in a
comment, plus response parsing. Endpoint becomes `https://api.anthropic.com/v1/messages`,
headers become `x-api-key` + `anthropic-version: 2023-06-01`, and the response is read
from `data.content[0].text`. The frontend and the entire citation/verification system
stay identical.

---

## Project structure

```
medpager-app/
├── api/generate.js      ← serverless function: OpenAI call + citation verification
├── src/
│   ├── App.jsx          ← full UI (upload, pager, tutor, quiz, revision, citations)
│   └── main.jsx
├── index.html
├── vite.config.js
├── vercel.json          ← sets function max duration to 60s
├── .env.example         ← copy to .env.local
└── package.json
```

## Known limits in this Phase 1 build (by design)
- **Single chapter**, not whole books (RAG is Phase 3).
- **"Ask the book" free-text box** routes to prepared questions; live free-text Q&A
  over the chapter is a Phase 2 item.
- **No accounts / no shared library yet** — those are Phase 1.5 / Phase 2 in the spec.
- Raw PDFs are processed transiently and not stored. **Do not** add a shared store of
  uploaded PDFs — see the legal model in the build spec (share notes + citations, never the file).
