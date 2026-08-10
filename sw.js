const CACHE = "smokey-lite-v1";
const SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// App shell: cache-first (offline-ready). Kërkesat te Groq/PC nuk cache-ohen kurrë.
self.addEventListener("fetch", (e)=>{
  const url = new URL(e.request.url);
  if(SHELL.some(p => url.pathname.endsWith(p.replace("./","/")))){
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
