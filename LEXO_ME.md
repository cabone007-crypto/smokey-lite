# Smokey AI Lite — Udhëzues instalimi

Version i lehtë i Smokey AI që punon **direkt nga S24+**, pa pasur nevojë që PC-ja jote të jetë ndezur.

## Çfarë përmban paketa

| File | Roli |
|---|---|
| `index.html`, `style.css`, `app.js` | Vetë app-i (chat + kyçje me PIN/biometri) |
| `manifest.json`, `sw.js`, `icons/` | E bëjnë app-in të instalueshëm si PWA |
| `worker.js` | Kodi i proxy-t (xhiron në Cloudflare, JO në telefon) |

## Hapi 1 — Merr një API key falas nga Groq
1. Shko te [console.groq.com](https://console.groq.com) → krijo llogari falas.
2. Krijo një **API Key** dhe kopjoje.

## Hapi 2 — Vendos proxy-n (mban të fshehur çelësin)
1. Shko te [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**.
2. Fshi kodin shembull, ngjit përmbajtjen e `worker.js`.
3. **Deploy**.
4. Te **Settings → Variables and Secrets** shto: `GROQ_API_KEY` = çelësi yt nga Hapi 1.
5. Kopjo URL-në që të jep Cloudflare (p.sh. `https://smokey-proxy.<emri-yt>.workers.dev`).

## Hapi 3 — Lidh app-in me proxy-n
Hap `app.js`, rreshti i parë i `CONFIG`:
```js
PROXY_URL: "https://smokey-proxy.<emri-yt>.workers.dev/chat",
```
Vendos URL-në tënde reale nga Hapi 2 (shto `/chat` në fund).

## Hapi 4 — Publiko me GitHub Pages
1. Krijo një repo të re në GitHub (p.sh. `smokey-lite`).
2. Ngarko të gjitha file-t e kësaj dosjeje **PËRVEÇ** `worker.js` (ai shkon vetëm te Cloudflare, jo publik).
3. Settings → Pages → Branch: `main` → Save.
4. Merr linkun (p.sh. `https://<username>.github.io/smokey-lite/`).

## Hapi 5 — Instalo në S24+
1. Hap linkun nga Hapi 4 në **Chrome** në telefon.
2. Menyja (⋮) → **Shto në ekranin bazë / Instalo app**.
3. Hapet si app e vërtetë, jashtë browser-it.
4. Herën e parë do të krijosh një **PIN 4-shifror** — kjo enkripton bisedat lokalisht në telefon.

## Si funksionon pavarësia nga PC-ja
- **Chat-i** shkon gjithmonë: telefon → Cloudflare Worker → Groq. PC-ja s'preket fare.
- **Statusi lart djathtas** tregon nëse PC-ja/Tailscale është e arritshme, thjesht si informacion — s'e bllokon chat-in nëse PC-ja është fikur.
- **Bisedat** ruhen të enkriptuara (AES-256) lokalisht në telefon me `localStorage`, të kyçura me PIN-in tënd.

## Çfarë mbetet fazë e dytë (nëse do vazhdojmë më vonë)
- Sync i vërtetë i të dhënave me backend-in/Knowledge Graph kur PC-ja është online.
- Model plotësisht offline (Termux/Ollama-Android) për kur s'ka fare internet.
- WebAuthn/biometri e plotë (aktualisht është version fillestar/beta, PIN-i mbetet mekanizmi kryesor i enkriptimit).
