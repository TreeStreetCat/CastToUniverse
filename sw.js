/* 抛给宇宙 · Service Worker
   策略：
   - 预缓存全部静态资源（app shell），离线可用
   - 同源 GET 请求走「缓存优先 + 后台更新」（stale-while-revalidate）
   - 跨域请求（若后续接入 CDN）直接走网络，不缓存
   发版时只需改 VERSION，旧缓存会在 activate 阶段清理。 */

const VERSION = 'ptu-v1.1.0';
const PRECACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/answers.js',
  './js/wheel.js',
  './js/coin-dice.js',
  './js/blindbox.js',
  './js/reverse-coin.js',
  './js/countdown.js',
  './js/todo-list.js',
  './vendor/canvas-confetti.min.js',
  './data/answers.json',
  './data/notodo.json',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // 单个资源失败不应导致整个 SW 安装失败
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，断网回退到首页缓存
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// 允许页面在检测到新版本后主动触发更新
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
