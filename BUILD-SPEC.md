# MedPager — Build Specification (v1)

*A study platform for Indian medical students: upload a chapter, get exam-ready notes, a tutor, quizzes, and revision — in your own language. Plus a shared library of AI-generated notes (never the books themselves).*

---

## 1. What this product is

A student uploads a textbook chapter (PDF). The platform reads it and produces:

- An **exam-format pager** (Definition → Classification → Clinical Features → Investigations → Management → Complications) in Indian theory-answer style.
- An **"Ask the book" tutor** — the student types a doubt, gets a model answer drawn only from the chapter.
- A **solo quiz** (auto-generated MCQs with explanations).
- **Revision cards** for last-minute recall.
- **In the student's chosen language** (English, Hindi, Bengali, etc.), with medical terms kept in English.
- Every AI-generated point carries a **source citation**: the book name + page + the actual sentence it was drawn from.

Students contribute to a **shared notes library**, organized by specialty, so common chapters don't get re-processed by everyone. The library holds *the AI notes*, never the uploaded PDFs.

---

## 2. The legal model (read this first — it shapes the whole build)

This is the single most important design constraint.

**Allowed and safe:**
- A student uploads their own book for their own private use. The PDF is processed and **not stored** (or stored only transiently, encrypted, tied to that one user).
- The platform generates *original* study notes from it. Those notes are transformative work — yours.
- AI notes can be **shared** in the library *with attribution* (book name + page reference + quoted source sentence). Attribution is a strength, not a risk: it shows the note is derived, points students to the real source, and the platform never hosts the copyrighted file.

**Forbidden — do not build:**
- A shared/public library of the **uploaded PDFs** themselves. The moment one user's uploaded textbook is accessible to others, it is redistribution of copyrighted material. This is what gets education platforms sued by medical publishers. The "a user uploaded it, not us" defense fails once you store and serve it.

**The rule in one line:** *Share the notes, cite the book, never serve the file.*

---

## 3. Core user flows

### 3.1 Upload & generate (private)
1. Student logs in, picks a **specialty** (Orthopaedics, Psychiatry, General Medicine, ENT, …) and a **language**.
2. Uploads a chapter PDF (recommend 10–50 pages; see size handling §6).
3. System extracts text, sends relevant text to the AI, returns the four outputs (pager, Q&A, quiz, revision) with citations.
4. Student studies. They can ask follow-up doubts in the tutor.

### 3.2 Shared library (notes only)
1. After generation, the student can choose to **publish the notes** to the specialty library (book name + chapter become the entry title).
2. Other students browsing that specialty see existing note-sets and can open them directly — no re-upload.
3. If a book/chapter isn't in the library, they upload it themselves (back to 3.1).
4. Library entries always show the **source citation** so users know exactly which book/page the notes came from.

### 3.3 Language
- Language is chosen at upload and can be switched per note-set.
- Medical/technical terms (drug names, anatomy, eponyms) stay in English even inside a Hindi/Bengali answer — this matches how Indian exams and clinicians actually work.

---

## 4. Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser   │     │  Backend (API)   │     │   AI Model      │
│  (React)    │────▶│  serverless/Node │────▶│ OpenAI / Claude │
│             │     │                  │     │                 │
│ pdf.js      │     │ - auth           │     └─────────────────┘
│ extracts    │     │ - chunking/RAG   │
│ PDF text    │     │ - prompt + lang  │     ┌─────────────────┐
└─────────────┘     │ - citation merge │────▶│   Database      │
                    └──────────────────┘     │  (Postgres)     │
                                             │ users, notes,   │
                                             │ library, specs  │
                                             └─────────────────┘
