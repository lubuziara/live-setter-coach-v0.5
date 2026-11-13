const $ = (s) => document.querySelector(s);
let running = false, startedAt = 0, timerId, analysisTimer;
let segments = [], interim = "", latestCoach = null;
let lastAnalyzedTranscript = "", analysisInFlight = false, analysisPending = false;
let inputStream, mediaStream, mediaRecorder, chunkTimeout, stopRecorderResolver;
let transcriptionQueue = Promise.resolve(), audioContext, meterFrame, microphoneGain;
let discarding = false, sessionAbortController, coachAbortController;
let chunkStartedAt = 0, chunkVoiceStartedAt = 0, lastVoiceAt = 0;
let chunkHadVoice = false, chunkStopping = false, chunkPeakLevel = 0;
let ambientLevel = 0.35, voiceThreshold = 0.7;
let finishedHeardText = "", conversationId = "";

const ARCHIVE_KEY = "live-setter-coach-conversations-v2";
const LEGACY_ARCHIVE_KEY = "live-setter-coach-conversations-v1";
const ARCHIVE_TTL = 30 * 24 * 60 * 60 * 1000;

function setStatus(text) { $("#status").textContent = text; }
function plainTranscript() { return segments.map((x, i) => `${i + 1}. ${x}`).join("\n") + (interim ? `\n[fragment] ${interim}` : ""); }
function resetTranscriptView() {
  $(".transcript-panel").classList.remove("expanded");
  document.body.classList.remove("transcript-open");
  $("#toggleTranscript").textContent = "Powiększ";
}
function renderTranscript() {
  $("#liveTranscript").innerHTML = segments.length || interim
    ? segments.map(x => `<div class="segment">${escapeHtml(x)}</div>`).join("") + (interim ? `<div class="segment muted">${escapeHtml(interim)}…</div>` : "")
    : '<span class="muted">Jeszcze nic nie zarejestrowano.</span>';
  const count = segments.length;
  $("#transcriptCount").textContent = `${count} ${count === 1 ? "zapisany fragment" : (count >= 2 && count <= 4 ? "zapisane fragmenty" : "zapisanych fragmentów")}`;
  $("#liveTranscript").scrollTop = $("#liveTranscript").scrollHeight;
  saveCurrentConversation(running ? "trwa" : "zapis roboczy");
}
function escapeHtml(s="") { return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function readArchive() {
  try {
    const now = Date.now();
    const stored = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
    const legacy = JSON.parse(sessionStorage.getItem(LEGACY_ARCHIVE_KEY) || "[]");
    const combined = [...(Array.isArray(stored) ? stored : []), ...(Array.isArray(legacy) ? legacy : [])];
    const unique = new Map();
    for (const item of combined) {
      if (!item?.id) continue;
      const previous = unique.get(item.id);
      if (!previous || Number(item.updatedAt || 0) >= Number(previous.updatedAt || 0)) unique.set(item.id, item);
    }
    const valid = [...unique.values()]
      .filter(x => x?.createdAt && now - x.createdAt < ARCHIVE_TTL)
      .sort((a,b) => Number(b.createdAt) - Number(a.createdAt));
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(valid));
    if (legacy.length) sessionStorage.removeItem(LEGACY_ARCHIVE_KEY);
    return valid;
  } catch { return []; }
}
function writeArchive(items) {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items)); } catch { setStatus("Nie udało się zapisać rozmowy w archiwum 30-dniowym"); }
  renderArchive();
}
function saveCurrentConversation(status="zapis roboczy", summary="") {
  if (!conversationId) return;
  const items = readArchive();
  const existing = items.find(x => x.id === conversationId);
  const record = existing || { id:conversationId, createdAt:startedAt || Date.now() };
  record.updatedAt = Date.now();
  record.status = existing && !running && status === "zapis roboczy" ? existing.status : status;
  record.segments = [...segments];
  record.summary = summary || record.summary || "";
  const next = [record, ...items.filter(x => x.id !== conversationId)];
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next)); } catch { setStatus("Brak miejsca na automatyczny zapis"); }
  renderArchive();
}
function removeConversation(id) {
  writeArchive(readArchive().filter(x => x.id !== id));
  if (conversationId === id && !running) {
    conversationId=""; segments=[]; finishedHeardText=""; renderTranscript();
  }
}
function formatDate(timestamp) {
  return new Intl.DateTimeFormat("pl-PL", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(timestamp));
}
function archiveText(record) { return (record.segments || []).map((x,i)=>`${i+1}. ${x}`).join("\n"); }
function downloadWord(record) {
  const text=archiveText(record).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
  const html=`<html><head><meta charset="utf-8"></head><body><h1>Rozmowa ${formatDate(record.createdAt)}</h1><p>${text}</p></body></html>`;
  const url=URL.createObjectURL(new Blob([html],{type:"application/msword"}));
  const a=document.createElement("a"); a.href=url; a.download=`rozmowa-${new Date(record.createdAt).toISOString().slice(0,16).replace(/[:T]/g,"-")}.doc`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderArchive() {
  const target=$("#conversationArchive"); if(!target) return;
  const items=readArchive();
  target.innerHTML=items.length ? items.map(record=>{
    const preview=(record.segments||[]).join(" ").slice(0,220) || "Brak rozpoznanego tekstu.";
    return `<article class="archive-item ${record.id===conversationId ? "active" : ""}">
      <div class="archive-meta"><strong>${escapeHtml(formatDate(record.createdAt))}</strong><span class="archive-status">${escapeHtml(record.status||"zapis roboczy")} · ${(record.segments||[]).length} fragmentów</span></div>
      <div class="archive-preview">${escapeHtml(preview)}${preview.length>=220 ? "…" : ""}</div>
      <div class="archive-actions"><button data-open="${record.id}">Otwórz</button><button data-copy-archive="${record.id}">Kopiuj</button><button data-word="${record.id}">Word</button><button class="danger" data-delete="${record.id}">Usuń</button></div>
    </article>`;
  }).join("") : '<span class="muted">Pierwszy zapis powstanie automatycznie po rozpoczęciu rozmowy.</span>';
  target.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{
    if(running){setStatus("Najpierw zakończ bieżącą rozmowę");return}
    const record=readArchive().find(x=>x.id===b.dataset.open); if(!record)return;
    conversationId=record.id; startedAt=record.createdAt; segments=[...(record.segments||[])]; finishedHeardText=archiveText(record); renderTranscript(); setStatus(`Otworzono zapis z ${formatDate(record.createdAt)}`);
  });
  target.querySelectorAll("[data-copy-archive]").forEach(b=>b.onclick=async()=>{const r=readArchive().find(x=>x.id===b.dataset.copyArchive);if(r){await navigator.clipboard.writeText(archiveText(r));setStatus("Rozmowa skopiowana")}});
  target.querySelectorAll("[data-word]").forEach(b=>b.onclick=()=>{const r=readArchive().find(x=>x.id===b.dataset.word);if(r)downloadWord(r)});
  target.querySelectorAll("[data-delete]").forEach(b=>b.onclick=()=>{if(confirm("Usunąć ten zapis rozmowy?"))removeConversation(b.dataset.delete)});
}
function restoreLatestConversation() {
  const latest=readArchive()[0];
  if(!latest){renderTranscript();renderArchive();return}
  conversationId=latest.id; startedAt=latest.createdAt; segments=[...(latest.segments||[])]; finishedHeardText=archiveText(latest); renderTranscript();
  setStatus(`Przywrócono zapis z ${formatDate(latest.createdAt)}`);
}

