import React, { useState, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ── MedPager Phase 1 ──────────────────────────────────────────────────────────
// Upload chapter PDF → extract page-tagged text in browser → POST to /api/generate
// (OpenAI, key server-side) → render study output where every point shows the
// book, page, and verbatim source quote. A "demo mode" fallback keeps pitches safe.

const INK="#13201c",PAPER="#f6f4ee",HEAL="#1f7a5a",HEAL_DK="#155c43",BONE="#e8e2d4",ACCENT="#c9603f",MUTED="#5d6b64",LINE="#d8d3c4";

const LANGS=["English","Hindi","Bengali","Tamil","Telugu","Marathi","Kannada"];

// Polished fallback sample (real orthopedics) used if API fails or demo mode is on.
const SAMPLE={
  heading:"Fracture of the Neck of Femur",
  book:"Sample chapter (offline)",
  pager:[
    {label:"Definition",body:"An intracapsular fracture between the femoral head and the intertrochanteric line. Common in elderly osteoporotic patients after trivial trauma.",citation_page:412,citation_quote:"intracapsular fracture of the femoral neck",citation_status:"verified"},
    {label:"Classification",body:"Garden's (displacement, I–IV) and Pauwels' (angle of fracture line to horizontal).",citation_page:413,citation_quote:"Garden classified these fractures into four types",citation_status:"verified"},
    {label:"Clinical Features",body:"Groin pain, inability to bear weight, limb held in external rotation and shortening.",citation_page:413,citation_quote:"the limb lies in external rotation",citation_status:"verified"},
    {label:"Management",body:"Undisplaced: cannulated screw fixation. Displaced in elderly: arthroplasty (hemi for low-demand, THR for active).",citation_page:415,citation_quote:"arthroplasty is preferred in the elderly",citation_status:"verified"},
    {label:"Complications",body:"Avascular necrosis of the femoral head and non-union, owing to the precarious blood supply.",citation_page:416,citation_quote:"avascular necrosis and non-union are the main complications",citation_status:"verified"},
  ],
  qa:[
    {q:"Why is avascular necrosis common in femoral neck fractures?",a:"The medial circumflex femoral artery supplies the head via retinacular branches; a displaced fracture tears these end-arterial vessels, causing AVN.",citation_page:416,citation_quote:"the blood supply is derived mainly from the medial circumflex femoral artery",citation_status:"verified"},
    {q:"Management of a displaced neck fracture in a 75-year-old?",a:"Arthroplasty rather than fixation — hemiarthroplasty for low-demand, THR for active patients.",citation_page:415,citation_quote:"arthroplasty is preferred in the elderly",citation_status:"verified"},
    {q:"What is Garden's classification based on?",a:"The degree of displacement seen on the AP radiograph, graded I (impacted) to IV (fully displaced).",citation_page:413,citation_quote:"Garden classified these fractures into four types",citation_status:"verified"},
  ],
  quiz:[
    {q:"The limb in a displaced femoral neck fracture classically lies in:",options:["Internal rotation","External rotation and shortening","Flexion and adduction","Neutral"],correct:1,why:"Loss of neck integrity with pull of external rotators.",citation_page:413},
    {q:"Garden type IV is:",options:["Impacted","Undisplaced","Partially displaced","Fully displaced"],correct:3,why:"Garden grades I–IV by increasing displacement.",citation_page:413},
    {q:"Chief blood supply to the femoral head:",options:["Obturator artery","Medial circumflex femoral artery","Superior gluteal artery","Profunda femoris"],correct:1,why:"Retinacular branches of the MCFA.",citation_page:416},
    {q:"Garden II in a fit 60-year-old — treatment:",options:["THR","Hemiarthroplasty","Cannulated screw fixation","Traction"],correct:2,why:"Undisplaced fractures retain supply; head-preserving fixation.",citation_page:415},
  ],
  revision:[
    {front:"Blood supply at risk in NOF fracture?",back:"Medial circumflex femoral artery → AVN risk."},
    {front:"Garden classification is based on?",back:"Degree of displacement (I–IV)."},
    {front:"Pauwels classification is based on?",back:"Angle of fracture line to horizontal."},
    {front:"Classic limb position?",back:"External rotation + shortening."},
    {front:"Displaced NOF in elderly — treatment?",back:"Arthroplasty."},
    {front:"Two late complications?",back:"AVN and non-union."},
  ],
};

function useTypewriter(text,active,speed=8){
  const[out,setOut]=useState(""),[done,setDone]=useState(false);
  useEffect(()=>{if(!active)return;setOut("");setDone(false);let i=0;const id=setInterval(()=>{i++;setOut(text.slice(0,i));if(i>=text.length){clearInterval(id);setDone(true);}},speed);return()=>clearInterval(id);},[text,active,speed]);
  return{out,done};
}

async function extractPdf(file){
  const buf=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];const max=Math.min(pdf.numPages,60);
  for(let p=1;p<=max;p++){const page=await pdf.getPage(p);const c=await page.getTextContent();pages.push({page:p,text:c.items.map(it=>it.str).join(" ")});}
  return{pages,total:pdf.numPages};
}

