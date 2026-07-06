import React, { useState, useRef, useCallback } from "react";
// @ts-ignore
import * as pdfjsLib from "pdfjs-dist";
// @ts-ignore
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// @ts-ignore
import JSZip from "jszip";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const INK = "#13201c", PAPER = "#f6f4ee", HEAL = "#1f7a5a", HEAL_DK = "#155c43";
const BONE = "#e8e2d4", ACCENT = "#c9603f", MUTED = "#5d6b64", LINE = "#d8d3c4";
const LANGS = ["English","Hindi","Bengali","Tamil","Telugu","Marathi","Kannada"];

const SECTION_ORDER = ["introduction","epidemiology","clinicalFeatures","pathologicalFeatures","investigations","management","complications"];
const SECTION_LABELS: Record<string,string> = {
  introduction: "Introduction",
  epidemiology: "Epidemiology",
  clinicalFeatures: "Clinical Features",
  pathologicalFeatures: "Pathological Features",
  investigations: "Investigations",
  management: "Management",
  complications: "Complications",
};

interface PageData { page: number; text: string; sourceName: string; sourceId: string; }
interface ProcessedSource {
  id: string; name: string;
  type: "pdf"|"image"|"docx"|"pptx";
  pages: { page: number; text: string }[];
  imageDataUrl?: string;
  pdfDoc?: any;
  status: "processing"|"done"|"error";
  error?: string;
  totalPages?: number;
  processedPages: number;
}
interface LongAnswer {
  topic: string;
  sections: Partial<Record<string,string>>;
  citations: { section: string; page: number; quote: string; sourceName: string }[];
}
interface ChatMessage {
  id: number; role: "user"|"assistant";
  content: string;
  citation?: { page: number; quote: string; sourceName: string };
  crossQuestions?: string[];
}
interface QuizQuestion {
  q: string; options: string[]; correct: number; why: string; citation_page: number|null;
}

// ── helpers ────────────────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const stop = new Set(["what","is","are","the","a","an","of","in","on","by","to","how","why","when","does","do","was","were","has","have","explain","define","describe","give","list","name","and","or","for","with","from"]);
  return text.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
}

function scoreRelevance(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) { let p = 0; while ((p = lower.indexOf(kw, p)) !== -1) { score++; p++; } }
  return score;
}

function getRelevantPages(all: PageData[], query: string, maxChars = 90000): PageData[] {
  const kws = extractKeywords(query);
  if (kws.length === 0) {
    // No keywords — return first N pages up to budget
    let budget = maxChars;
    const result: PageData[] = [];
    for (const p of all) {
      if (budget <= 0) break;
      const chunk = p.text.slice(0, budget);
      budget -= chunk.length;
      result.push({ ...p, text: chunk });
    }
    return result;
  }
  // TF-IDF-style: weight rare keywords higher
  const kwFreq = new Map<string, number>();
  for (const p of all) {
    const lower = p.text.toLowerCase();
    const seen = new Set<string>();
    for (const kw of kws) { if (lower.includes(kw) && !seen.has(kw)) { kwFreq.set(kw, (kwFreq.get(kw) || 0) + 1); seen.add(kw); } }
  }
  const scored = all.map(p => {
    const lower = p.text.toLowerCase();
    let score = 0;
    for (const kw of kws) {
      const df = kwFreq.get(kw) || 1;
      const idf = Math.log(all.length / df + 1);
      let pos = 0, tf = 0;
      while ((pos = lower.indexOf(kw, pos)) !== -1) { tf++; pos++; }
      score += tf * idf;
    }
    return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score || a.page - b.page);
  let budget = maxChars;
  const result: PageData[] = [];
  for (const p of scored) {
    if (budget <= 0) break;
    const chunk = p.text.slice(0, budget);
    budget -= chunk.length;
    result.push({ ...p, text: chunk });
  }
  result.sort((a, b) => a.page - b.page);
  return result;
}

function formatPages(pages: PageData[]): string {
  return pages.map(p => `[SOURCE: ${p.sourceName} | PAGE ${p.page}]\n${p.text}`).join("\n\n");
}

async function extractPdf(file: File, onProgress: (done: number, total: number) => void): Promise<{ pages: {page:number;text:string}[], pdfDoc: any }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = pdf.numPages;
  const pages: {page:number;text:string}[] = [];
  for (let p = 1; p <= total; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    pages.push({ page: p, text: c.items.map((it: any) => it.str).join(" ") });
    onProgress(p, total);
  }
  return { pages, pdfDoc: pdf };
}

