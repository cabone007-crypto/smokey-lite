
/* ============================================================
   SMOKEY AI LITE — app.js
   Gjithçka lokale në telefon. Asnjë varësi nga PC-ja për të funksionuar.
   ============================================================ */

// ---------- KONFIGURIM (ndrysho këto për setup-in tënd) ----------
const CONFIG = {
  // URL e Cloudflare Worker-it që fsheh Groq API key-in (shih worker.js)
  PROXY_URL: "https://smokey-proxy.cabone007.workers.dev/chat",
  // Modeli Groq (falas, i shpejtë)
  MODEL: "llama-3.3-70b-versatile",
  // Adresa e backend-it në PC (Tailscale) — përdoret VETËM për status/sync, jo për chat
  PC_PING_URL: "https://100.125.120.30:8000/docs",
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const lockScreen = $("lockScreen"), app = $("app");
const pinDots = $("pinDots"), lockError = $("lockError"), lockSub = $("lockSub");
const chatLog = $("chatLog"), composer = $("composer"), input = $("input");
const statusDot = $("statusDot"), statusLine = $("statusLine");
const attachBtn = $("attachBtn"), fileInput = $("fileInput");
const attachChip = $("attachChip"), attachName = $("attachName"), attachRemove = $("attachRemove");

let attachedFile = null; // { name, kind:'docx'|'xlsx', text, chartData }

if(attachBtn && fileInput) attachBtn.addEventListener("click", ()=> fileInput.click());

if(fileInput) fileInput.addEventListener("change", async ()=>{
  const file = fileInput.files[0];
  fileInput.value = "";
  if(!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  attachBtn.classList.add("active");
  attachName.textContent = "duke lexuar " + file.name + "…";
  attachChip.classList.remove("hidden");

  try{
    const buf = await file.arrayBuffer();
    if(ext === "docx"){
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      attachedFile = { name: file.name, kind:"docx", text: result.value || "" };
    } else if(ext === "xlsx"){
      const wb = XLSX.read(buf, { type:"array" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:"" });
      attachedFile = { name: file.name, kind:"xlsx", text: csv.slice(0, 12000), chartData: buildChartData(rows) };
    } else {
      attachName.textContent = "Format i papërkrahur (vetëm .docx / .xlsx)";
      setTimeout(clearAttachment, 2200);
      return;
    }
    attachName.textContent = "📎 " + file.name;
  }catch(err){
    attachName.textContent = "Gabim leximi: " + err.message;
    setTimeout(clearAttachment, 2500);
  }
});

if(attachRemove) attachRemove.addEventListener("click", clearAttachment);

function clearAttachment(){
  attachedFile = null;
  if(attachChip) attachChip.classList.add("hidden");
  if(attachBtn) attachBtn.classList.remove("active");
}

// Nxjerr labels/vlera nga rreshtat e Excel-it për grafik automatik
function buildChartData(rows){
  if(!rows || rows.length < 2) return null;
  const headers = rows[0];
  const dataRows = rows.slice(1).filter(r => r.length && r[0] !== "" && r[0] !== undefined);
  if(!dataRows.length) return null;
  let valueColIdx = -1;
  for(let c = 1; c < headers.length; c++){
    let numCount = 0;
    dataRows.forEach(r => { if(typeof r[c] === "number") numCount++; });
    if(numCount > dataRows.length * 0.6){ valueColIdx = c; break; }
  }
  if(valueColIdx === -1) return null;
  const labels = dataRows.map(r => String(r[0])).slice(0, 30);
  const values = dataRows.map(r => typeof r[valueColIdx] === "number" ? r[valueColIdx] : 0).slice(0, 30);
  return { labels, values, valueLabel: headers[valueColIdx] || "Vlera" };
}

function renderChartBubble(chartData){
  const div = document.createElement("div");
  div.className = "bubble chart";
  const canvas = document.createElement("canvas");
  div.appendChild(canvas);
  chatLog.appendChild(div);
  scrollBottom();
  new Chart(canvas, {
    type: "bar",
    data: {
      labels: chartData.labels,
      datasets: [{ label: chartData.valueLabel, data: chartData.values, backgroundColor: "#FF6A3D" }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#E8E2D9" } } },
      scales: {
        x: { ticks: { color: "#8A8178" }, grid: { color: "#332D28" } },
        y: { ticks: { color: "#8A8178" }, grid: { color: "#332D28" } }
      }
    }
  });
}

// ---------- Regjistrim zanor + transkriptim (Groq Whisper) ----------
const recordBtn = $("recordBtn");
const TRANSCRIBE_URL = CONFIG.PROXY_URL.replace(/\/chat$/, "/transcribe");
let mediaRecorder = null, audioChunks = [], isRecording = false, recTimer = null, recSeconds = 0;

if(recordBtn) recordBtn.addEventListener("click", async ()=>{
  if(isRecording){ stopRecording(); return; }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e)=>{ if(e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async ()=>{
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      await transcribeAndAttach(blob);
    };
    mediaRecorder.start();
    isRecording = true;
    recSeconds = 0;
    recordBtn.classList.add("recording");
    recTimer = setInterval(()=>{
      recSeconds++;
      const m = Math.floor(recSeconds/60), s = recSeconds%60;
      recordBtn.textContent = `⏹️ ${m}:${String(s).padStart(2,"0")}`;
    }, 1000);
  }catch(err){
    attachChip.classList.remove("hidden");
    attachName.textContent = "S'kam qasje te mikrofoni: " + err.message;
    setTimeout(clearAttachment, 3000);
  }
});

function stopRecording(){
  if(mediaRecorder && isRecording){ mediaRecorder.stop(); }
  isRecording = false;
  clearInterval(recTimer);
  recordBtn.classList.remove("recording");
  recordBtn.textContent = "🎙️";
}

async function transcribeAndAttach(blob){
  attachChip.classList.remove("hidden");
  attachName.textContent = "duke transkriptuar bisedën…";
  try{
    const form = new FormData();
    form.append("file", blob, "recording.webm");
    form.append("model", "whisper-large-v3-turbo");
    const res = await fetch(TRANSCRIBE_URL, { method:"POST", body: form });
    if(!res.ok) throw new Error("transkriptim dështoi " + res.status);
    const data = await res.json();
    const transcript = data.text || "";
    if(!transcript.trim()){
      attachName.textContent = "S'u dëgjua asgjë e qartë";
      setTimeout(clearAttachment, 2500);
      return;
    }
    attachedFile = { name: "Regjistrim (" + recSeconds + "s)", kind:"docx", text: transcript };
    attachName.textContent = "🎙️ Transkriptuar (" + Math.round(transcript.length/5) + " fjalë) — shkruaj pyetjen ose dërgo direkt";
  }catch(err){
    attachName.textContent = "Gabim transkriptimi: " + err.message;
    setTimeout(clearAttachment, 3000);
  }
}

// ============================================================
// 1. PIN SETUP / UNLOCK
// ============================================================
let pinBuffer = "";
let sessionKey = null; // AES-GCM CryptoKey, jetgjatë vetëm në memorie, jo në disk

const hasPin = () => !!localStorage.getItem("smokey_pin_salt");

function renderDots(){
  const spans = pinDots.querySelectorAll("span");
  spans.forEach((s,i)=> s.classList.toggle("filled", i < pinBuffer.length));
}

async function deriveKey(pin, saltB64){
  const salt = Uint8Array.from(atob(saltB64), c=>c.charCodeAt(0));
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:150000, hash:"SHA-256" },
    material,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt","decrypt"]
  );
}

async function setupPin(pin){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = btoa(String.fromCharCode(...salt));
  localStorage.setItem("smokey_pin_salt", saltB64);
  sessionKey = await deriveKey(pin, saltB64);
  // verifier: enkriptojmë një fjalë të njohur për ta kontrolluar PIN-in herës tjetër
  const verifier = await encryptText("smokey-ok");
  localStorage.setItem("smokey_pin_verifier", JSON.stringify(verifier));
  unlockApp();
}

async function tryUnlock(pin){
  const saltB64 = localStorage.getItem("smokey_pin_salt");
  const key = await deriveKey(pin, saltB64);
  try{
    const verifier = JSON.parse(localStorage.getItem("smokey_pin_verifier"));
    const plain = await decryptWithKey(key, verifier);
    if(plain !== "smokey-ok") throw new Error("bad");
    sessionKey = key;
    unlockApp();
  }catch(e){
    lockError.textContent = "PIN i gabuar";
    pinDots.classList.add("shake");
    setTimeout(()=>{ pinDots.classList.remove("shake"); pinBuffer=""; renderDots(); }, 350);
  }
}

function unlockApp(){
  lockScreen.classList.add("hidden");
  app.classList.remove("hidden");
  loadHistory();
  checkPcStatus();
}

$("pinPad").addEventListener("click", (e)=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  if(btn.id === "delBtn"){ pinBuffer = pinBuffer.slice(0,-1); renderDots(); return; }
  if(btn.id === "biometricBtn"){ tryBiometric(); return; }
  if(btn.dataset.k === undefined) return;
  if(pinBuffer.length >= 4) return;
  pinBuffer += btn.dataset.k;
  renderDots();
  if(pinBuffer.length === 4){
    lockError.textContent = "";
    if(hasPin()) tryUnlock(pinBuffer);
    else setupPin(pinBuffer);
  }
});

