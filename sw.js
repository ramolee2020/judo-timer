const CACHE = "judo-timer-v7";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./styles.css",
  "./js/app.js", "./js/state.js", "./js/timer-engine.js", "./js/audio.js",
  "./js/setup-view.js", "./js/run-view.js",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png",
  "./assets/audio/hajime-user.wav", "./assets/audio/mate-user.wav",
  "./assets/audio/prigotovilis-user.oga", "./assets/audio/soromade-user.oga",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