async function extractImage(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

async function extractDocx(file: File): Promise<{page:number;text:string}[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return [];
  const xml = await xmlFile.async("text");
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const textNodes = doc.querySelectorAll("t");
  let text = "";
  textNodes.forEach((n: Element) => { text += n.textContent + " "; });
  // Split into ~500 word pages
  const words = text.split(/\s+/).filter(Boolean);
  const pages: {page:number;text:string}[] = [];
  const pageSize = 500;
  for (let i = 0; i < words.length; i += pageSize) {
    pages.push({ page: Math.floor(i / pageSize) + 1, text: words.slice(i, i + pageSize).join(" ") });
  }
  return pages;
}

async function extractPptx(file: File): Promise<{page:number;text:string}[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
  const pages: {page:number;text:string}[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "text/xml");
    const textNodes = doc.querySelectorAll("t");
    let text = "";
    textNodes.forEach((n: Element) => { text += n.textContent + " "; });
    pages.push({ page: i + 1, text: text.trim() });
  }
  return pages;
}

async function renderPdfPage(pdfDoc: any, pageNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.75);
}

// ── main app ───────────────────────────────────────────────────────────────

export default function App() {
  const [sources, setSources] = useState<ProcessedSource[]>([]);
  const [stage, setStage] = useState<"upload"|"workspace">("upload");
  const [mode, setMode] = useState<"longAnswer"|"mcq">("longAnswer");
  const [tab, setTab] = useState<"answer"|"mcq"|"chat">("answer");
  const [language, setLanguage] = useState("English");
  const [topics, setTopics] = useState<string[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [currentAnswer, setCurrentAnswer] = useState<LongAnswer|null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [pageImages, setPageImages] = useState<Record<string,string>>({});
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizChosen, setQuizChosen] = useState<number|null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizFin, setQuizFin] = useState(false);
  const [seenStems, setSeenStems] = useState<string[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [err, setErr] = useState("");
  const msgIdRef = useRef(0);

  const getAllPages = useCallback((): PageData[] =>
    sources.filter(s => s.status === "done").flatMap(s =>
      s.pages.map(p => ({ ...p, sourceName: s.name, sourceId: s.id }))
    ), [sources]);

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    const newSources: ProcessedSource[] = fileArr.map(f => ({
      id: Math.random().toString(36).slice(2),
      name: f.name,
      type: getFileType(f),
      pages: [],
      status: "processing",
      processedPages: 0,
    }));
    setSources(prev => [...prev, ...newSources]);
    setStage("workspace");

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      const src = newSources[i];
      try {
        const type = getFileType(file);
        if (type === "pdf") {
          const { pages, pdfDoc } = await extractPdf(file, (done, total) => {
            setSources(prev => prev.map(s => s.id === src.id ? { ...s, processedPages: done, totalPages: total } : s));
          });
          setSources(prev => prev.map(s => s.id === src.id ? { ...s, pages, pdfDoc, status: "done", processedPages: pages.length } : s));
        } else if (type === "image") {
          const img = await extractImage(file);
          setSources(prev => prev.map(s => s.id === src.id ? { ...s, imageDataUrl: img, pages: [{ page: 1, text: `[IMAGE: ${file.name}]` }], status: "done", processedPages: 1 } : s));
        } else if (type === "docx") {
          const pages = await extractDocx(file);
          setSources(prev => prev.map(s => s.id === src.id ? { ...s, pages, status: "done", processedPages: pages.length } : s));
        } else if (type === "pptx") {
          const pages = await extractPptx(file);
          setSources(prev => prev.map(s => s.id === src.id ? { ...s, pages, status: "done", processedPages: pages.length } : s));
        }
      } catch (e) {
        setSources(prev => prev.map(s => s.id === src.id ? { ...s, status: "error", error: String(e) } : s));
      }
    }
  }

  function getFileType(f: File): "pdf"|"image"|"docx"|"pptx" {
    const name = f.name.toLowerCase();
    if (name.endsWith(".pdf")) return "pdf";
    if (name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) return "image";
    if (name.endsWith(".docx")) return "docx";
    if (name.endsWith(".pptx")) return "pptx";
    return "pdf";
  }

  async function generateTopics() {
    const all = getAllPages();
    if (!all.length) return;
    setTopicsLoading(true);
    setErr("");
    try {
      const first200 = all.slice(0, 200);
      const resp = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: first200, language }),
      });
      const json = await resp.json();
      if (json.ok && json.topics) setTopics(json.topics);
      else setErr(json.error || "Failed to generate topics");
    } catch (e) { setErr(String(e)); }
    setTopicsLoading(false);
  }

  async function loadTopic(topic: string) {
    const all = getAllPages();
    if (!all.length) return;
    setSelectedTopic(topic);
    setAnswerLoading(true);
    setCurrentAnswer(null);
    setPageImages({});
    setErr("");
    try {
      const relevant = getRelevantPages(all, topic, 90000);
      const resp = await fetch("/api/topic", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, pages: relevant, language }),
      });
      const json = await resp.json();
      if (json.ok) {
        setCurrentAnswer(json.answer);
        // pre-render cited PDF pages
        const pdfSourceMap = new Map(sources.filter(s => s.pdfDoc).map(s => [s.name, s.pdfDoc]));
        for (const c of (json.answer.citations || [])) {
          const pdfDoc = pdfSourceMap.get(c.sourceName);
          if (pdfDoc && !pageImages[`${c.sourceName}:${c.page}`]) {
            try {
              const img = await renderPdfPage(pdfDoc, c.page);
              setPageImages(prev => ({ ...prev, [`${c.sourceName}:${c.page}`]: img }));
            } catch {}
          }
        }
      } else setErr(json.error || "Failed to generate answer");
    } catch (e) { setErr(String(e)); }
    setAnswerLoading(false);
  }

  async function generateQuiz() {
    const all = getAllPages();
    if (!all.length) return;
    setQuizLoading(true);
    setErr("");
    try {
      const relevant = getRelevantPages(all, selectedTopic || "medical examination", 40000);
      const resp = await fetch("/api/quiz", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: relevant, language, exclude: seenStems }),
      });
      const json = await resp.json();
      if (json.ok && json.quiz) {
        const shuffled = shuffleQuiz(json.quiz);
        setQuiz(shuffled);
        setSeenStems(prev => [...prev, ...json.quiz.map((q: any) => q.q)]);
        setQuizIdx(0); setQuizChosen(null); setQuizScore(0); setQuizFin(false);
      } else setErr(json.error || "Failed to generate quiz");
    } catch (e) { setErr(String(e)); }
    setQuizLoading(false);
  }

  function shuffleQuiz(qs: QuizQuestion[]): QuizQuestion[] {
    const arr = [...qs].sort(() => Math.random() - 0.5);
    return arr.map(q => {
      const idx = [...Array(q.options.length).keys()].sort(() => Math.random() - 0.5);
      return { ...q, options: idx.map(i => q.options[i]), correct: idx.indexOf(q.correct) };
    });
  }

  async function sendChat(question: string, prefill?: string) {
    const q = (prefill || question).trim();
    if (!q) return;
    const all = getAllPages();
    const userMsg: ChatMessage = { id: ++msgIdRef.current, role: "user", content: q };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    setErr("");
    try {
      const relevant = getRelevantPages(all, q, 70000);
      const history = chatHistory.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const resp = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, pages: relevant, language, history }),
      });
      const json = await resp.json();
      if (json.ok) {
        const aiMsg: ChatMessage = {
          id: ++msgIdRef.current, role: "assistant",
          content: json.answer,
          citation: json.citation_page ? { page: json.citation_page, quote: json.citation_quote, sourceName: json.source_name || "" } : undefined,
          crossQuestions: json.crossQuestions,
        };
        setChatHistory(prev => [...prev, aiMsg]);
      } else {
        setChatHistory(prev => [...prev, { id: ++msgIdRef.current, role: "assistant", content: json.error || "Something went wrong." }]);
      }
    } catch (e) {
      setChatHistory(prev => [...prev, { id: ++msgIdRef.current, role: "assistant", content: String(e) }]);
    }
    setChatLoading(false);
  }

  const totalPages = sources.reduce((a, s) => a + (s.totalPages || s.pages.length || 0), 0);
  const processedPages = sources.reduce((a, s) => a + s.processedPages, 0);
  const allDone = sources.length > 0 && sources.every(s => s.status !== "processing");

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box}
        .b:focus-visible{outline:2px solid ${HEAL};outline-offset:2px}
        @keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        textarea,input{outline:none}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-thumb{background:${LINE};border-radius:3px}
      `}</style>

      <Header
        language={language} setLanguage={setLanguage}
        mode={mode} setMode={m => { setMode(m); setTab(m === "longAnswer" ? "answer" : "mcq"); }}
        sourceCount={sources.length}
      />

      {stage === "upload" ? (
        <UploadStage onFiles={handleFiles} />
      ) : (
        <WorkspaceStage
          sources={sources} allDone={allDone} processedPages={processedPages} totalPages={totalPages}
          mode={mode} tab={tab} setTab={setTab} language={language}
          topics={topics} topicsLoading={topicsLoading} onGenerateTopics={generateTopics}
          selectedTopic={selectedTopic} topicInput={topicInput} setTopicInput={setTopicInput}
          onLoadTopic={loadTopic}
          currentAnswer={currentAnswer} answerLoading={answerLoading} pageImages={pageImages}
          quiz={quiz} quizLoading={quizLoading} onGenerateQuiz={generateQuiz}
          quizIdx={quizIdx} setQuizIdx={setQuizIdx}
          quizChosen={quizChosen} setQuizChosen={setQuizChosen}
          quizScore={quizScore} setQuizScore={setQuizScore}
          quizFin={quizFin} setQuizFin={setQuizFin}
          chatHistory={chatHistory} chatInput={chatInput} setChatInput={setChatInput}
          chatLoading={chatLoading} onSendChat={sendChat}
          err={err}
          onAddFiles={handleFiles}
          sources_images={sources.filter(s => s.imageDataUrl).map(s => ({ name: s.name, url: s.imageDataUrl! }))}
          onCrossQuestion={(q: string) => { setTab("chat"); sendChat("", q); }}
        />
      )}
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({ language, setLanguage, mode, setMode, sourceCount }: any) {
  return (
    <header style={{ borderBottom: `1px solid ${LINE}`, background: PAPER, position: "sticky", top: 0, zIndex: 30 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: HEAL, display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontFamily: "'Fraunces',serif", fontSize: 18 }}>+</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 19 }}>MedPager</div>
        {sourceCount > 0 && <span style={{ fontSize: 12, color: MUTED, background: BONE, borderRadius: 6, padding: "2px 8px" }}>{sourceCount} source{sourceCount !== 1 ? "s" : ""}</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 8, border: `1px solid ${LINE}`, overflow: "hidden" }}>
            {(["longAnswer","mcq"] as const).map(m => (
              <button key={m} className="b" onClick={() => setMode(m)}
                style={{ background: mode === m ? INK : "#fff", color: mode === m ? PAPER : MUTED, border: "none", padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                {m === "longAnswer" ? "Long Answer" : "MCQ"}
              </button>
            ))}
          </div>
          <select value={language} onChange={e => setLanguage(e.target.value)}
            style={{ fontFamily: "inherit", fontSize: 13, padding: "6px 10px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK }}>
            {LANGS.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
      </div>
    </header>
  );
}

// ── Upload Stage ────────────────────────────────────────────────────────────

function UploadStage({ onFiles }: { onFiles: (f: FileList | File[]) => void }) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ maxWidth: 700, margin: "80px auto", padding: "0 24px", animation: "rise .4s ease both" }}>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: HEAL_DK, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>Upload your study material</div>
      <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 40, lineHeight: 1.1, margin: "0 0 16px", letterSpacing: "-0.02em" }}>
        Drop a chapter, book,<br/>or lecture slide.
      </h1>
      <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.6, marginBottom: 32 }}>
        Upload multiple files — PDFs, images, Word docs, or PowerPoint slides. MedPager builds structured long answers and MCQs from your sources.
      </p>
      <div
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onClick={() => ref.current?.click()}
        onDragOver={e => { e.preventDefault(); setHover(true); }}
        onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
        role="button" tabIndex={0} className="b"
        onKeyDown={e => e.key === "Enter" && ref.current?.click()}
        style={{ border: `1.5px dashed ${hover ? HEAL : LINE}`, background: hover ? "#fff" : "transparent", borderRadius: 16, padding: "40px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, cursor: "pointer", transition: "all .2s" }}>
        <span style={{ fontSize: 36 }}>📚</span>
        <div style={{ fontWeight: 600, fontSize: 15, textAlign: "center" }}>Click to choose files, or drag them here</div>
        <div style={{ fontSize: 13, color: MUTED }}>PDF · Images (JPG/PNG) · DOCX · PPTX · Multiple files supported</div>
        <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.docx,.pptx" multiple style={{ display: "none" }} onChange={e => e.target.files && onFiles(e.target.files)} />
      </div>
      <div style={{ marginTop: 40, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {[["Up to 5000 pages","Process entire textbooks, all at once."],["Multiple sources","Cross-reference across all uploaded files."],["Long Answers + MCQs","Get structured answers and self-test."]].map(([t, d]) => (
          <div key={t} style={{ flex: "1 1 180px" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{t}</div>
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Workspace Stage ─────────────────────────────────────────────────────────

function WorkspaceStage(props: any) {
  const { sources, allDone, processedPages, totalPages, mode, tab, setTab, err, onAddFiles, sources_images } = props;
  const addRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 24px 60px" }}>
      {/* Source list */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        {sources.map((s: ProcessedSource) => (
          <SourceBadge key={s.id} source={s} />
        ))}
        <button className="b" onClick={() => addRef.current?.click()}
          style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: MUTED, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          + Add files
        </button>
        <input ref={addRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.docx,.pptx" multiple style={{ display: "none" }}
          onChange={e => e.target.files && onAddFiles(e.target.files)} />
        {!allDone && totalPages > 0 && (
          <span style={{ fontSize: 12, color: MUTED, fontFamily: "'JetBrains Mono',monospace" }}>
            Processing {processedPages.toLocaleString()} / {totalPages.toLocaleString()} pages…
          </span>
        )}
      </div>

      {err && <div style={{ marginBottom: 14, fontSize: 13, color: ACCENT, background: "#f9e7e1", border: `1px solid ${ACCENT}`, borderRadius: 8, padding: "8px 14px" }}>{err}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${LINE}`, marginBottom: 24 }}>
        {mode === "longAnswer"
          ? [["answer","Long Answer"],["chat","Chat & History"]].map(([k, l]) => <Tab key={k} id={k} label={l} active={tab} setTab={setTab} />)
          : [["mcq","MCQ"],["chat","Chat & History"]].map(([k, l]) => <Tab key={k} id={k} label={l} active={tab} setTab={setTab} />)
        }
      </div>

      {tab === "answer" && mode === "longAnswer" && <LongAnswerTab {...props} />}
      {tab === "mcq" && mode === "mcq" && <MCQTab {...props} />}
      {tab === "chat" && <ChatTab {...props} />}
    </div>
  );
}

