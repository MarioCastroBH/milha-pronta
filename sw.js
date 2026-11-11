// Service worker: deixa o app abrir sem internet, guardando o "casco" (arquivos locais).
// IMPORTANTE: ao alterar qualquer arquivo local, troque a versão abaixo (ex.: v2),
// senão o aparelho continua usando a versão antiga guardada no cache.
const VERSAO = "gastos-cartao-v3";

const CASCO = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/dominio.js",
  "./js/firebase-config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSAO).then((cache) => cache.addAll(CASCO)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);
  // Só intercepta arquivos do próprio site. Firebase e CDNs seguem direto pela rede.
  if (evento.request.method !== "GET" || url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(evento.request).then((emCache) => {
      if (emCache) return emCache;
      return fetch(evento.request).then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(evento.request, copia));
        return resposta;
      });
    })
  );
});
