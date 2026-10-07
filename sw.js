const CACHE = "judo-timer-v14";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./styles.css",
  "./js/app.js", "./js/state.js", "./js/timer-engine.js", "./js/audio.js",
  "./js/setup-view.js", "./js/run-view.js",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png",
  "./assets/audio/hajime-tts.oga", "./assets/audio/mate-tts.oga",
  "./assets/audio/prigotovilis-tts.oga", "./assets/audio/soromade-tts.oga",
  ...["tektur-cyrillic-600","tektur-latin-600","tektur-cyrillic-700","tektur-latin-700",
      "onest-cyrillic-400","onest-latin-400","onest-cyrillic-600","onest-latin-600",
      "onest-cyrillic-700","onest-latin-700"].map((f) => "./assets/fonts/" + f + ".woff2"),
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
