# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MedPager is a study platform for Indian medical students. Students upload a textbook chapter PDF and receive exam-ready study materials: a pager (structured notes), a tutor (Q&A), a quiz (MCQs), and revision flashcards — all in their chosen language with source citations for verification.

## Commands

```bash
npm install          # Install dependencies
npm run dev         # Start dev server (http://localhost:5173)
npm run build       # Build for production
npm run preview     # Preview production build
```

For the live `/api/generate` function locally, use `vercel dev` instead of `npm run dev`.

## Architecture

```
Browser (React + PDF.js)  ──POST──>  Vercel Serverless (/api/generate)  ──>  OpenAI API
                                │
                                └── citation verification pass
```

- **PDF text extraction happens in the browser** via PDF.js (`pdfjs-dist`). Each page is extracted with its page number for accurate citations.
- **The backend (`api/generate.js`)** receives page-tagged text, sends it to OpenAI with a system prompt enforcing anti-hallucination rules, verifies each citation quote exists in the source, and returns structured JSON.
- **Frontend (`src/App.jsx`)** renders four views: Pager, Ask the book, Quiz, and Revision — all with verified citations.

## Key Implementation Details

### PDF Extraction (`src/App.jsx:53-59`)
Browser extracts PDF page-by-page using PDF.js. Max 60 pages to stay within API limits.

```javascript
async function extractPdf(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];const max=Math.min(pdf.numPages,60);
  for(let p=1;p<=max;p++){const page=await pdf.getPage(p);const c=await page.getTextContent();pages.push({page:p,text:c.items.map(it=>it.str).join(" ")});}
  return{pages,total:pdf.numPages};
}
```

### Serverless API (`api/generate.js:10-114`)
- Trims source to ~28k characters to stay within token budget
- Enforces absolute rules: only use source text, mandatory citations, "Not covered in this chapter" for unsupported claims
- Verification pass checks each `citation_quote` exists in the source text
- Returns `citation_status: "verified"` or `"unverified"` for each item

### Multi-language Support (`src/App.jsx:13`)
Supported languages: English, Hindi, Bengali, Tamil, Telugu, Marathi, Kannada. Medical terms stay in English regardless of chosen language.

### Fallback Sample (`src/App.jsx:16-45`)
If API fails or demo mode is on, the app shows a built-in sample about "Fracture of the Neck of Femur" — real orthopedics content with verified citations.

## Environment Variables

```bash
OPENAI_API_KEY      # Required for live generation
OPENAI_MODEL     # Optional: defaults to gpt-4o
```

Copy `.env.example` to `.env.local` before running live.

## Deployment

Deploy to Vercel — it auto-detects Vite and serves the `/api` folder as serverless functions. Add `OPENAI_API_KEY` and `OPENAI_MODEL` in Vercel dashboard under Environment Variables.

## Key Safety Feature: Citation Verification

Every AI output must include:
- `citation_page`: source page number
- `citation_quote`: verbatim excerpt (max 20 words)

The backend verifies quotes exist in source text. Unverified quotes display an orange warning instead of green checkmark. This makes hallucination visible to users rather than hidden.

## Extending to Anthropic Claude

Only `api/generate.js` changes—specifically the fetch block (~lines 66-79) plus response parsing. Frontend stays identical. Endpoint becomes `https://api.anthropic.com/v1/messages`, headers use `x-api-key` + `anthropic-version`, response read from `data.content[0].text`.