async function analyze(force = false) {
  const transcript = plainTranscript().trim();
  if (!running || transcript.length < 8) return;
  if (analysisInFlight) {
    analysisPending = true;
    return;
  }
  if (!force && transcript === lastAnalyzedTranscript) return;
  analysisInFlight = true;
  lastAnalyzedTranscript = transcript;
  setStatus("Analizuję…");
  try {
    const r = await fetch("/api/coach", {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({transcript}),
      signal:coachAbortController?.signal
    });
    const data = await r.json(); if (!r.ok) throw new Error(data.error);
    latestCoach = data; renderCoach(data); setStatus("Słucham");
  } catch(e) {
    if (e.name === "AbortError") return;
    lastAnalyzedTranscript = "";
    setStatus(e.message);
  } finally {
    analysisInFlight = false;
    if (analysisPending && running) {
      analysisPending = false;
      setTimeout(() => analyze(true), 0);
    }
  }
}
function renderCoach(data) {
  $("#stage").textContent = data.stage || "Diagnoza robocza";
  $("#aiDiagnosis").textContent = data.diagnosis || "Jeszcze nieustalona.";
  $("#problem").textContent = data.problem || "Nieustalony";
  $("#businessModel").textContent = data.businessModel || "Jeszcze nieustalone.";
  $("#evidence").innerHTML = (data.evidence || []).map(x => `<li>${escapeHtml(x)}</li>`).join("") || "<li>brak danych</li>";
  $("#confidence").textContent = `Pewność: ${data.confidence || "niska"}`;
  $("#missing").innerHTML = (data.missing || []).map(x => `<li>${escapeHtml(x)}</li>`).join("");
  $("#warning").textContent = data.warning || "";
}