export default function App(){
  const[stage,setStage]=useState("upload");
  const[tab,setTab]=useState("pager");
  const[demoMode,setDemoMode]=useState(false);
  const[language,setLanguage]=useState("English");
  const[result,setResult]=useState(SAMPLE);
  const[pages,setPages]=useState([]);
  const[title,setTitle]=useState("Your uploaded chapter");
  const[note,setNote]=useState("");
  const[err,setErr]=useState("");
  const fileRef=useRef(null);

  async function handleFile(file){
    if(!file)return;
    setErr("");setTitle(file.name.replace(/\.pdf$/i,""));setStage("processing");
    if(demoMode){setTimeout(()=>{setResult(SAMPLE);setPages([]);setNote("sample");setStage("workspace");setTab("pager");},2400);return;}
    try{
      const{pages:extracted,total}=await extractPdf(file);
      setPages(extracted);
      const resp=await fetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pages:extracted,title:file.name,language})});
      const json=await resp.json();
      if(json.ok&&json.data&&Array.isArray(json.data.pager)){
        setResult({...json.data,book:json.book||file.name});setNote(json.truncated?"truncated":"live");
      }else{setResult(SAMPLE);setNote("sample");setErr(json.error||"");}
    }catch(e){setResult(SAMPLE);setNote("sample");setErr(String(e));}
    setStage("workspace");setTab("pager");
  }

  return(
    <div style={{minHeight:"100vh",background:PAPER,color:INK,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box}
        @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
        .b:focus-visible{outline:2px solid ${HEAL};outline-offset:2px}
        @keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}
        @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        @keyframes scan{0%{transform:translateY(0)}100%{transform:translateY(220px)}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
      <Header demoMode={demoMode} setDemoMode={setDemoMode} language={language} setLanguage={setLanguage} stage={stage}/>
      <div style={{maxWidth:1080,margin:"0 auto",padding:"0 24px 80px"}}>
        {stage==="upload"&&<Upload fileRef={fileRef} onFile={handleFile} demoMode={demoMode} language={language}/>}
        {stage==="processing"&&<Processing/>}
        {stage==="workspace"&&<Workspace result={result} pages={pages} tab={tab} setTab={setTab} title={title} note={note} err={err} onReset={()=>setStage("upload")} language={language}/>}
      </div>
    </div>
  );
}