function Tab({ id, label, active, setTab }: any) {
  const on = active === id;
  return (
    <button className="b" onClick={() => setTab(id)}
      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "10px 18px", fontSize: 14, fontWeight: on ? 600 : 500, color: on ? INK : MUTED, borderBottom: on ? `2px solid ${HEAL}` : "2px solid transparent", marginBottom: -1 }}>
      {label}
    </button>
  );
}

function SourceBadge({ source }: { source: ProcessedSource }) {
  const icon = { pdf: "📄", image: "🖼", docx: "📝", pptx: "📊" }[source.type];
  const done = source.status === "done";
  const err = source.status === "error";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, background: err ? "#f9e7e1" : done ? "#eef4f0" : BONE, border: `1px solid ${err ? ACCENT : done ? "#cfe3d8" : LINE}`, borderRadius: 8, padding: "4px 10px" }}>
      <span>{icon}</span>
      <span style={{ fontWeight: 500, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name.replace(/\.[^.]+$/, "")}</span>
      {done && <span style={{ color: HEAL_DK, fontFamily: "'JetBrains Mono',monospace" }}>✓ {(source.totalPages || source.pages.length).toLocaleString()}p</span>}
      {!done && !err && <span style={{ color: MUTED }}><Spinner size={10} /></span>}
      {err && <span style={{ color: ACCENT }} title={source.error}>✗</span>}
    </div>
  );
}