function startMeter(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  const source = audioContext.createMediaStreamSource(stream);
  const highPass = audioContext.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 75;
  highPass.Q.value = 0.7;
  microphoneGain = audioContext.createGain();
  microphoneGain.gain.value = 1.35;
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 16;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.25;
  const destination = audioContext.createMediaStreamDestination();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.28;
  source.connect(highPass);
  highPass.connect(microphoneGain);
  microphoneGain.connect(compressor);
  compressor.connect(analyser);
  compressor.connect(destination);
  mediaStream = destination.stream;
  if (audioContext.state === "suspended") audioContext.resume();
  const data = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) { const n = (value - 128) / 128; sum += n * n; }
    const level = Math.min(100, Math.sqrt(sum / data.length) * 380);
    const isVoice = level >= voiceThreshold;
    $("#micLevel").style.width = `${level}%`;
    $("#micStatus").textContent = isVoice ? "odbiera głos" : "nasłuchuje";
    if (running && mediaRecorder?.state === "recording") {
      const now = Date.now();
      chunkPeakLevel = Math.max(chunkPeakLevel, level);
      if (!isVoice && !chunkHadVoice) {
        ambientLevel = ambientLevel * 0.96 + level * 0.04;
        voiceThreshold = Math.max(0.5, Math.min(3.2, ambientLevel * 1.4 + 0.1));
      }
      if (isVoice) {
        lastVoiceAt = now;
        if (!chunkHadVoice) {
          chunkHadVoice = true;
          chunkVoiceStartedAt = now;
          clearTimeout(chunkTimeout);
          chunkTimeout = setTimeout(stopCurrentAudioChunk, $("#ecoMode").checked ? 36000 : 30000);
        }
      }
      const silenceMs = $("#ecoMode").checked ? 1800 : 1350;
      const hasCompleteUtterance = chunkHadVoice
        && now - chunkVoiceStartedAt > 650
        && now - lastVoiceAt > silenceMs;
      if (hasCompleteUtterance) stopCurrentAudioChunk();
    }
    meterFrame = requestAnimationFrame(draw);
  };
  draw();
}

function preferredMime() {
  const choices = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return choices.find(x => MediaRecorder.isTypeSupported(x)) || "";
}

function stopCurrentAudioChunk() {
  if (chunkStopping || mediaRecorder?.state !== "recording") return;
  chunkStopping = true;
  mediaRecorder.stop();
}