function Header({demoMode,setDemoMode,language,setLanguage,stage}){
  return(
    <header style={{borderBottom:`1px solid ${LINE}`,background:PAPER,position:"sticky",top:0,zIndex:20}}>
      <div style={{maxWidth:1080,margin:"0 auto",padding:"14px 24px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{width:30,height:30,borderRadius:8,background:HEAL,display:"grid",placeItems:"center",color:"#fff",fontWeight:700,fontFamily:"'Fraunces',serif"}}>+</div>
        <div style={{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:20,letterSpacing:"-0.01em"}}>MedPager</div>
        <div style={{marginLeft:8,fontSize:12,color:MUTED,borderLeft:`1px solid ${LINE}`,paddingLeft:12}}>Your books, examination-ready.</div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <label style={{fontSize:12,color:MUTED,display:"flex",alignItems:"center",gap:7}}>
            Language
            <select value={language} onChange={e=>setLanguage(e.target.value)} style={{fontFamily:"inherit",fontSize:13,padding:"5px 8px",borderRadius:8,border:`1px solid ${LINE}`,background:"#fff",color:INK}}>
              {LANGS.map(l=><option key={l}>{l}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,color:MUTED,display:"flex",alignItems:"center",gap:7,cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={demoMode} onChange={e=>setDemoMode(e.target.checked)} style={{accentColor:HEAL}}/>
            Demo mode
          </label>
        </div>
      </div>
    </header>
  );
}

function Upload({fileRef,onFile,demoMode,language}){
  const[hover,setHover]=useState(false),[name,setName]=useState("");
  return(
    <section style={{paddingTop:60,animation:"rise .5s ease both"}}>
      <div style={{maxWidth:670}}>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:HEAL_DK,letterSpacing:"0.14em",textTransform:"uppercase"}}>Step 1 — Upload a chapter</div>
        <h1 style={{fontFamily:"'Fraunces',serif",fontSize:44,lineHeight:1.06,margin:"14px 0 16px",letterSpacing:"-0.02em"}}>
          Drop a chapter.<br/>Walk out with notes you can <span style={{color:HEAL}}>write in the exam.</span>
        </h1>
        <p style={{fontSize:16,color:MUTED,lineHeight:1.6,maxWidth:560}}>
          Upload a textbook chapter PDF. MedPager reads it and builds an exam-format pager, a tutor, a quiz and revision cards — in <strong style={{color:INK}}>{language}</strong>. Every point shows the book, page and the exact line it came from, so you can check it against your book.
          {demoMode&&<strong style={{color:ACCENT}}> Demo mode is on: output is the built-in sample.</strong>}
        </p>
      </div>
      <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
        onClick={()=>fileRef.current&&fileRef.current.click()}
        onDragOver={e=>{e.preventDefault();setHover(true);}}
        onDrop={e=>{e.preventDefault();const f=e.dataTransfer.files?.[0];if(f){setName(f.name);onFile(f);}}}
        role="button" tabIndex={0} className="b" onKeyDown={e=>e.key==="Enter"&&fileRef.current.click()}
        style={{marginTop:34,cursor:"pointer",border:`1.5px dashed ${hover?HEAL:LINE}`,background:hover?"#fff":"transparent",borderRadius:16,padding:"34px 28px",display:"flex",alignItems:"center",gap:20,maxWidth:670,transition:"all .2s"}}>
        <div style={{width:52,height:52,borderRadius:12,background:BONE,display:"grid",placeItems:"center",flexShrink:0}}><span style={{fontSize:22}}>📄</span></div>
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:15}}>{name||"Click to choose a PDF, or drag it here"}</div>
          <div style={{fontSize:13,color:MUTED,marginTop:3}}>Best with a single chapter (10–50 pages) · read in your browser</div>
        </div>
        <input ref={fileRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f){setName(f.name);onFile(f);}}}/>
      </div>
      <div style={{marginTop:52,display:"flex",gap:28,flexWrap:"wrap",maxWidth:670}}>
        {[["Cited to the source","Every point quotes the book + page so you can verify it."],["Ask your doubts","Type a question, get an exam-style answer from the chapter."],["Quiz + revision","Self-test and lock it into memory."]].map(([t,d])=>(
          <div key={t} style={{flex:"1 1 180px",minWidth:180}}>
            <div style={{fontWeight:600,fontSize:14,marginBottom:4}}>{t}</div>
            <div style={{fontSize:13,color:MUTED,lineHeight:1.5}}>{d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Processing(){
  const steps=["Reading the chapter…","Extracting key concepts…","Structuring exam-format answers…","Attaching source citations…","Writing quiz & revision…"];
  const[i,setI]=useState(0);
  useEffect(()=>{const id=setInterval(()=>setI(x=>(x+1)%steps.length),900);return()=>clearInterval(id);},[]);
  return(
    <section style={{paddingTop:104,display:"grid",placeItems:"center",animation:"rise .4s ease both"}}>
      <div style={{width:200,height:240,borderRadius:12,background:"#fff",border:`1px solid ${LINE}`,position:"relative",overflow:"hidden",boxShadow:"0 18px 40px rgba(19,32,28,.08)"}}>
        {[...Array(9)].map((_,r)=><div key={r} style={{height:6,background:BONE,borderRadius:3,margin:"16px 18px"}}/>)}
        <div style={{position:"absolute",left:0,right:0,top:0,height:2,background:HEAL,boxShadow:`0 0 12px ${HEAL}`,animation:"scan 1.6s ease-in-out infinite alternate"}}/>
      </div>
      <div style={{marginTop:30,fontFamily:"'JetBrains Mono',monospace",fontSize:14,color:HEAL_DK,animation:"pulse 1.2s infinite"}}>{steps[i]}</div>
    </section>
  );
}

function Cite({page,quote,status,book}){
  if(!page&&!quote)return null;
  const bad=status==="unverified";
  return(
    <div style={{marginTop:10,marginLeft:28,padding:"8px 12px",borderRadius:8,background:bad?"#f9e7e1":"#eef4f0",border:`1px solid ${bad?ACCENT:"#cfe3d8"}`,fontSize:12.5,lineHeight:1.5}}>
      <span style={{fontFamily:"'JetBrains Mono',monospace",color:bad?ACCENT:HEAL_DK,fontWeight:500}}>
        {bad?"⚠ unverified":"✓ source"}{page?` · ${book||"book"}, p.${page}`:""}
      </span>
      {quote&&<span style={{color:"#3a4742",fontStyle:"italic"}}> — “{quote}”</span>}
      {bad&&<div style={{color:ACCENT,marginTop:4,fontSize:11.5}}>This quote could not be matched in the uploaded text — verify before trusting.</div>}
    </div>
  );
}

function Workspace({result,pages,tab,setTab,title,note,err,onReset,language}){
  const tabs=[["pager","Pager"],["ask","Ask the book"],["quiz","Quiz"],["revise","Revision"]];
  const book=result.book||title;
  return(
    <section style={{paddingTop:26,animation:"rise .4s ease both"}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{fontFamily:"'Fraunces',serif",fontWeight:600,fontSize:17}}>{title}</div>
        {note==="live"&&<Badge color={HEAL_DK} bg="#e6f3ec">live · cited</Badge>}
        {note==="truncated"&&<Badge color={HEAL_DK} bg="#e6f3ec">live · long PDF trimmed to fit</Badge>}
        {note==="sample"&&<Badge color={ACCENT} bg="#f9e7e1">sample output</Badge>}
        <button onClick={onReset} className="b" style={{marginLeft:"auto",fontSize:12,color:MUTED,background:"transparent",border:`1px solid ${LINE}`,borderRadius:8,padding:"6px 12px",cursor:"pointer"}}>↺ New upload</button>
      </div>
      {note==="sample"&&err&&<div style={{marginBottom:16,fontSize:12.5,color:ACCENT,background:"#f9e7e1",border:`1px solid ${ACCENT}`,borderRadius:8,padding:"8px 12px"}}>Showing sample — live generation didn’t run: {err}</div>}
      <div style={{fontSize:12.5,color:MUTED,marginBottom:20,background:BONE,borderRadius:8,padding:"9px 13px"}}>AI-generated study aid. Verify against your textbook before relying on it — not a substitute for clinical or examination authority.</div>
      <div style={{display:"flex",gap:4,borderBottom:`1px solid ${LINE}`,marginBottom:24,flexWrap:"wrap"}}>
        {tabs.map(([k,l])=><button key={k} className="b" onClick={()=>setTab(k)} style={{background:"transparent",border:"none",cursor:"pointer",padding:"10px 16px",fontSize:14,fontWeight:tab===k?600:500,color:tab===k?INK:MUTED,borderBottom:tab===k?`2px solid ${HEAL}`:"2px solid transparent",marginBottom:-1}}>{l}</button>)}
      </div>
      {tab==="pager"&&<Pager result={result} book={book}/>}
      {tab==="ask"&&<Ask result={result} book={book} pages={pages} language={language}/>}
      {tab==="quiz"&&<Quiz result={result} book={book} pages={pages} language={language}/>}
      {tab==="revise"&&<Revise result={result}/>}
    </section>
  );
}

function Badge({children,color,bg}){return <span style={{fontSize:11,color,background:bg,padding:"3px 9px",borderRadius:999,fontFamily:"'JetBrains Mono',monospace"}}>{children}</span>;}

function Pager({result,book}){
  return(
    <div style={{animation:"rise .4s ease both"}}>
      <div style={{background:"#fff",border:`1px solid ${LINE}`,borderRadius:14,overflow:"hidden",boxShadow:"0 12px 30px rgba(19,32,28,.05)"}}>
        <div style={{background:INK,color:PAPER,padding:"20px 28px"}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,letterSpacing:"0.16em",color:"#9db8ac",textTransform:"uppercase"}}>Examination Pager</div>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:26,marginTop:6}}>{result.heading}</div>
        </div>
        <div style={{padding:"10px 28px 28px"}}>
          {result.pager.map((b,idx)=>(
            <div key={idx} style={{padding:"18px 0",borderBottom:idx<result.pager.length-1?`1px solid ${LINE}`:"none"}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:8}}>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:HEAL_DK}}>{String(idx+1).padStart(2,"0")}</span>
                <h3 style={{margin:0,fontFamily:"'Fraunces',serif",fontSize:18,color:ACCENT}}>{b.label}</h3>
              </div>
              <p style={{margin:0,fontSize:14.5,lineHeight:1.62,color:"#28342f",whiteSpace:"pre-line",paddingLeft:28}}>{b.body}</p>
              <Cite page={b.citation_page} quote={b.citation_quote} status={b.citation_status} book={book}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Ask({result,book,pages,language}){
  const[active,setActive]=useState(null);
  const[custom,setCustom]=useState("");
  const[customAnswer,setCustomAnswer]=useState(null);
  const[loading,setLoading]=useState(false);
  const[askErr,setAskErr]=useState("");

  // preset Q&A selection
  const presetCur=active!=null&&customAnswer==null?result.qa[active]:null;
  const{out,done}=useTypewriter(presetCur?presetCur.a:"",presetCur!=null);

  // typewriter for custom answer
  const{out:customOut,done:customDone}=useTypewriter(customAnswer?customAnswer.answer:"",customAnswer!=null&&!loading);

  async function handleAsk(){
    const q=custom.trim();
    if(!q)return;
    setActive(null);
    setCustomAnswer(null);
    setAskErr("");
    setLoading(true);
    try{
      const resp=await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,pages,book,language})});
      const json=await resp.json();
      if(json.ok){
        setCustomAnswer({question:q,...json});
      }else{
        setAskErr(json.error||"Something went wrong. Try again.");
      }
    }catch(e){
      setAskErr(String(e));
    }
    setLoading(false);
  }

  function handleKeyDown(e){if(e.key==="Enter")handleAsk();}

  function selectPreset(i){
    setActive(i);
    setCustomAnswer(null);
    setAskErr("");
    setCustom("");
  }

  const showCustom=customAnswer!=null||loading||askErr;

  return(
    <div style={{animation:"rise .4s ease both"}}>
      <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        {result.qa.map((qa,i)=><button key={i} className="b" onClick={()=>selectPreset(i)} style={{textAlign:"left",flex:"1 1 240px",background:active===i&&!showCustom?HEAL:"#fff",color:active===i&&!showCustom?"#fff":INK,border:`1px solid ${active===i&&!showCustom?HEAL:LINE}`,borderRadius:10,padding:"12px 14px",fontSize:13.5,cursor:"pointer",lineHeight:1.4}}>{qa.q}</button>)}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:22}}>
        <input
          value={custom}
          onChange={e=>setCustom(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your own question about the chapter…"
          style={{flex:1,border:`1px solid ${LINE}`,borderRadius:10,padding:"12px 14px",fontSize:14,fontFamily:"inherit",background:"#fff",color:INK}}
        />
        <button className="b" onClick={handleAsk} disabled={loading||!custom.trim()} style={{background:loading||!custom.trim()?MUTED:INK,color:PAPER,border:"none",borderRadius:10,padding:"0 18px",fontSize:14,fontWeight:600,cursor:loading||!custom.trim()?"not-allowed":"pointer",transition:"background .2s",minWidth:64}}>
          {loading?"…":"Ask"}
        </button>
      </div>

      {loading&&(
        <div style={{display:"flex",alignItems:"center",gap:10,color:MUTED,fontSize:14,padding:"20px 0"}}>
          <span style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${HEAL}`,borderTopColor:"transparent",display:"inline-block",animation:"spin .7s linear infinite"}}/>
          Searching the chapter…
        </div>
      )}

      {askErr&&<div style={{color:ACCENT,fontSize:13.5,background:"#f9e7e1",border:`1px solid ${ACCENT}`,borderRadius:10,padding:"12px 16px",marginBottom:14}}>{askErr}</div>}

      {showCustom&&customAnswer&&!loading&&(
        <div style={{background:"#fff",border:`1px solid ${LINE}`,borderRadius:14,padding:"22px 26px",animation:"rise .3s ease both"}}>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:17,marginBottom:12,color:ACCENT}}>{customAnswer.question}</div>
          <p style={{margin:0,fontSize:14.5,lineHeight:1.65,color:"#28342f"}}>{customOut}{!customDone&&<span style={{borderLeft:`2px solid ${HEAL}`,marginLeft:2,animation:"pulse .8s infinite"}}/>}</p>
          {customDone&&<Cite page={customAnswer.citation_page} quote={customAnswer.citation_quote} status={customAnswer.citation_status} book={book}/>}
        </div>
      )}

      {!showCustom&&presetCur&&(
        <div style={{background:"#fff",border:`1px solid ${LINE}`,borderRadius:14,padding:"22px 26px",animation:"rise .3s ease both"}}>
          <div style={{fontFamily:"'Fraunces',serif",fontSize:17,marginBottom:12,color:ACCENT}}>{presetCur.q}</div>
          <p style={{margin:0,fontSize:14.5,lineHeight:1.65,color:"#28342f"}}>{out}{!done&&<span style={{borderLeft:`2px solid ${HEAL}`,marginLeft:2,animation:"pulse .8s infinite"}}/>}</p>
          {done&&<Cite page={presetCur.citation_page} quote={presetCur.citation_quote} status={presetCur.citation_status} book={book}/>}
        </div>
      )}

      {!showCustom&&!presetCur&&(
        <div style={{textAlign:"center",color:MUTED,fontSize:14,padding:"40px 0"}}>Pick a preset question above or type your own to get a cited answer from the chapter.</div>
      )}
    </div>
  );
}

function shuffleArray(arr){
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function prepareQuiz(questions){
  return shuffleArray(questions).map(q=>{
    const n=q.options.length;
    const indices=shuffleArray([...Array(n).keys()]);
    return{...q,options:indices.map(i=>q.options[i]),correct:indices.indexOf(q.correct)};
  });
}

function Quiz({result,book,pages,language}){
  const[quiz,setQuiz]=useState(()=>prepareQuiz(result.quiz));
  const[seenStems,setSeenStems]=useState(()=>result.quiz.map(q=>q.q));
  const[idx,setIdx]=useState(0);
  const[chosen,setChosen]=useState(null);
  const[score,setScore]=useState(0);
  const[fin,setFin]=useState(false);
  const[generating,setGenerating]=useState(false);
  const[genErr,setGenErr]=useState("");

  const q=quiz[idx];

  function pick(i){if(chosen!=null)return;setChosen(i);if(i===q.correct)setScore(s=>s+1);}
  function next(){if(idx+1>=quiz.length){setFin(true);return;}setIdx(idx+1);setChosen(null);}

  function retake(){
    setQuiz(prepareQuiz(quiz));
    setIdx(0);setChosen(null);setScore(0);setFin(false);
  }

  async function generateNew(){
    setGenerating(true);setGenErr("");
    try{
      const resp=await fetch("/api/quiz",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pages,book,language,exclude:seenStems})});
      const json=await resp.json();
      if(json.ok&&Array.isArray(json.quiz)&&json.quiz.length>0){
        const prepared=prepareQuiz(json.quiz);
        setQuiz(prepared);
        setSeenStems(s=>[...s,...json.quiz.map(q=>q.q)]);
        setIdx(0);setChosen(null);setScore(0);setFin(false);
      }else{
        setGenErr(json.error||"Could not generate questions. Try again.");
      }
    }catch(e){setGenErr(String(e));}
    setGenerating(false);
  }

  if(fin)return(
    <div style={{textAlign:"center",padding:"50px 0",animation:"rise .4s ease both"}}>
      <div style={{fontFamily:"'Fraunces',serif",fontSize:40,color:HEAL}}>{score}/{quiz.length}</div>
      <div style={{fontSize:15,color:MUTED,marginTop:8,marginBottom:24}}>{score===quiz.length?"Spotless. You'd write this chapter cold.":"Solid — review the misses and run it again."}</div>
      {genErr&&<div style={{color:ACCENT,fontSize:13,marginBottom:12}}>{genErr}</div>}
      <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
        <button className="b" onClick={retake} style={{background:HEAL,color:"#fff",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,fontWeight:600,cursor:"pointer"}}>Retake (reshuffled)</button>
        {pages&&pages.length>0&&(
          <button className="b" onClick={generateNew} disabled={generating} style={{background:generating?MUTED:INK,color:"#fff",border:"none",borderRadius:10,padding:"11px 22px",fontSize:14,fontWeight:600,cursor:generating?"not-allowed":"pointer"}}>
            {generating?"Generating…":"✦ New questions"}
          </button>
        )}
      </div>
    </div>
  );

  return(
    <div style={{animation:"rise .4s ease both"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,fontSize:12,color:MUTED,fontFamily:"'JetBrains Mono',monospace",flexWrap:"wrap",gap:8}}>
        <span>Question {idx+1} of {quiz.length}</span>
        <span>Score {score}</span>
      </div>
      <div style={{height:4,background:BONE,borderRadius:2,marginBottom:26}}>
        <div style={{height:"100%",width:`${(idx/quiz.length)*100}%`,background:HEAL,borderRadius:2,transition:"width .3s"}}/>
      </div>
      <div style={{fontFamily:"'Fraunces',serif",fontSize:21,lineHeight:1.35,marginBottom:22}}>{q.q}</div>
      <div style={{display:"grid",gap:10}}>
        {q.options.map((opt,i)=>{
          const ok=chosen!=null&&i===q.correct,no=chosen===i&&i!==q.correct;
          return(
            <button key={i} className="b" onClick={()=>pick(i)} disabled={chosen!=null}
              style={{textAlign:"left",padding:"14px 16px",borderRadius:10,fontSize:14.5,cursor:chosen!=null?"default":"pointer",background:ok?"#e6f3ec":no?"#f9e7e1":"#fff",border:`1.5px solid ${ok?HEAL:no?ACCENT:LINE}`,color:INK,fontWeight:500}}>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:MUTED,marginRight:8}}>{String.fromCharCode(65+i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {chosen!=null&&(
        <div style={{marginTop:18,background:BONE,borderRadius:10,padding:"14px 16px",fontSize:13.5,lineHeight:1.55,color:"#28342f",animation:"rise .3s ease both"}}>
          <strong style={{color:HEAL_DK}}>Why: </strong>{q.why}{q.citation_page?<span style={{color:MUTED}}> · {book}, p.{q.citation_page}</span>:""}
          <button className="b" onClick={next} style={{display:"block",marginTop:14,marginLeft:"auto",background:INK,color:PAPER,border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            {idx+1>=quiz.length?"See score →":"Next →"}
          </button>
        </div>
      )}
    </div>
  );
}

function Revise({result}){
  const[flip,setFlip]=useState({});
  return(
    <div style={{animation:"rise .4s ease both"}}>
      <div style={{fontSize:13.5,color:MUTED,marginBottom:18}}>Tap a card to reveal the answer. Quick last-minute recall.</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14}}>
        {result.revision.map((c,i)=>{const o=flip[i];return(
          <button key={i} className="b" onClick={()=>setFlip(f=>({...f,[i]:!f[i]}))} style={{textAlign:"left",minHeight:120,borderRadius:14,cursor:"pointer",padding:"16px 18px",background:o?HEAL:"#fff",color:o?"#fff":INK,border:`1px solid ${o?HEAL:LINE}`,transition:"all .25s",display:"flex",flexDirection:"column",justifyContent:"center"}}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,letterSpacing:"0.12em",opacity:.6,marginBottom:8,textTransform:"uppercase"}}>{o?"Answer":"Recall"}</div>
            <div style={{fontSize:14.5,lineHeight:1.45,fontWeight:o?500:600,fontFamily:o?"inherit":"'Fraunces',serif"}}>{o?c.back:c.front}</div>
          </button>
        );})}
      </div>
    </div>
  );
}
