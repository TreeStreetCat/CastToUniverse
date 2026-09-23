#!/usr/bin/env node
/* =========================================================================
   tools/test-logic.js —— 核心逻辑回归测试（零依赖，直接 node 运行）

   为什么要这个脚本：
   站点的「可信度」全押在随机逻辑上 —— 转盘说权重 3:1，落点概率就必须真是 3:1；
   骰子转到 5 点，朝向用户的那一面就必须真是 5 点。这类错误肉眼在代码里看不出来，
   真机上又只是「偶尔感觉不对」，所以固化成可重复运行的断言。

   覆盖：
     1. rand / randInt 的取值域与分布
     2. weightedIndex 是否严格等于权重比例（转盘公平性的根基）
     3. shuffle 是否为真随机排列且不修改入参
     4. 本地存储缺失（隐私模式）时是否优雅降级
     5. esc 的转义是否完整（防 XSS）
     6. 骰子「点数 ↔ 立方体旋转 ↔ CSS 面位移」三者是否自洽

   用法：node tools/test-logic.js
   ========================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* -------------------------------------------------------------------------
   1. 最小浏览器环境
   document.readyState 保持 'loading'：app.js 只会挂上 DOMContentLoaded 监听，
   不会真的去渲染页面，因此这里不需要准备任何真实 DOM。
   ------------------------------------------------------------------------- */
function createSandbox() {
  const doc = {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {} },
        setAttribute() {},
        appendChild() {},
        remove() {},
        focus() {},
        querySelector: () => null,
        querySelectorAll: () => []
      };
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: {},
    body: { appendChild() {} }
  };

  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    document: doc,
    navigator: {},                 // 故意不带 vibrate：顺带验证无震动能力时的降级
    location: { hash: '', protocol: 'https:' },
    crypto: globalThis.crypto,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    AbortController: AbortController,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob: function () {}
  };
  // 浏览器里 window 就是全局对象，这里同样自引用，
  // 这样 app.js 里的 window.App 与各模块里的裸 App 指向同一个对象。
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

const sandbox = createSandbox();
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'coin-dice.js'), 'utf8'), sandbox, { filename: 'coin-dice.js' });
const App = sandbox.App;

/* -------------------------------------------------------------------------
   2. 迷你断言
   ------------------------------------------------------------------------- */