```

- **PDF text is extracted in the browser** (pdf.js) so the raw file ideally never lands on your server — strongest privacy/legal posture.
- **The backend never exposes the API key**; it relays calls and merges citations.
- **The database stores users and generated notes** — never copyrighted PDFs.

### Recommended stack
- **Frontend:** React + Vite (you already have the demo UI).
- **Backend:** Vercel serverless functions (or a small Node/Express server).
- **Database:** Postgres (Supabase is the fastest path — gives you auth + DB + storage in one, and a generous free tier).
- **Auth:** Supabase Auth or Clerk (email + Google login).
- **AI:** OpenAI (your existing key) or Anthropic Claude. Swappable — only the backend call changes.

---

## 5. Hallucination control (the medical-credibility layer)

Hallucination cannot be reduced to zero, but this stack makes it safe for a medical audience:

1. **Grounding** — send only the chapter text; system prompt forbids using outside knowledge.
2. **"Not covered" rule** — model must say *"Not covered in this chapter"* rather than guess.
3. **Inline source citations** — every pager point and every answer quotes the **exact source sentence + page** it came from. This is the verification layer the student (or a doctor) can actually check. A page number alone is useless; the quoted sentence is the proof.
4. **Low temperature** (0.2) for conservative output.
5. **Stronger model for medicine** — prefer GPT-4o / Claude Sonnet over the mini/cheap tiers for the live product.
6. **Human review for published library notes** — optionally, notes only enter the shared library after the uploader confirms they look correct (cheap, crowd-sourced QA).

> **Disclaimer to show in-product:** "AI-generated study aid. Verify against your textbook before relying on it. Not a substitute for clinical or examination authority."

---

## 6. Large PDF handling (chunking / RAG)

A whole textbook is too big to send in one request — too large for the model's context, too slow, too costly. The fix is **chunking + retrieval**:

1. On upload, split the chapter/book into overlapping **chunks** (e.g. ~1,000 words each), tagged with their page numbers.
2. Store chunk embeddings (vector store — Supabase has pgvector built in).
3. **For the pager:** summarize chunk-by-chunk, then synthesize.
4. **For "Ask the book":** embed the student's question, retrieve only the most relevant chunks, send those to the model. This is what makes citations precise (you know which chunk/page each fact came from) *and* keeps cost low.
5. **For the demo / v1:** cap at a single chapter (~25k characters) and skip the vector store — straight summarization. Add RAG when you move to whole-book support.

**Page-limit UX:** if a PDF exceeds the cap, show a friendly prompt — "This looks like a whole book. Upload the chapter you're studying for best results," with the option to process the first N pages.

---

## 7. Data model (starting point)

```
users
  id, email, name, default_language, created_at

note_sets                      -- one generated study pack
  id, user_id, specialty, language,
  source_book_name, source_chapter,
  is_published (bool),          -- visible in shared library?
  created_at

pager_blocks
  id, note_set_id, order, label, body,
  citation_page, citation_quote

qa_items
  id, note_set_id, question, answer,
  citation_page, citation_quote

quiz_items
  id, note_set_id, stem, options (json), correct_index, explanation

revision_cards
  id, note_set_id, front, back

specialties                    -- lookup
  id, name

-- NOTE: there is deliberately NO table that stores uploaded PDF files
-- for shared access. Raw PDFs are processed transiently only.
```

---

## 8. Build phases (suggested order)

**Phase 0 — Demo (done):** single-chapter, mock-fallback, live OpenAI. Use for validation with the orthopedic network.

**Phase 1 — Live single-user MVP**
- Auth + accounts.
- Upload → live generation with **language selection** and **inline citations**.
- Save note-sets to the user's own account.
- *No shared library yet.*

**Phase 2 — Shared notes library**
- Specialty organization.
- "Publish to library" + browse/open others' note-sets (notes only, with citations).
- "Already in library?" check before re-uploading.

**Phase 3 — Whole-book support (RAG)**
- Chunking + vector store for large PDFs and precise retrieval.

**Phase 4 — Polish & monetization**
- Free tier (limited generations/month) → paid (unlimited, priority model, export to PDF).
- Optional human-verified badge on library notes.

---

## 9. Monetization (for later)
- **Freemium:** a few free generations/month; paid removes the cap.
- **Specialty packs / institutional:** sell to coaching centres or colleges.
- **Pricing anchor:** medicos already pay heavily for Marrow/PrepLadder/DAMS — willingness to pay is high. Your wedge is *"works on any book you upload, in your language,"* which none of them offer.

---

## 10. Open decisions to confirm before Phase 1
- OpenAI vs Claude as the live model (cost vs quality — test both on a real chapter).
- Supabase vs separate auth/DB/storage pieces (Supabase recommended for speed).
- Whether published library notes require uploader confirmation (recommended for medical accuracy).
- Free-tier generosity (affects cost before revenue).

---

*Phase 0 demo is built and ready. Phase 1 is the first real engineering milestone.*
