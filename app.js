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

let pinBuffer = "";
let sessionKey = null; // AES-GCM CryptoKey, jetgjatë vetëm në memorie, jo në disk

// ============================================================
// 1. PIN SETUP / UNLOCK
// ============================================================
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
  if(!text) return;
  input.value = "";
  input.style.height = "auto";

  messages.push({ role:"user", text });
  renderBubble("user", text);
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
    renderBubble("ai", "Gabim: s'mora përgjigje. Kontrollo internetin ose PROXY_URL në app.js.");
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
