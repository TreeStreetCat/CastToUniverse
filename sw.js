/* 抛给宇宙 · Service Worker
   策略：
   - 预缓存全部静态资源（app shell），离线可用
   - 同源 GET 请求走「缓存优先 + 后台更新」（stale-while-revalidate）
   - 跨域请求（若后续接入 CDN）直接走网络，不缓存
   版本号与预缓存清单均由 tools/sync-precache.js 自动生成：
   版本号里带全量内容哈希，文件一变就换版本，activate 阶段自动清理旧缓存。 */

const VERSION = 'ptu-v1.2.0-584d9a62';

/* 下面的清单由 tools/sync-precache.js 自动生成，不要手改。
   新增 / 改名 / 删除任何静态文件后，跑一次：
       node tools/sync-precache.js
   就会重新扫描并写入；VERSION 里带一份全量内容哈希，文件一变缓存自动失效，
   再也不用人工记着去 bump 版本号。手改的内容会在下次同步时被覆盖。 */
/* PRECACHE:BEGIN */
const PRECACHE = [
  './',
  './css/style.css',
  './data/answers.json',
  './data/notodo.json',
  './icons/favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './js/answers.js',
  './js/app.js',
  './js/blindbox.js',
  './js/coin-dice.js',
  './js/countdown.js',
  './js/reverse-coin.js',
  './js/todo-list.js',
  './js/wheel.js',
  './manifest.json',
  './vendor/canvas-confetti.min.js'
];
/* PRECACHE:END */

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