function startAudioChunk() {
  if (!running || !mediaStream) return;
  const chunks = [];
  const mimeType = preferredMime();
  const recorderOptions = { audioBitsPerSecond: 128000 };
  if (mimeType) recorderOptions.mimeType = mimeType;
  const recorder = new MediaRecorder(mediaStream, recorderOptions);
  mediaRecorder = recorder;
  chunkStartedAt = Date.now();
  chunkVoiceStartedAt = 0;
  lastVoiceAt = chunkStartedAt;
  chunkHadVoice = false;
  chunkStopping = false;
  chunkPeakLevel = 0;
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    clearTimeout(chunkTimeout);
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    // W trybie szybkim wysyłamy każdy fragment. Miernik steruje tylko miejscem
    // cięcia wypowiedzi — nie może już zdecydować, że cichy głos ma zniknąć.
    const likelyContainsSpeech = chunkHadVoice || chunkPeakLevel > Math.max(0.8, ambientLevel * 1.18);
    const shouldTranscribe = !$("#ecoMode").checked || likelyContainsSpeech;
    if (blob.size > 500 && shouldTranscribe && !discarding) {
      transcriptionQueue = transcriptionQueue
        .catch(() => {})
        .then(() => transcribeChunk(blob))
        .catch(error => { if (error.name !== "AbortError") setStatus(error.message); });
    }
    if (running) startAudioChunk();
    else if (stopRecorderResolver) { stopRecorderResolver(); stopRecorderResolver = null; }
  };
  recorder.start();
  // Nawet jeśli miernik nie rozpozna cichego głosu z telefonu, po 14 sekundach
  // powstanie kompletny fragment i w trybie szybkim trafi do transkrypcji.
  chunkTimeout = setTimeout(stopCurrentAudioChunk, 14000);
}

