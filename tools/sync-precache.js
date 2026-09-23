#!/usr/bin/env node
/* =========================================================================
   tools/sync-precache.js —— 同步 Service Worker 的预缓存清单

   作用：
   1. 扫描 css/ js/ data/ icons/ vendor/ 以及根目录的 index.html、manifest.json，
      自动生成 sw.js 里的 PRECACHE 数组，杜绝「新增了文件却忘了加进预缓存」；
   2. 给 VERSION 拼上一份全量内容哈希，任何文件一变，版本号就变，
      旧缓存随之失效，不必人工记着去 bump 版本；
   3. 顺带校验 index.html 里引用的每个本地资源都在清单里，离线时不会缺件。

   用法：node tools/sync-precache.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SW_FILE = path.join(ROOT, 'sw.js');
const APP_FILE = path.join(ROOT, 'js', 'app.js');
const HTML_FILE = path.join(ROOT, 'index.html');

// 需要离线可用的目录与根目录文件
const INCLUDE_DIRS = ['css', 'js', 'data', 'icons', 'vendor'];
const INCLUDE_FILES = ['index.html', 'manifest.json'];
// sw.js 自身不必进预缓存（它本来就是被浏览器直接拉取的脚本）
const EXCLUDE = new Set(['sw.js']);

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push.apply(out, walk(full));
    else out.push(full);
  }
  return out;
}

const files = [];
INCLUDE_FILES.forEach((f) => {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) files.push(p);
});
INCLUDE_DIRS.forEach((d) => {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) files.push.apply(files, walk(p));
});

const rel = files
  .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
  .filter((r) => !EXCLUDE.has(r))
  .sort();

// 内容哈希：文件名 + 内容一起参与，改名也算变动
const digest = crypto.createHash('sha256');
rel.forEach((r) => {
  digest.update(r);
  digest.update(fs.readFileSync(path.join(ROOT, r)));
});
const hash = digest.digest('hex').slice(0, 8);

const appSrc = fs.readFileSync(APP_FILE, 'utf8');
const vMatch = appSrc.match(/version:\s*'([^']+)'/);
const appVersion = vMatch ? vMatch[1] : '0.0.0';
const version = 'ptu-v' + appVersion + '-' + hash;

const list = ['./'].concat(rel.map((r) => './' + r));
const block =
  '/* PRECACHE:BEGIN */\n' +
  'const PRECACHE = [\n' +
  list.map((u) => "  '" + u + "'").join(',\n') +
  '\n];\n' +
  '/* PRECACHE:END */';

let sw = fs.readFileSync(SW_FILE, 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, "const VERSION = '" + version + "';");
sw = sw.replace(/\/\* PRECACHE:BEGIN \*\/[\s\S]*?\/\* PRECACHE:END \*\//, block);
fs.writeFileSync(SW_FILE, sw);

// 校验：index.html 引用的本地资源必须都在清单里
const html = fs.readFileSync(HTML_FILE, 'utf8');
const refs = [];
const reRef = /(?:src|href)="([^"]+)"/g;
let m;
while ((m = reRef.exec(html))) refs.push(m[1]);
const missing = refs.filter((r) => {
  if (/^(https?:|#|data:|mailto:)/.test(r)) return false;
  return list.indexOf('./' + r.replace(/^\.\//, '')) === -1;
});

console.log('预缓存条目：' + list.length + ' 个');
console.log('VERSION   ：' + version);
if (missing.length) {
  console.warn('警告：以下资源被 index.html 引用但不在预缓存清单中，离线时会缺失：');
  missing.forEach((r) => console.warn('  - ' + r));
  process.exitCode = 1;
} else {
  console.log('校验通过：index.html 引用的本地资源全部已缓存');
}
