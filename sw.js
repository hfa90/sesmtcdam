/* Service worker do DDS SESMT.
   - Guarda as telas do app para abrir rápido e funcionar como aplicativo instalado.
   - Chamadas ao Supabase NUNCA são guardadas (assinaturas sempre online e em tempo real). */
const VERSAO = "dds-v2.0.0";
const SHELL = [
  "./", "index.html", "colaborador.html", "supervisor.html", "admin.html", "evidencia.html", "offline.html",
  "manifest.webmanifest",
  "assets/css/app.css",
  "assets/js/config.js", "assets/js/app.js", "assets/js/pwa.js", "assets/js/camera.js",
  "assets/js/colaborador.js", "assets/js/supervisor.js", "assets/js/admin.js", "assets/js/relatorios.js",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "assets/icons/apple-touch-icon.png", "assets/icons/favicon-32.png",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (ev) => { if (ev.data === "atualizar") self.skipWaiting(); });

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.includes("/rest/v1/") || url.hostname.endsWith("supabase.co")) return; // API: sempre rede

  // Bibliotecas de CDN e fontes: cache primeiro
  if (url.origin !== self.location.origin) {
    ev.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
        return res;
      }))
    );
    return;
  }

  // Arquivos do app: rede primeiro (sempre a versão mais nova), cache se estiver sem internet
  ev.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const cp = res.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("offline.html") : undefined)))
  );
});