// Ekrani i parë: nëse s'ka PIN të ruajtur, kërkojmë ta krijojë
if(!hasPin()) lockSub.textContent = "Krijo një PIN 4-shifror";

// ---------- Biometrikë (WebAuthn, opsionale) ----------
async function tryBiometric(){
  if(!window.PublicKeyCredential){
    lockError.textContent = "Biometria s'mbështetet në këtë shfletues";
    return;
  }
  try{
    const credId = localStorage.getItem("smokey_webauthn_id");
    if(!credId){
      // Regjistrim i parë i gjurmës/fytyrës si "çelës" lokal
      const cred = await navigator.credentials.create({
        publicKey:{
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp:{ name:"Smokey AI Lite" },
          user:{ id: crypto.getRandomValues(new Uint8Array(16)), name:"smokey-user", displayName:"Smokey" },
          pubKeyCredParams:[{ type:"public-key", alg:-7 }],
          authenticatorSelection:{ authenticatorAttachment:"platform", userVerification:"required" },
          timeout:30000,
        }
      });
      localStorage.setItem("smokey_webauthn_id", cred.id);
      lockError.textContent = "Biometria u regjistrua — provo PIN-in tani për ta lidhur";
      return;
    }
    await navigator.credentials.get({
      publicKey:{
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials:[{ id: Uint8Array.from(atob(credId), c=>c.charCodeAt(0)), type:"public-key" }],
        userVerification:"required",
        timeout:30000,
      }
    });
    // Biometria u konfirmua nga OS-i, por ne prapë na duhet PIN-i për me e derivu çelësin e enkriptimit
    lockError.textContent = "Identiteti u konfirmua — vendos PIN-in për të hyrë";
  }catch(err){
    lockError.textContent = "Biometria dështoi ose u anulua";
  }
}