async function transcribeChunk(blob) {
  setStatus("Transkrybuję dźwięk…");
  const previousContext = segments
    .filter(x => !x.startsWith("[SETTER – potwierdzone]"))
    .slice(-5)
    .join(" ")
    .slice(-1200);
  const r = await fetch("/api/transcribe", {
    method:"POST",
    headers:{
      "content-type":blob.type || "audio/webm",
      "x-transcript-context":encodeURIComponent(previousContext)
    },
    body:blob,
    signal:sessionAbortController?.signal
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Nie udało się zapisać fragmentu rozmowy.");
  if (data.text) {
    segments.push(data.text);
    renderTranscript();
    setStatus("Słucham");
    // Nie blokuj kolejnych fragmentów oczekiwaniem na coacha. Dzięki temu
    // dziesięciominutowa rozmowa nie tworzy zalegającej kolejki audio.
    analyze(true);
  } else {
    setStatus("Słucham — brak mowy w ostatnim fragmencie");
  }
}

async function stopAudioCapture() {
  clearTimeout(chunkTimeout);
  await new Promise(resolve => {
    stopRecorderResolver = resolve;
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    else resolve();
  });
  try { await transcriptionQueue; } catch (e) { setStatus(e.message); }
  mediaStream?.getTracks().forEach(track => track.stop());
  inputStream?.getTracks().forEach(track => track.stop());
  cancelAnimationFrame(meterFrame);
  if (audioContext) await audioContext.close();
  $("#micLevel").style.width = "0";
  $("#micStatus").textContent = "nieaktywny";
}

$("#start").onclick = async () => {
  try {
    if (!window.MediaRecorder) throw new Error("Użyj aktualnej wersji Chrome lub Edge.");
    inputStream = await navigator.mediaDevices.getUserMedia({audio:{
      channelCount:{ideal:1},
      sampleRate:{ideal:48000},
      sampleSize:{ideal:16},
      echoCancellation:false,
      noiseSuppression:false,
      autoGainControl:false
    }});
    segments=[]; interim=""; lastAnalyzedTranscript=""; analysisInFlight=false; analysisPending=false; transcriptionQueue=Promise.resolve(); discarding=false; sessionAbortController=new AbortController(); coachAbortController=new AbortController(); running=true; startedAt=Date.now(); conversationId=`conversation-${startedAt}-${Math.random().toString(36).slice(2,8)}`; ambientLevel=0.35; voiceThreshold=0.7; finishedHeardText="";
    resetTranscriptView();
    renderTranscript();
    startMeter(inputStream);
    startAudioChunk();
    $("#start").disabled=true; $("#stop").disabled=false; $("#discard").disabled=false; $("#result").classList.add("hidden"); $("#generatedTranscript").classList.add("hidden"); $("#generateTranscript").disabled=false; $("#generateTranscript").textContent="Wygeneruj transkrypcję"; $("#copy").textContent="Kopiuj całość"; setStatus($("#ecoMode").checked ? "Słucham — tryb oszczędny" : "Słucham — tryb szybki");
    renderCoach({stage:"Czekam na kontekst",diagnosis:"AI zacznie przewidywać problem po pierwszej wypowiedzi.",problem:"Jeszcze nieustalony.",businessModel:"Jeszcze nieustalone.",confidence:"brak danych",evidence:[],missing:["kontekst klienta","obecny sposób działania"],warning:""});
    timerId=setInterval(() => {
      const sec=Math.floor((Date.now()-startedAt)/1000), m=String(Math.floor(sec/60)).padStart(2,"0"), s=String(sec%60).padStart(2,"0");
      $("#timer").textContent=`${m}:${s} / 10:00`;
      if(sec>=600) finish();
    },500);
  } catch(e) { setStatus(e.message); }
};
$("#stop").onclick = finish;
async function finish() {
  if(!running) return; running=false; analysisPending=false; coachAbortController?.abort(); clearInterval(timerId); clearTimeout(analysisTimer);
  $("#start").disabled=false; $("#stop").disabled=true; $("#discard").disabled=true; setStatus("Przetwarzam całą rozmowę i ostatni fragment…");
  try {
    await stopAudioCapture();
    sessionAbortController?.abort();
    finishedHeardText = plainTranscript();
    saveCurrentConversation("zakończona");
    setStatus("Tworzę podsumowanie…");
    const r=await fetch("/api/summary",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({transcript:finishedHeardText,used:[]})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error); renderSummary(d); saveCurrentConversation("zakończona",$("#finalContent").innerText); setStatus("Podsumowanie gotowe");
  } catch(e){setStatus(e.message)}
}

$("#discard").onclick = async () => {
  if (!running) return;
  if (!confirm("Odrzucić tę rozmowę? Tekst usłyszany przez aplikację zostanie wyczyszczony i nie powstanie podsumowanie.")) return;
  discarding = true;
  running = false;
  coachAbortController?.abort();
  sessionAbortController?.abort();
  clearInterval(timerId);
  clearTimeout(analysisTimer);
  $("#start").disabled = false;
  $("#stop").disabled = true;
  $("#discard").disabled = true;
  setStatus("Odrzucam rozmowę…");
  await stopAudioCapture();
  segments = [];
  interim = "";
  finishedHeardText = "";
  latestCoach = null;
  const discardedId=conversationId;
  conversationId="";
  writeArchive(readArchive().filter(x=>x.id!==discardedId));
  lastAnalyzedTranscript = "";
  resetTranscriptView();
  renderTranscript();
  renderCoach({stage:"Czekam na kontekst",diagnosis:"Czekam na pierwsze informacje o kliencie.",problem:"Jeszcze nieustalony.",businessModel:"Jeszcze nieustalone.",confidence:"brak danych",evidence:[],missing:["kontekst klienta","obecny sposób działania"],warning:""});
  $("#result").classList.add("hidden");
  $("#timer").textContent = "00:00 / 10:00";
  setStatus("Rozmowa odrzucona — nic nie zapisano");
};

function renderSummary(d) {
  const legacyFacts=Array.isArray(d.keyFacts) ? d.keyFacts.filter(Boolean).slice(0,10) : [];
  const legacyResponse=!d.client && (d.business || d.mainProblem || legacyFacts.length);
  if (legacyResponse) {
    const legacyBusiness=d.business || "Nie ustalono.";
    const legacyProblem=d.mainProblem || "Nie ustalono.";
    const legacyFormBusiness=d.formBusiness && !/^(do ustalenia|nie ustalono)\.?$/i.test(d.formBusiness.trim()) ? d.formBusiness : legacyBusiness;
    const legacyFormProblem=d.formProblem && !/^(do ustalenia|nie ustalono)\.?$/i.test(d.formProblem.trim()) ? d.formProblem : legacyProblem;
    $("#summaryContent").innerHTML=`
      <p class="compat-notice">Wyświetlono kompletne podsumowanie w starszym układzie. Zamknij czarne okno aplikacji i uruchom ją ponownie, aby kolejne rozmowy otrzymały również dodatkowe akapity.</p>
      <h3>Notatka dla closera</h3>
      <ul class="closer-summary">
        <li><b>Czym się zajmuje:</b> ${escapeHtml(legacyBusiness)}</li>
        <li><b>Największy problem:</b> ${escapeHtml(legacyProblem)}</li>
        ${legacyFacts.length ? `<li class="key-facts"><b>Kluczowe informacje:</b><ul>${legacyFacts.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></li>` : ""}
        ${d.deepen ? `<li><b>Do pogłębienia:</b> ${escapeHtml(d.deepen)}</li>` : ""}
      </ul>
      <h3>Gotowe do formularza</h3>
      <div class="form-ready"><div><span>Twój produkt jest usługą? Opisz krótko.</span><p id="formBusinessText">${escapeHtml(legacyFormBusiness)}</p></div><button class="copy-field" data-copy-target="formBusinessText">Kopiuj</button></div>
      <div class="form-ready"><div><span>Z czym masz obecnie problem?</span><p id="formProblemText">${escapeHtml(legacyFormProblem)}</p></div><button class="copy-field" data-copy-target="formProblemText">Kopiuj</button></div>`;
  } else {
  const problems=Array.isArray(d.mainProblems) && d.mainProblems.length ? d.mainProblems.slice(0,3) : ["do ustalenia"];
  const important=Array.isArray(d.closerImportant) && d.closerImportant.length ? d.closerImportant.slice(0,5) : ["do ustalenia"];
  const section=(title,text)=>`<section class="crm-section"><h3>${title}</h3><p>${escapeHtml(text || "do ustalenia")}</p></section>`;
  const formBusiness=d.formBusiness && !/^(do ustalenia|nie ustalono)\.?$/i.test(d.formBusiness.trim()) ? d.formBusiness : (d.client || "do ustalenia");
  const formProblem=d.formProblem && !/^(do ustalenia|nie ustalono)\.?$/i.test(d.formProblem.trim()) ? d.formProblem : problems[0];
    $("#summaryContent").innerHTML=`
    ${section("Klient",d.client)}
    ${section("Obecna sytuacja",d.currentSituation)}
    <section class="crm-section"><h3>Główny problem</h3><ul>${problems.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></section>
    ${section("Cel / potrzeba",d.goalNeed)}
    ${section("Motywacja / pilność",d.motivationUrgency)}
    ${section("Co już próbował",d.tried)}
    ${section("Decyzyjność / budżet",d.decisionBudget)}
    <section class="crm-section"><h3>Ważne dla closera</h3><ul>${important.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></section>
    ${section("Podsumowanie",d.summary)}
    <h3>Gotowe do formularza</h3>
    <p class="hint">Kliknij „Kopiuj” i wklej gotowe zdanie do formularza zgłoszeniowego.</p>
    <div class="form-ready">
      <div><span>Twój produkt jest usługą? Opisz krótko.</span><p id="formBusinessText">${escapeHtml(formBusiness)}</p></div>
      <button class="copy-field" data-copy-target="formBusinessText">Kopiuj</button>
    </div>
    <div class="form-ready">
      <div><span>Z czym masz obecnie problem?</span><p id="formProblemText">${escapeHtml(formProblem)}</p></div>
      <button class="copy-field" data-copy-target="formProblemText">Kopiuj</button>
    </div>`;
  }
  document.querySelectorAll(".copy-field").forEach(button => {
    button.onclick = async () => {
      const text=document.getElementById(button.dataset.copyTarget)?.textContent || "";
      await navigator.clipboard.writeText(text);
      button.textContent="Skopiowano";
      setTimeout(()=>{button.textContent="Kopiuj"},1200);
    };
  });
  $("#generatedTranscript").innerHTML = "";
  $("#generatedTranscript").classList.add("hidden");
  $("#result").classList.remove("hidden"); $("#result").scrollIntoView({behavior:"smooth"});
}
$("#generateTranscript").onclick=async()=>{
  if(!finishedHeardText) return;
  const button=$("#generateTranscript");
  button.disabled=true;
  button.textContent="Generuję…";
  setStatus("Generuję pełną transkrypcję…");
  try {
    const r=await fetch("/api/transcript",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({transcript:finishedHeardText,used:[]})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error);
    const transcript=(d.transcript||[]).map(x=>`<div class="line"><b>${escapeHtml(x.speaker)}:</b> ${escapeHtml(x.text)}</div>`).join("");
    $("#generatedTranscript").innerHTML=`<h3>Transkrypcja</h3>${transcript || '<p class="muted">Brak transkrypcji.</p>'}`;
    $("#generatedTranscript").classList.remove("hidden");
    button.textContent="Transkrypcja gotowa";
    setStatus("Transkrypcja gotowa");
  } catch(e) {
    button.disabled=false;
    button.textContent="Spróbuj ponownie";
    setStatus(e.message);
  }
};
function addManualFragment() {
  const input=$("#manualText"), x=input.value.trim();
  if(!x) return;
  if(!conversationId){startedAt=Date.now();conversationId=`conversation-${startedAt}-${Math.random().toString(36).slice(2,8)}`}
  segments.push(x); input.value=""; renderTranscript(); analyze();
}
$("#manual").onclick=addManualFragment;
$("#manualText").onkeydown=event=>{if(event.key==="Enter")addManualFragment()};
$("#toggleTranscript").onclick=()=>{
  const panel=$(".transcript-panel");
  const expanded=panel.classList.toggle("expanded");
  document.body.classList.toggle("transcript-open",expanded);
  $("#toggleTranscript").textContent=expanded ? "Zmniejsz" : "Powiększ";
  if(expanded) $("#liveTranscript").scrollTop=$("#liveTranscript").scrollHeight;
};
$("#copyTranscript").onclick=async()=>{
  const text=plainTranscript().trim();
  if(!text){setStatus("Nie ma jeszcze rozmowy do skopiowania");return}
  await navigator.clipboard.writeText(text);
  const button=$("#copyTranscript");
  button.textContent="Skopiowano całą rozmowę";
  setStatus("Cała rozmowa skopiowana");
  setTimeout(()=>{button.textContent="Kopiuj całą rozmowę"},1400);
};
$("#copy").onclick=async()=>{
  const copyContent=$("#finalContent").cloneNode(true);
  copyContent.querySelectorAll("button").forEach(button=>button.remove());
  await navigator.clipboard.writeText(copyContent.innerText);
  $("#copy").textContent="Skopiowano";
};
fetch("/api/health").then(r=>r.json()).then(d=>{if(!d.apiConfigured)setStatus("Brak klucza API")}).catch(()=>setStatus("Serwer offline"));
restoreLatestConversation();
setInterval(()=>{const before=readArchive();writeArchive(before)},60*1000);
