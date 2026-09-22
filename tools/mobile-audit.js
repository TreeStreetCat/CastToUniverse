#!/usr/bin/env node
/*
 * mobile-audit.js — 移动端适配审计（真浏览器，零依赖）
 *
 * 检查三件事：
 *   1. 横向溢出：documentElement.scrollWidth 是否大于视口宽度；若溢出，列出越界元素
 *   2. 触控目标：所有可点元素的命中区域是否 < 44px（Apple HIG / WCAG 建议值）
 *   3. 运行时报错：控制台 error / 未捕获异常 / HTTP>=400
 *
 * 用法：node tools/mobile-audit.js [baseUrl]
 * 退出码：发现横向溢出或运行时报错 → 1
 *
 * 说明：深测视口会触发真实交互（翻书 / 转盘 / 抛硬币 / 抽签 …），
 *       因为很多溢出只在结果渲染之后才出现；其余视口只看静态布局，跑得快。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9344);
const PROFILE = path.join(os.tmpdir(), 'ptu-mobile-audit-' + process.pid);
const SHOTS = '/tmp/ptu-audit-shots';

const TAP_MIN = 44;          // 建议的最小触控边长

// 路由清单：hash|动作…（动作语法与 cdp-verify 保持一致）
const ROUTES = [
  { name: 'home', hash: '', actions: [] },
  { name: 'book', hash: '#/book', actions: [['click', '#bkStart'], ['sleep', 4200]] },
  { name: 'wheel', hash: '#/wheel', actions: [['click', '#whHub'], ['sleep', 5600]] },
  { name: 'coin', hash: '#/coin', actions: [['click', '#cnFlip'], ['sleep', 3400]] },
  { name: 'dice', hash: '#/dice', actions: [['click', '#dcRoll'], ['sleep', 2600]] },
  { name: 'blindbox', hash: '#/blindbox', actions: [['click', '#bxDraw'], ['sleep', 1700]] },
  { name: 'reverse', hash: '#/reverse', actions: [['click', '#rvFlip'], ['sleep', 3400]], dismiss: true },
  { name: 'clock', hash: '#/clock', actions: [['click', '#ckStage'], ['sleep', 1200], ['click', '#ckStage'], ['sleep', 500]] },
  { name: 'notodo', hash: '#/notodo', actions: [['sleep', 1500]] }
];

// 小屏必须实测；中大屏只验证静态布局，控制总耗时
const VIEWPORTS = [
  { w: 320, h: 568, label: 'iPhone SE 1 (320×568)', deep: true },
  { w: 360, h: 640, label: '安卓小屏 (360×640)', deep: false },
  { w: 375, h: 667, label: 'iPhone SE 3 (375×667)', deep: true },
  { w: 390, h: 844, label: 'iPhone 14 (390×844)', deep: false },
  { w: 414, h: 896, label: 'iPhone 11 (414×896)', deep: false },
  { w: 430, h: 932, label: 'iPhone 15 Pro Max (430×932)', deep: true },
  { w: 740, h: 360, label: '横屏 (740×360)', deep: false },
  { w: 768, h: 1024, label: '平板 (768×1024)', deep: false }
];

fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--disable-gpu',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 未就绪 */ }
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      events,
      close() { ws.close(); }
    }));
    ws.addEventListener('error', reject);
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.method + ' ' + JSON.stringify(msg.error)));
        else res(msg.result);
        return;
      }
      if (msg.method) events.push(msg);
    });
  });
}

/* 在页面里执行的审计逻辑：返回溢出元素与偏小的触控目标 */
const AUDIT_EXPR = `(() => {
  const sel = (el) => {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && parts.length < 5) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(s + '#' + n.id); break; }
      const cls = (typeof n.className === 'string' ? n.className : '').trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join('>');
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const vw = window.innerWidth;
  const docW = document.documentElement.scrollWidth;
  const bodyW = document.body.scrollWidth;

  const overflow = [];
  if (docW > vw + 1 || bodyW > vw + 1) {
    document.querySelectorAll('body *').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') return;          // 固定元素不产生文档级滚动
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        overflow.push({ sel: sel(el), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) });
      }
    });
  }

  const small = [];
  document.querySelectorAll('a, button, .switch, .chip, .clock-opt, [role="button"], input:not([type=hidden])').forEach((el) => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < ${TAP_MIN} - 0.5 || r.width < 20) {
      small.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height), t: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 12) });
    }
  });

  return {
    vw, docW, bodyW,
    overflowCount: overflow.length,
    overflow: overflow.slice(0, 12),
    smallCount: small.length,
    small: small.slice(0, 12),
    hasHScroll: docW > vw + 1 || bodyW > vw + 1
  };
})()`;