let passed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('  ✓ ' + name);
  } else {
    failures.push(name + (detail ? ' —— ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? ' —— ' + detail : ''));
  }
}

function near(name, actual, expected, tol) {
  const diff = Math.abs(actual - expected);
  ok(name, diff <= tol, '实际 ' + actual.toFixed(4) + '，期望 ' + expected.toFixed(4) + ' ±' + tol);
}

/* -------------------------------------------------------------------------
   3. 随机数
   ------------------------------------------------------------------------- */
console.log('\n[1] 随机数');
{
  let inRange = true;
  for (let i = 0; i < 100000; i++) {
    const v = App.rand();
    if (!(v >= 0 && v < 1)) { inRange = false; break; }
  }
  ok('rand() 取值域恒为 [0, 1)', inRange);

  const N = 6;
  const hits = new Array(N).fill(0);
  let valid = true;
  for (let i = 0; i < 60000; i++) {
    const v = App.randInt(N);
    if (!(Number.isInteger(v) && v >= 0 && v < N)) { valid = false; break; }
    hits[v] += 1;
  }
  ok('randInt(n) 取值域恒为 [0, n)', valid);
  ok('randInt(6) 六个面都被取到过', hits.every((h) => h > 0), '计数 ' + hits.join('/'));
  hits.forEach((h, i) => near('randInt(6) 第 ' + (i + 1) + ' 面频率≈1/6', h / 60000, 1 / 6, 0.02));
}

/* -------------------------------------------------------------------------
   4. 权重选择 —— 转盘公平性的根基
   ------------------------------------------------------------------------- */
console.log('\n[2] 权重选择 weightedIndex');
{
  const weights = [1, 3, 6];
  const total = weights.reduce((a, b) => a + b, 0);
  const runs = 120000;
  const hits = [0, 0, 0];
  for (let i = 0; i < runs; i++) hits[App.weightedIndex(weights)] += 1;
  weights.forEach((w, i) => {
    near('权重 ' + w + ' 的命中率≈' + (w / total).toFixed(2), hits[i] / runs, w / total, 0.02);
  });

  // 权重全为 0 时必须退化为等概率，而不是永远返回第一个
  const zero = [0, 0, 0, 0];
  const zHits = [0, 0, 0, 0];
  for (let i = 0; i < 80000; i++) zHits[App.weightedIndex(zero)] += 1;
  zHits.forEach((h, i) => near('全 0 权重退化为等概率（第 ' + (i + 1) + ' 项）', h / 80000, 0.25, 0.02));

  // 只有一项有权重时必须 100% 命中它
  let only = true;
  for (let i = 0; i < 5000; i++) if (App.weightedIndex([0, 5, 0]) !== 1) { only = false; break; }
  ok('只有一项有权重时必中该项', only);
}

/* -------------------------------------------------------------------------
   5. 洗牌
   ------------------------------------------------------------------------- */
console.log('\n[3] 洗牌 shuffle');
{
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const snapshot = src.slice();
  let allPermutation = true;
  const firstCount = new Array(8).fill(0);

  for (let i = 0; i < 20000; i++) {
    const out = App.shuffle(src);
    if (out.length !== src.length) { allPermutation = false; break; }
    const sorted = out.slice().sort((a, b) => a - b);
    if (sorted.join(',') !== snapshot.join(',')) { allPermutation = false; break; }
    firstCount[out[0] - 1] += 1;
  }
  ok('shuffle 结果是原数组的排列（不丢不重）', allPermutation);
  ok('shuffle 不修改入参', src.join(',') === snapshot.join(','));
  firstCount.forEach((c, i) => near('元素 ' + (i + 1) + ' 出现在首位的概率≈1/8', c / 20000, 1 / 8, 0.03));
}

/* -------------------------------------------------------------------------
   6. 存储降级 / 转义 / 日期键
   ------------------------------------------------------------------------- */
console.log('\n[4] 容错与工具函数');
{
  // 沙箱里没有 localStorage，正是隐私模式的等价场景
  ok('无 localStorage 时 get 返回兜底值', App.storage.get('nope', 'FALLBACK') === 'FALLBACK');
  ok('无 localStorage 时 set 返回 false 而不抛错', App.storage.set('nope', 1) === false);

  const evil = '<img src=x onerror="alert(1)">&foo';
  const out = App.esc(evil);
  ok('esc 转义 < 与 >', out.indexOf('<') === -1 && out.indexOf('>') === -1);
  ok('esc 转义引号', out.indexOf('"') === -1 && out.indexOf('\'') === -1);
  ok('esc 转义 &', out.indexOf('&amp;') !== -1);

  ok('todayKey 形如 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(App.todayKey(new Date(2026, 8, 23))));
  ok('todayKey 按本地时区补零', App.todayKey(new Date(2026, 0, 5)) === '2026-01-05');
}

/* -------------------------------------------------------------------------
   7. 骰子：点数 ↔ 旋转 ↔ CSS 面位移
   直接从 style.css 解析每一面的 rotate 值，再和 JS 的 FACE_ROTATION 做矩阵运算，
   验证「转到 v 点时朝向用户的确实是 v 那一面」。改了 CSS 或 JS 任一侧都会立刻报错。
   ------------------------------------------------------------------------- */
console.log('\n[5] 骰子面与旋转映射');
{
  const dice = App.__dice;
  ok('测试钩子 App.__dice 可用', !!(dice && dice.PIPS && dice.FACE_ROTATION && dice.FACE_ORDER));

  // 7.1 点数布局
  let pipsOk = true;
  for (let v = 1; v <= 6; v++) {
    const pips = dice.PIPS[v];
    if (!Array.isArray(pips) || pips.length !== v) { pipsOk = false; break; }
    if (new Set(pips).size !== pips.length) { pipsOk = false; break; }
    if (pips.some((i) => i < 0 || i > 8)) { pipsOk = false; break; }
  }
  ok('PIPS：1~6 点的点位数量与点数一致且无重复', pipsOk);

  const order = dice.FACE_ORDER.slice().sort((a, b) => a - b).join(',');
  ok('FACE_ORDER 恰好包含 1~6 各一次', order === '1,2,3,4,5,6');

  // 7.2 从 CSS 解析每一面的基础旋转
  const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  const reFace = /\.dice-face\[data-face="(\d)"\]\s*\{\s*transform:\s*([^;}]+)/g;
  const faceBase = {};
  let m;
  while ((m = reFace.exec(css))) {
    const face = Number(m[1]);
    const rot = m[2].match(/rotate([XY])\(\s*(-?\d+)deg\)/);
    faceBase[face] = rot ? { axis: rot[1], deg: Number(rot[2]) } : { axis: null, deg: 0 };
  }
  ok('从 style.css 解析到 6 个面的位移', Object.keys(faceBase).length === 6,
    '解析到 ' + Object.keys(faceBase).length + ' 个');

  // 7.3 矩阵工具（与 CSS transform 规范一致）
  const rad = (d) => (d * Math.PI) / 180;
  const rotX = (d) => { const t = rad(d), c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
  const rotY = (d) => { const t = rad(d), c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
  const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((sum, v, k) => sum + v * B[k][j], 0)));
  const apply = (A, v) => A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const baseMatrix = (b) => (b.axis === 'X' ? rotX(b.deg) : b.axis === 'Y' ? rotY(b.deg) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);

  // 每一面在立方体自身坐标系里的法向量（未经立方体旋转）
  const normal = {};
  Object.keys(faceBase).forEach((f) => {
    normal[f] = apply(baseMatrix(faceBase[f]), [0, 0, 1]);
  });

  // 7.4 逐个点数验证：加完目标旋转后，该面法向量应当正对用户 (0,0,1)
  let mapOk = true;
  const detail = [];
  for (let v = 1; v <= 6; v++) {
    const t = dice.FACE_ROTATION[v];
    const R = mul(rotX(t.x), rotY(t.y));           // CSS 的 rotateX(a) rotateY(b)
    const nv = apply(R, normal[v]);
    const facing = Math.abs(nv[0]) < 1e-9 && Math.abs(nv[1]) < 1e-9 && nv[2] > 0.999;
    if (!facing) {
      mapOk = false;
      detail.push(v + ' 点朝向 ' + nv.map((n) => n.toFixed(2)).join(','));
    }
    // 同时确认没有第二个面也正对用户
    Object.keys(normal).forEach((other) => {
      if (Number(other) === v) return;
      const no = apply(R, normal[other]);
      if (no[2] > 0.999) { mapOk = false; detail.push(v + ' 点时 ' + other + ' 面也朝前'); }
    });
  }
  ok('转到 v 点时朝向用户的确实是 v 那一面', mapOk, detail.join('；'));

  // 7.5 相对两面点数之和为 7（标准骰子的物理约束）
  let oppositeOk = true;
  for (let v = 1; v <= 3; v++) {
    const a = normal[v];
    const b = normal[7 - v];
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (Math.abs(dot + 1) > 1e-9) oppositeOk = false;
  }
  ok('相对两面的点数之和为 7', oppositeOk);
}

/* -------------------------------------------------------------------------
   8. 汇总
   ------------------------------------------------------------------------- */
console.log('\n' + '-'.repeat(56));
if (failures.length) {
  console.log('通过 ' + passed + ' 项，失败 ' + failures.length + ' 项：');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log('全部通过：' + passed + ' 项断言');
  process.exit(0);
}