$("lockBtn").addEventListener("click", ()=>{
  sessionKey = null;
  app.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  pinBuffer = ""; renderDots(); lockError.textContent="";
});

// ============================================================
// 2. ENKRIPTIM I HISTORISË SË CHAT-IT (lokale, AES-GCM)
// ============================================================
async function encryptText(text){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, sessionKey, new TextEncoder().encode(text));
  return { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
}
async function decryptWithKey(key, {iv, ct}){
  const ivArr = Uint8Array.from(atob(iv), c=>c.charCodeAt(0));
  const ctArr = Uint8Array.from(atob(ct), c=>c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv:ivArr}, key, ctArr);
  return new TextDecoder().decode(plain);
}
async function decryptText(payload){ return decryptWithKey(sessionKey, payload); }

let messages = []; // {role:'user'|'ai', text}

async function saveHistory(){
  const blob = await encryptText(JSON.stringify(messages));
  localStorage.setItem("smokey_history", JSON.stringify(blob));
}
async function loadHistory(){
  const raw = localStorage.getItem("smokey_history");
  chatLog.innerHTML = `<div class="sys-msg">Smokey Lite është gati. Punon direkt nga telefoni, pa varësi nga PC-ja.</div>`;
  if(!raw) return;
  try{
    const payload = JSON.parse(raw);
    messages = JSON.parse(await decryptText(payload));
    messages.forEach(m => renderBubble(m.role, m.text, false));
    scrollBottom();
  }catch(e){ /* histori e vjetër/e pakompatiblë — injoro në heshtje */ }
}