(async function main() {
  const cdp = await connect(await waitForDevtools());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');

  async function evaluate(expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate 失败: ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }

  function drainErrors() {
    const found = [];
    for (const ev of cdp.events.splice(0, cdp.events.length)) {
      if (ev.method === 'Runtime.exceptionThrown') {
        const d = ev.params.exceptionDetails;
        found.push('异常: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
      } else if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
        found.push('console: ' + ev.params.args.map((a) => a.value || a.description || a.type).join(' '));
      } else if (ev.method === 'Log.entryAdded' && ev.params.entry.level === 'error') {
        found.push('log: ' + ev.params.entry.text);
      } else if (ev.method === 'Network.responseReceived' && ev.params.response.status >= 400) {
        found.push('HTTP ' + ev.params.response.status + ' ' + ev.params.response.url);
      }
    }
    return Array.from(new Set(found));
  }

  const failures = [];
  const tapProblems = new Map();   // sel → 出现次数（跨视口汇总，避免刷屏）

  for (const vp of VIEWPORTS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true
    });
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(vp.deep ? 1600 : 1000);
    drainErrors();

    console.log(`\n════ ${vp.label} ${vp.deep ? '（含交互深测）' : ''} ════`);

    for (const route of ROUTES) {
      // 已加载过页面，这里用 hash 切路由；首页需要重置一次
      if (route.hash) await evaluate(`location.hash = ${JSON.stringify(route.hash)}`);
      else await evaluate('location.hash = "#/"');
      await sleep(vp.deep ? 800 : 500);

      if (vp.deep) {
        for (const [kind, arg] of route.actions) {
          if (kind === 'click') await evaluate(`document.querySelector(${JSON.stringify(arg)})?.click()`);
          else if (kind === 'sleep') await sleep(arg);
        }
      } else if (route.actions.length) {
        // 浅测也要让页面完成渲染（比如 notodo 的自动抽取）
        await sleep(900);
      }

      const res = await evaluate(AUDIT_EXPR);
      const errs = drainErrors();
      const flag = (res.hasHScroll ? '✗' : '✓');
      const line = `  ${flag} ${route.name.padEnd(9)} 视口 ${res.vw}  文档 ${res.docW}  ` +
        `溢出 ${res.overflowCount}  小控件 ${res.smallCount}` +
        (errs.length ? `  报错 ${errs.length}` : '');
      console.log(line);

      if (res.hasHScroll) {
        failures.push({ vp: vp.label, route: route.name, type: '横向溢出', detail: res.overflow });
      }
      errs.forEach((e) => failures.push({ vp: vp.label, route: route.name, type: '运行时报错', detail: [e] }));
      res.small.forEach((s) => {
        const key = s.sel + '|' + s.h;
        tapProblems.set(key, (tapProblems.get(key) || 0) + 1);
      });

      if (route.dismiss) {
        // 关掉可能弹出的追问弹窗，避免影响后续路由
        await evaluate("document.querySelector('.modal-actions .btn')?.click()");
        await sleep(250);
      }

      if (vp.deep && (route.name === 'wheel' || route.name === 'notodo' || route.name === 'home')) {
        const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        fs.writeFileSync(path.join(SHOTS, `${vp.w}-${route.name}.png`), Buffer.from(r.data, 'base64'));
      }
    }
  }

  console.log('\n════════════ 结论 ════════════');

  if (!failures.length) {
    console.log('✓ 所有视口 × 路由组合均无横向溢出，也没有运行时报错。');
  } else {
    const overflowFails = failures.filter((f) => f.type === '横向溢出');
    const errorFails = failures.filter((f) => f.type === '运行时报错');
    if (overflowFails.length) {
      console.log(`✗ 横向溢出 ${overflowFails.length} 处：`);
      overflowFails.forEach((f) => {
        console.log(`  · [${f.vp} / ${f.route}]`);
        f.detail.slice(0, 6).forEach((d) => console.log(`      ${d.sel}  left=${d.l} right=${d.r} w=${d.w}`));
      });
    }
    if (errorFails.length) {
      console.log(`✗ 运行时报错 ${errorFails.length} 处：`);
      errorFails.slice(0, 10).forEach((f) => console.log(`  · [${f.vp} / ${f.route}] ${f.detail[0]}`));
    }
  }

  if (tapProblems.size) {
    console.log(`\n! 触控目标小于 ${TAP_MIN}px 的元素（按出现频次排序）：`);
    [...tapProblems.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .forEach(([key, n]) => {
        const [sel, h] = key.split('|');
        console.log(`  · ${sel}  高 ${h}px  ×${n}`);
      });
  } else {
    console.log(`\n✓ 未发现小于 ${TAP_MIN}px 的触控目标。`);
  }

  console.log('\n截图目录: ' + SHOTS);
  cdp.close();
  chrome.kill();
  setTimeout(() => {
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }, 300);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('审计失败: ' + e.message);
  chrome.kill();
  process.exit(2);
});
