/* Service worker minimal : cache l'app shell (HTML/CSS/JS propres à l'app) pour un
   usage hors-ligne de base. Tout ce qui vient d'un autre domaine (polices, KaTeX
   via CDN) passe par le réseau normalement ; s'il est déjà en cache navigateur
   tant mieux, sinon l'app dégrade proprement (le Markdown/LaTeX brut reste lisible
   même si KaTeX ne peut pas se charger). */
const CACHE = "tona-app-v1";
const SHELL = [
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/app.css",
  "./assets/js/app.js",
  "./assets/js/db.js",
  "./assets/js/fsrs.js",
  "./assets/js/content.js",
  "./assets/js/gamification.js",
  "./assets/js/csv.js",
  "../assets/css/style.css",
  "../assets/js/main.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // laisse passer les CDN externes normalement

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