// ── Long Answer Tab ─────────────────────────────────────────────────────────

function LongAnswerTab({ topics, topicsLoading, onGenerateTopics, selectedTopic, topicInput, setTopicInput, onLoadTopic, currentAnswer, answerLoading, pageImages, onCrossQuestion, sources_images }: any) {
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
      {/* Topics panel */}
      <div style={{ width: 240, flexShrink: 0 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: HEAL_DK, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Topics</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input
              value={topicInput} onChange={e => setTopicInput(e.target.value)}
              onKeyDown={(e: any) => e.key === "Enter" && topicInput.trim() && onLoadTopic(topicInput.trim())}
              placeholder="Type a topic…"
              style={{ flex: 1, fontSize: 13, padding: "7px 10px", borderRadius: 8, border: `1px solid ${LINE}`, fontFamily: "inherit", color: INK, background: "#fff" }}
            />
            <button className="b" onClick={() => topicInput.trim() && onLoadTopic(topicInput.trim())}
              style={{ background: INK, color: PAPER, border: "none", borderRadius: 8, padding: "0 10px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>→</button>
          </div>
          {topics.length === 0 ? (
            <button className="b" onClick={onGenerateTopics} disabled={topicsLoading}
              style={{ width: "100%", background: topicsLoading ? BONE : HEAL, color: topicsLoading ? MUTED : "#fff", border: "none", borderRadius: 8, padding: "9px", fontSize: 13, cursor: topicsLoading ? "default" : "pointer", fontWeight: 500 }}>
              {topicsLoading ? <span style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}><Spinner size={12} /> Scanning…</span> : "✦ Generate Topic List"}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 400, overflowY: "auto" }}>
              {topics.map((t: string) => (
                <button key={t} className="b" onClick={() => onLoadTopic(t)}
                  style={{ textAlign: "left", padding: "8px 10px", borderRadius: 8, fontSize: 13, background: selectedTopic === t ? HEAL : "transparent", color: selectedTopic === t ? "#fff" : INK, border: "none", cursor: "pointer", lineHeight: 1.3 }}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        {sources_images && sources_images.length > 0 && (
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginTop: 14 }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: HEAL_DK, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Uploaded Images</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sources_images.map((img: any) => (
                <div key={img.name}>
                  <img src={img.url} alt={img.name} style={{ width: "100%", borderRadius: 6, border: `1px solid ${LINE}` }} />
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{img.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Answer panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {answerLoading && (
          <div style={{ padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, animation: "rise .3s ease both" }}>
            <Spinner size={24} />
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: HEAL_DK, animation: "pulse 1.2s infinite" }}>Generating answer from your sources…</div>
          </div>
        )}
        {!answerLoading && !currentAnswer && (
          <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 15 }}>
            {selectedTopic ? "Select a topic or type one above to get a structured answer." : "Generate the topic list or type a topic in the left panel."}
          </div>
        )}
        {!answerLoading && currentAnswer && (
          <LongAnswerView answer={currentAnswer} pageImages={pageImages} onCrossQuestion={onCrossQuestion} />
        )}
      </div>
    </div>
  );
}

function LongAnswerView({ answer, pageImages, onCrossQuestion }: { answer: LongAnswer; pageImages: Record<string,string>; onCrossQuestion: (q: string) => void }) {
  const citBySection = (section: string) => answer.citations?.filter(c => c.section === section) || [];
  return (
    <div style={{ animation: "rise .3s ease both" }}>
      <div style={{ background: INK, color: PAPER, borderRadius: "14px 14px 0 0", padding: "20px 28px" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: "0.16em", color: "#9db8ac", textTransform: "uppercase", marginBottom: 6 }}>Long Answer</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 26 }}>{answer.topic}</div>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: "0 0 14px 14px", padding: "8px 28px 28px" }}>
        {SECTION_ORDER.map(key => {
          const text = answer.sections[key];
          if (!text) return null;
          const cits = citBySection(key);
          return (
            <div key={key} style={{ padding: "18px 0", borderBottom: `1px solid ${BONE}` }}>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, color: ACCENT, marginBottom: 8 }}>{SECTION_LABELS[key]}</div>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: "#28342f", whiteSpace: "pre-line" }}>{text}</p>
              {cits.map((c, i) => (
                <div key={i} style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 12, color: HEAL_DK, background: "#eef4f0", borderRadius: 6, padding: "5px 10px", border: `1px solid #cfe3d8`, fontFamily: "'JetBrains Mono',monospace" }}>
                    {c.sourceName && <span>{c.sourceName} · </span>}p.{c.page}
                    {c.quote && <span style={{ color: MUTED, fontStyle: "italic", fontFamily: "inherit" }}> — "{c.quote}"</span>}
                  </div>
                  {pageImages[`${c.sourceName}:${c.page}`] && (
                    <img src={pageImages[`${c.sourceName}:${c.page}`]} alt={`Page ${c.page}`}
                      style={{ height: 80, borderRadius: 4, border: `1px solid ${LINE}`, cursor: "pointer" }}
                      onClick={() => window.open(pageImages[`${c.sourceName}:${c.page}`])} />
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {/* Cross-question suggestions */}
        <div style={{ marginTop: 24, paddingTop: 16 }}>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>Ask a follow-up</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              `What are the key differences between types in ${answer.topic}?`,
              `Discuss the complications of ${answer.topic} with their mechanisms.`,
              `Compare the management options for ${answer.topic}.`,
            ].map(q => (
              <button key={q} className="b" onClick={() => onCrossQuestion(q)}
                style={{ fontSize: 13, padding: "8px 14px", borderRadius: 10, border: `1px solid ${LINE}`, background: BONE, color: INK, cursor: "pointer", textAlign: "left", lineHeight: 1.35 }}>
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MCQ Tab ─────────────────────────────────────────────────────────────────

function MCQTab({ quiz, quizLoading, onGenerateQuiz, quizIdx, setQuizIdx, quizChosen, setQuizChosen, quizScore, setQuizScore, quizFin, setQuizFin, onCrossQuestion, selectedTopic }: any) {
  if (quizLoading) return (
    <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <Spinner size={24} /><div style={{ color: MUTED, fontSize: 14 }}>Generating MCQs from your sources…</div>
    </div>
  );

  if (!quiz.length) return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, marginBottom: 12 }}>Ready to test yourself?</div>
      <div style={{ color: MUTED, fontSize: 14, marginBottom: 28 }}>MCQs generated from all your uploaded sources{selectedTopic ? ` · focused on ${selectedTopic}` : ""}.</div>
      <button className="b" onClick={onGenerateQuiz}
        style={{ background: HEAL, color: "#fff", border: "none", borderRadius: 10, padding: "12px 28px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
        ✦ Generate MCQs
      </button>
    </div>
  );

  const q = quiz[quizIdx];

  if (quizFin) return (
    <div style={{ textAlign: "center", padding: "60px 0", animation: "rise .4s ease both" }}>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 48, color: HEAL }}>{quizScore}/{quiz.length}</div>
      <div style={{ fontSize: 15, color: MUTED, marginTop: 8, marginBottom: 28 }}>
        {quizScore === quiz.length ? "Spotless — you know this cold." : "Good effort — review the misses and go again."}
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <button className="b" onClick={() => { setQuizIdx(0); setQuizChosen(null); setQuizScore(0); setQuizFin(false); }}
          style={{ background: BONE, color: INK, border: `1px solid ${LINE}`, borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Retake</button>
        <button className="b" onClick={onGenerateQuiz}
          style={{ background: INK, color: PAPER, border: "none", borderRadius: 10, padding: "11px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>✦ New Questions</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 720, animation: "rise .3s ease both" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: MUTED, fontFamily: "'JetBrains Mono',monospace", marginBottom: 12 }}>
        <span>Q {quizIdx + 1} of {quiz.length}</span><span>Score {quizScore}</span>
      </div>
      <div style={{ height: 4, background: BONE, borderRadius: 2, marginBottom: 24 }}>
        <div style={{ height: "100%", width: `${(quizIdx / quiz.length) * 100}%`, background: HEAL, borderRadius: 2, transition: "width .3s" }} />
      </div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 21, lineHeight: 1.35, marginBottom: 22 }}>{q.q}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {q.options.map((opt: string, i: number) => {
          const ok = quizChosen != null && i === q.correct;
          const no = quizChosen === i && i !== q.correct;
          return (
            <button key={i} className="b" onClick={() => { if (quizChosen != null) return; setQuizChosen(i); if (i === q.correct) setQuizScore((s: number) => s + 1); }}
              disabled={quizChosen != null}
              style={{ textAlign: "left", padding: "14px 16px", borderRadius: 10, fontSize: 14.5, cursor: quizChosen != null ? "default" : "pointer", background: ok ? "#e6f3ec" : no ? "#f9e7e1" : "#fff", border: `1.5px solid ${ok ? HEAL : no ? ACCENT : LINE}`, color: INK, fontWeight: 500 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: MUTED, marginRight: 10 }}>{String.fromCharCode(65 + i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {quizChosen != null && (
        <div style={{ marginTop: 18, background: BONE, borderRadius: 10, padding: "14px 18px", fontSize: 13.5, lineHeight: 1.6, animation: "rise .3s ease both" }}>
          <strong style={{ color: HEAL_DK }}>Why: </strong>{q.why}
          {q.citation_page && <span style={{ color: MUTED }}> · p.{q.citation_page}</span>}
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button className="b" onClick={() => { setQuizChosen(null); if (quizIdx + 1 >= quiz.length) setQuizFin(true); else setQuizIdx((i: number) => i + 1); }}
              style={{ background: INK, color: PAPER, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {quizIdx + 1 >= quiz.length ? "See score →" : "Next →"}
            </button>
            <button className="b" onClick={() => onCrossQuestion(`Explain the answer to: ${q.q}`)}
              style={{ background: "transparent", color: MUTED, border: `1px solid ${LINE}`, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer" }}>
              Ask about this
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Chat Tab ────────────────────────────────────────────────────────────────

function ChatTab({ chatHistory, chatInput, setChatInput, chatLoading, onSendChat }: any) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const hasHistory = chatHistory.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 220px)", minHeight: 400 }}>
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
        {!hasHistory && (
          <div style={{ padding: "60px 0", textAlign: "center", color: MUTED, fontSize: 15 }}>
            Ask anything about your uploaded sources — answers are cited to the source and page.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {chatHistory.map((msg: ChatMessage) => (
            <ChatBubble key={msg.id} msg={msg} onCrossQuestion={onSendChat} />
          ))}
          {chatLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
              <Spinner size={14} />
              <span style={{ fontSize: 13, color: MUTED, animation: "pulse 1.2s infinite" }}>Finding the answer in your sources…</span>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 14, display: "flex", gap: 10 }}>
        <textarea
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSendChat(chatInput); } }}
          placeholder="Ask about your uploaded material… (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 14px", fontSize: 14, fontFamily: "inherit", color: INK, background: "#fff", resize: "none" }}
        />
        <button className="b" onClick={() => onSendChat(chatInput)} disabled={chatLoading || !chatInput.trim()}
          style={{ background: chatLoading || !chatInput.trim() ? BONE : INK, color: chatLoading || !chatInput.trim() ? MUTED : PAPER, border: "none", borderRadius: 10, padding: "0 18px", fontSize: 14, fontWeight: 600, cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer", alignSelf: "stretch" }}>
          Send
        </button>
      </div>
    </div>
  );
}

function ChatBubble({ msg, onCrossQuestion }: { msg: ChatMessage; onCrossQuestion: (q: string) => void }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", animation: "rise .3s ease both" }}>
      <div style={{ maxWidth: "78%", background: isUser ? INK : "#fff", color: isUser ? PAPER : INK, borderRadius: isUser ? "14px 14px 4px 14px" : "4px 14px 14px 14px", padding: "12px 16px", border: isUser ? "none" : `1px solid ${LINE}`, fontSize: 14.5, lineHeight: 1.65 }}>
        <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
        {msg.citation && msg.citation.page && (
          <div style={{ marginTop: 10, fontSize: 12, color: isUser ? "#9db8ac" : HEAL_DK, fontFamily: "'JetBrains Mono',monospace", background: isUser ? "rgba(255,255,255,.08)" : "#eef4f0", borderRadius: 6, padding: "5px 9px", display: "inline-block" }}>
            {msg.citation.sourceName && <span>{msg.citation.sourceName} · </span>}p.{msg.citation.page}
            {msg.citation.quote && <em style={{ fontFamily: "inherit", color: MUTED }}> — "{msg.citation.quote}"</em>}
          </div>
        )}
        {!isUser && msg.crossQuestions && msg.crossQuestions.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {msg.crossQuestions.map((q: string) => (
              <button key={q} className="b" onClick={() => onCrossQuestion(q)}
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 8, border: `1px solid ${LINE}`, background: BONE, color: INK, cursor: "pointer", textAlign: "left" }}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Utility ─────────────────────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", border: `2px solid ${HEAL}`, borderTopColor: "transparent", display: "inline-block", animation: "spin .7s linear infinite", flexShrink: 0 }} />;
}
