// Service worker com estratégia "rede primeiro":
// quando há internet, o app sempre busca a versão mais nova dos arquivos locais.
// Sem internet, usa a última cópia guardada no cache.
// Não é preciso trocar VERSAO a cada publicação, mas trocá-la limpa caches antigos.
const VERSAO = "gastos-cartao-v11";

const CASCO = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/dominio.js",
  "./js/importador.js",
  "./js/firebase-config.js",
  "./icons/icon-192-v2.png",
  "./icons/icon-512-v2.png",
  "./icons/icon-maskable-512-v2.png",
  "./icons/apple-touch-icon-180-v2.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(CASCO)).then(() => self.skipWaiting())
  );
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
  // Só trata arquivos do próprio site. Firebase e CDNs seguem direto pela rede.
  if (evento.request.method !== "GET" || url.origin !== self.location.origin) return;

  evento.respondWith(
    fetch(evento.request)
      .then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(evento.request, copia));
        return resposta;
      })
      .catch(() => caches.match(evento.request))
  );
});
