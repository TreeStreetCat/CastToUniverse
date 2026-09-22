#!/usr/bin/env node
/* 「抛给宇宙」自检脚本：用本机 Chrome 的 DevTools 协议逐页走查
   1. 打开每个路由，收集 console 报错 / 未捕获异常 / 404
   2. 触发关键交互（翻书、转盘、抛硬币、抽签、打卡等）
   3. 逐页截图，输出到 /tmp/ptu-shots/
   用法：node tools/smoke-test.js [baseUrl] */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const BASE = process.argv[2] || 'http://127.0.0.1:5173';
const SHOTS = '/tmp/ptu-shots';
const PROFILE = '/tmp/ptu-cdp-profile';

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
  '--window-size=430,932',
  'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('DevTools 未就绪');
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

(async function main() {
  const wsUrl = await waitForDevtools();
  const cdp = await connect(wsUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true
  });

  const problems = [];

  function drainEvents(label) {
    const found = [];
    for (const ev of cdp.events.splice(0, cdp.events.length)) {
      if (ev.method === 'Runtime.exceptionThrown') {
        const d = ev.params.exceptionDetails;
        found.push('异常: ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
      } else if (ev.method === 'Runtime.consoleAPICalled' && (ev.params.type === 'error' || ev.params.type === 'warning')) {
        found.push(ev.params.type + ': ' + ev.params.args.map((a) => a.value || a.description || a.type).join(' '));
      } else if (ev.method === 'Log.entryAdded') {
        const e = ev.params.entry;
        if (e.level === 'error' || (e.level === 'warning' && /404|Failed/.test(e.text || ''))) {
          found.push('log[' + e.level + ']: ' + e.text + (e.url ? ' @ ' + e.url : ''));
        }
      } else if (ev.method === 'Network.loadingFailed' && !/ERR_ABORTED/.test(ev.params.errorText || '')) {
        found.push('网络失败: ' + ev.params.errorText);
      } else if (ev.method === 'Network.responseReceived') {
        const r = ev.params.response;
        if (r.status >= 400) found.push('HTTP ' + r.status + ' ' + r.url);
      }
    }
    if (found.length) problems.push({ label, found: Array.from(new Set(found)) });
    return found;
  }

  async function evaluate(expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate 失败: ' + JSON.stringify(r.exceptionDetails.exception));
    return r.result.value;
  }

  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  }

  const steps = [
    { hash: '', name: '01-home', wait: 1200, full: true },    { hash: '#/book', name: '02-book-idle', wait: 900 },
    { hash: '#/book', name: '03-book-open', wait: 500, actions: [['click', '#bkStart'], ['sleep', 4600]] },
    { hash: '#/wheel', name: '04-wheel-idle', wait: 1000 },
    { hash: '#/wheel', name: '05-wheel-spun', wait: 300, actions: [['click', '#whHub'], ['sleep', 5600]] },
    { hash: '#/coin', name: '06-coin', wait: 900, actions: [['click', '#cnFlip'], ['sleep', 3400]] },
    { hash: '#/dice', name: '07-dice', wait: 900, actions: [['click', '#dcRoll'], ['sleep', 2600]] },
    { hash: '#/blindbox', name: '08-blindbox', wait: 900, actions: [['click', '#bxDraw'], ['sleep', 1700]] },
    { hash: '#/reverse', name: '09-reverse-flip', wait: 800, actions: [['click', '#rvFlip'], ['sleep', 3600]] },
    { hash: '#/reverse', name: '10-reverse-answer', wait: 200, actions: [['click', '.modal-actions .btn:nth-child(2)'], ['sleep', 900]] },
    { hash: '#/clock', name: '11-clock-running', wait: 800, actions: [['click', '#ckStage'], ['sleep', 1600]] },
    { hash: '#/clock', name: '12-clock-stopped', wait: 200, actions: [['click', '#ckStage'], ['sleep', 600]] },
    { hash: '#/notodo', name: '13-notodo', wait: 1600, full: true }
  ];

  // 先真正导航到站点，之后用改 hash 的方式在各路由间切换
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(1800);
  const title = await evaluate('document.title');
  console.log('已加载: ' + title + '  (' + BASE + ')');

  for (const step of steps) {
    await evaluate(`location.hash = ${JSON.stringify(step.hash)}`);
    await sleep(step.wait);
    for (const [kind, arg] of step.actions || []) {
      if (kind === 'click') await evaluate(`document.querySelector(${JSON.stringify(arg)})?.click()`);
      if (kind === 'sleep') await sleep(arg);
    }
    const found = drainEvents(step.name);
    const visible = await evaluate(`document.querySelector('.view')?.innerText.slice(0, 80).replace(/\\n/g,' | ') || ''`);
    console.log(`\n[${step.name}] ${found.length ? '⚠ ' + found.length + ' 条问题' : '✓ 无报错'}`);
    console.log('   页面文本: ' + visible);
    if (step.full) await shot(step.name);
    else await shot(step.name);
  }

  console.log('\n================ 汇总 ================');
  if (!problems.length) {
    console.log('全部 ' + steps.length + ' 步均无控制台错误 / 资源失败。');
  } else {
    problems.forEach((p) => {
      console.log('\n[' + p.label + ']');
      p.found.forEach((f) => console.log('  - ' + f));
    });
  }

  cdp.close();
  chrome.kill();
  console.log('\n截图目录: ' + SHOTS);
  process.exit(problems.length ? 1 : 0);
})().catch(async (e) => {
  console.error('自检脚本失败:', e.message);
  chrome.kill();
  process.exit(1);
});