// ============================================================
// 3. STATUSI: PC/Tailscale i arritshëm apo jo (vetëm informativ)
// ============================================================
async function checkPcStatus(){
  statusDot.className = "ember-dot";
  statusLine.textContent = "duke kontrolluar…";
  try{
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 2500);
    await fetch(CONFIG.PC_PING_URL, { mode:"no-cors", signal: ctrl.signal });
    clearTimeout(t);
    statusDot.classList.add("synced");
    statusLine.textContent = "PC i lidhur · sinkronizuar";
  }catch(e){
    statusDot.classList.add("online");
    statusLine.textContent = "vetëm lokal · pa PC";
  }
}

// ============================================================
// 4. CHAT — thërret Groq direkt përmes proxy-t, jo PC-në
// ============================================================
function renderBubble(role, text, animate=true){
  const div = document.createElement("div");
  div.className = `bubble ${role === "user" ? "user" : "ai"}`;
  div.textContent = text;
  chatLog.appendChild(div);
  if(animate) scrollBottom();
  return div;
}
function scrollBottom(){ chatLog.scrollTop = chatLog.scrollHeight; }

composer.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const text = input.value.trim();
  if(!text && !attachedFile) return;
  input.value = "";
  input.style.height = "auto";

  let sendText = text;
  let displayText = text;

  if(attachedFile){
    const label = "📎 " + attachedFile.name;
    displayText = text ? (text + "\n\n" + label) : label;

    if(attachedFile.kind === "xlsx"){
      if(attachedFile.chartData) renderChartBubble(attachedFile.chartData);
      const question = text || "Analizo këto të dhëna dhe nxirr vëzhgimet kryesore shkurt, në shqip.";
      sendText = question + "\n\n--- Të dhënat nga " + attachedFile.name + " (CSV) ---\n" + attachedFile.text + "\n--- fund ---";
    } else {
      const isTranscript = attachedFile.name.startsWith("Regjistrim");
      const question = text || (isTranscript
        ? "Përmblidh këtë bisedë: pikat kryesore, vendimet, dhe hapat e ardhshëm, në shqip."
        : "Përmblidh këtë dokument shkurt, në shqip.");
      sendText = question + "\n\n--- Përmbajtja e " + attachedFile.name + " ---\n" + attachedFile.text.slice(0, 10000) + "\n--- fund ---";
    }
    clearAttachment();
  }

  messages.push({ role:"user", text: sendText });
  renderBubble("user", displayText);
  saveHistory();

  const thinking = renderBubble("ai", "…duke menduar", true);
  thinking.classList.add("thinking");

  try{
    const reply = await askAI(messages);
    thinking.remove();
    messages.push({ role:"ai", text: reply });
    renderBubble("ai", reply);
    saveHistory();
  }catch(err){
    thinking.remove();
    renderBubble("ai", "Gabim real: " + (err && err.message ? err.message : String(err)));
  }
});

input.addEventListener("input", ()=>{
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
});

async function askAI(history){
  const res = await fetch(CONFIG.PROXY_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      messages: history.slice(-20).map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text
      }))
    })
  });
  if(!res.ok) throw new Error("proxy error " + res.status);
  const data = await res.json();
  return data.reply;
}

// ---------- Service worker (offline shell) ----------
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=> navigator.serviceWorker.register("sw.js"));
}
