/* =========================================================================
   抛给宇宙 · 随机决策工具箱
   app.js —— 内核层：随机数、本地存储、音效、震动、提示、弹窗、路由、首页
   说明：本文件不依赖任何第三方库。音效由 Web Audio 实时合成，无需音频资源文件，
        因此整站可以完全离线运行。
   ========================================================================= */
(function () {
  'use strict';

  const App = (window.App = { version: '1.2.0' });

  /* =======================================================================
     0. 品牌信息集中一处
     改名 / 换标语时，只需改这里 + index.html + manifest.json 三处，
     不必再在 8 个模块文件里逐个替换散落的字面量。
     ======================================================================= */
  const BRAND = {
    name: '抛给宇宙',
    tagline: '随机决策工具箱',
    /** 分享面板标题：模块名为空时退回「品牌 · 标语」 */
    title(mod) {
      return mod ? BRAND.name + ' · ' + mod : BRAND.name + ' · ' + BRAND.tagline;
    },
    /** 分享正文的统一前缀，形如「抛给宇宙」答案之书： */
    quote(mod, text) {
      return '「' + BRAND.name + '」' + (mod ? mod + '：' : '') + text;
    },
    /** 去掉标题里的品牌前缀，用于图片卡片上的小字 */
    strip(name) {
      return String(name || '').replace(new RegExp('^' + BRAND.name + '\\s*·\\s*'), '');
    }
  };
  App.BRAND = BRAND;

  /* =======================================================================
     1. 高质量随机
     crypto.getRandomValues() 优先，不可用时降级到 Math.random()
     ======================================================================= */
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
  const cryptoBuf = hasCrypto ? new Uint32Array(1) : null;

  /** 返回 [0, 1) 之间的随机浮点数 */
  function rand() {
    if (hasCrypto) {
      crypto.getRandomValues(cryptoBuf);
      return cryptoBuf[0] / 4294967296;
    }
    return Math.random();
  }

  /** 返回 [0, n) 之间的随机整数 */
  function randInt(n) {
    return Math.floor(rand() * n);
  }

  /** 返回 [min, max] 闭区间随机整数 */
  function randRange(min, max) {
    return min + randInt(max - min + 1);
  }

  /** 从数组中随机取一项 */
  function pick(arr) {
    return arr[randInt(arr.length)];
  }

  /** 按相对权重挑选下标；权重全为 0 时退化为等概率 */
  function weightedIndex(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, Number(weights[i]) || 0);
    if (total <= 0) return randInt(weights.length);
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, Number(weights[i]) || 0);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher-Yates 洗牌，返回新数组，不修改入参 */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** 生成短唯一 id */
  let uidSeq = 0;
  function uid(prefix) {
    uidSeq += 1;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + uidSeq;
  }

  /** 本地日期键，形如 2026-09-22（按用户所在时区，不依赖 UTC） */
  function todayKey(d) {
    const t = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
  }

  App.rand = rand;
  App.randInt = randInt;
  App.randRange = randRange;
  App.pick = pick;
  App.weightedIndex = weightedIndex;
  App.shuffle = shuffle;
  App.uid = uid;
  App.todayKey = todayKey;

  /* =======================================================================
     2. 本地存储（统一前缀 + 容错，隐私模式下也不会抛错）
     ======================================================================= */
  const PREFIX = 'ptu:';
  const storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(PREFIX + key);
      } catch (e) { /* 忽略 */ }
    }
  };
  App.storage = storage;

  /* =======================================================================
     3. 音效（Web Audio 实时合成，零资源文件）
     首次用户交互时解锁 AudioContext，符合移动端自动播放策略。
     ======================================================================= */
  const Sfx = (function () {
    let ctx = null;
    let noiseBuf = null;
    let enabled = storage.get('sfx', true) !== false;

    function audio() {
      if (!enabled) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    function noise(c) {
      if (!noiseBuf) {
        const len = Math.floor(c.sampleRate * 0.4);
        noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      return src;
    }

    /** 一段带指数衰减的音 */
    function tone(opt) {
      const c = audio();
      if (!c) return;
      const t0 = c.currentTime + (opt.delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = opt.type || 'sine';
      osc.frequency.setValueAtTime(opt.freq, t0);
      if (opt.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.freqTo), t0 + opt.dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(opt.gain || 0.06, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + opt.dur + 0.02);
    }

    /** 一段带滤波的噪声（用于“摇一摇 / 呼啦”类音效） */
    function swish(opt) {
      const c = audio();
      if (!c) return;
      const t0 = c.currentTime + (opt.delay || 0);
      const src = noise(c);
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = opt.q || 1.2;
      filter.frequency.setValueAtTime(opt.freq, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(60, opt.freqTo || opt.freq * 2), t0 + opt.dur);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(opt.gain || 0.09, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opt.dur);
      src.connect(filter).connect(gain).connect(c.destination);
      src.start(t0);
      src.stop(t0 + opt.dur + 0.02);
    }

    return {
      isEnabled: () => enabled,
      setEnabled(v) {
        enabled = !!v;
        storage.set('sfx', enabled);
        if (enabled) this.unlock();
      },
      /** 在用户首个手势里调用，避免 iOS 静音 */
      unlock() { audio(); },

      /* 以下为具体音色 ------------------------------------------------ */
      /** 转盘 / 倒计时经过一个刻度 */
      tick() { tone({ freq: 1750, freqTo: 1200, dur: 0.03, type: 'square', gain: 0.035 }); },
      /** 普通按钮点击 */
      click() { tone({ freq: 660, freqTo: 880, dur: 0.05, type: 'triangle', gain: 0.045 }); },
      /** 抛出动作的“咻” */
      whoosh() { swish({ freq: 320, freqTo: 1400, dur: 0.34, gain: 0.06 }); },
      /** 盲盒 / 抽签筒摇晃 */
      shake() {
        swish({ freq: 900, freqTo: 500, dur: 0.12, gain: 0.07, q: 0.9 });
        swish({ freq: 700, freqTo: 420, dur: 0.12, gain: 0.06, q: 0.9, delay: 0.12 });
      },
      /** 揭晓答案的清脆铃声 */
      ding() {
        tone({ freq: 880, dur: 0.5, type: 'sine', gain: 0.07 });
        tone({ freq: 1320, dur: 0.42, type: 'sine', gain: 0.045, delay: 0.05 });
        tone({ freq: 1760, dur: 0.3, type: 'sine', gain: 0.028, delay: 0.1 });
      },
      /** 结果弹出 */
      pop() { tone({ freq: 300, freqTo: 900, dur: 0.14, type: 'sine', gain: 0.07 }); },
      /** 出错 / 被拒绝 */
      warn() { tone({ freq: 220, freqTo: 150, dur: 0.22, type: 'sawtooth', gain: 0.045 }); }
    };
  })();
  App.sfx = Sfx;

  // 首个手势解锁音频与震动（移动端必需），之后自动移除监听
  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, function onFirst() {
      Sfx.unlock();
      Haptic.arm();
      ['pointerdown', 'keydown', 'touchstart'].forEach((e2) => window.removeEventListener(e2, onFirst));
    }, { passive: true, once: false });
  });

  /* =======================================================================
     4. 震动反馈（能力检测 + 降级；iOS Safari 不支持时静默忽略）
     ======================================================================= */
  const Haptic = {
    supported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
    /**
     * 真实用户手势之前不发震动：部分浏览器（Chrome / iOS Safari）要求
     * 「粘性用户激活」，否则每次调用都会在控制台抛一条 Blocked 错误。
     * 这里主动拦住，让降级路径干净无噪音。
     */
    armed: false,
    arm() { this.armed = true; },
    run(pattern) {
      if (!this.supported || !this.armed) return false;
      try { navigator.vibrate(pattern); return true; } catch (e) { return false; }
    },
    /** 轻微点按 */
    tap() { this.run(8); },
    /** 结果落定 */
    land() { this.run([18, 40, 26]); },
    /** 连续抖动（摇签筒） */
    shake() { this.run([12, 30, 12, 30, 12]); },
    /** 长震（禁止/否决） */
    buzz() { this.run(160); }
  };
  App.haptic = Haptic;

  /* =======================================================================
     5. DOM 小工具
     ======================================================================= */
  /** 转义 HTML，所有用户输入回显前都要过一遍 */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 由 HTML 字符串生成元素（单根节点） */
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  /** 等待 ms 毫秒 */
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* =======================================================================
     带缓存的 JSON 加载。文件协议（file://）或离线时自动回退到内置数据，
     保证任何一个工具在无网络时都可用。

     兜底策略（重要）：兜底是「软」的，不是一次失败就终身兜底。
     - 这一次仍然立刻返回内置数据，用户不会被卡住；
     - 但会把该地址标记为 fallback 并记录时间，冷却期（60s）过后下次再进模块时
       会重新尝试真实数据，网络恢复后自动回到完整题库；
     - 同时给 fetch 加了 8 秒超时，避免弱网下无限挂起。
     ======================================================================= */
  const DATA_RETRY_MS = 60 * 1000;
  const DATA_TIMEOUT_MS = 8000;
  const dataCache = {};
  const dataOrigin = {};      // 'network' | 'fallback'
  const dataFallbackAt = {};

  async function loadData(url, fallback) {
    if (dataCache[url]) {
      const stale = dataOrigin[url] === 'fallback' && (Date.now() - (dataFallbackAt[url] || 0)) < DATA_RETRY_MS;
      if (!stale) return dataCache[url];   // 冷却期内直接复用，过期则往下重试网络
    }

    let ctrl = null;
    let timer = null;
    if (typeof AbortController === 'function') {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), DATA_TIMEOUT_MS);
    }
    try {
      const res = await fetch(url, { cache: 'force-cache', signal: ctrl ? ctrl.signal : undefined });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      dataCache[url] = json;
      dataOrigin[url] = 'network';
      return json;
    } catch (e) {
      console.warn('[' + BRAND.name + '] 数据加载失败，本次使用内置兜底数据：' + url, e);
      if (dataOrigin[url] !== 'fallback') dataFallbackAt[url] = Date.now();
      dataCache[url] = fallback;
      dataOrigin[url] = 'fallback';
      return fallback;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  App.esc = esc;
  App.el = el;
  App.wait = wait;
  App.loadData = loadData;

  /* =======================================================================
     5.5 可选增强：结果庆祝（canvas-confetti）
     插件通过 index.html 的 <script defer> 引入（vendor/canvas-confetti.min.js，MIT）。
     未加载成功，或系统开启「减弱动态效果」时静默跳过——它只是锦上添花，不承担任何功能。
     ======================================================================= */
  const prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* 粒子颜色改为从 CSS 变量读取：换肤时自动跟随，不再写死一组颜色。
     读取失败（老浏览器）时退回当前这套霓虹默认值。 */
  function themeColors() {
    const css = window.getComputedStyle ? getComputedStyle(document.documentElement) : null;
    const read = (name, dft) => {
      if (!css) return dft;
      const v = (css.getPropertyValue(name) || '').trim();
      return v || dft;
    };
    return [
      read('--violet', '#8b5cf6'),
      read('--cyan', '#22e1ff'),
      read('--magenta', '#ff3ea5'),
      read('--amber', '#ffb020'),
      read('--lime', '#b6ff3b')
    ];
  }

  /* 按需加载：插件不再随首屏一起下载，第一次真的要放彩带时才注入。
     它已被 Service Worker 预缓存，所以离线场景下依旧可用；
     加载失败只是没有彩带，不影响任何功能。 */
  let confettiTask = null;
  function loadConfetti() {
    if (typeof window.confetti === 'function') return Promise.resolve(true);
    if (confettiTask) return confettiTask;
    confettiTask = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'vendor/canvas-confetti.min.js';
      s.async = true;
      s.onload = () => resolve(typeof window.confetti === 'function');
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return confettiTask;
  }

  function celebrate(opt) {
    if (prefersReducedMotion) return false;
    const o = opt || {};
    loadConfetti().then((ok) => {
      if (!ok || typeof window.confetti !== 'function') return;
      window.confetti({
        particleCount: o.particleCount || 70,
        spread: o.spread || 72,
        startVelocity: o.startVelocity || 34,
        gravity: 0.9,
        scalar: o.scalar || 0.9,
        ticks: 190,
        angle: o.angle || 90,
        origin: o.origin || { x: 0.5, y: 0.62 },
        colors: themeColors(),
        disableForReducedMotion: true
      });
    });
    return true;
  }

  /* =======================================================================
     5.6 结果带走：复制 / 系统分享
     ======================================================================= */
  const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M6.5 15h-1A1.5 1.5 0 0 1 4 13.5v-8A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v1"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4"/><path d="M8.5 7.5 12 4l3.5 3.5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>';

  /** 复制文本；剪贴板 API 不可用（非安全上下文 / 权限被拒）时退化为手动复制弹窗 */
  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return 'copied';
      }
    } catch (e) { /* 落到手动复制 */ }
    await modal({
      title: '手动复制结果',
      html: '<p class="panel-hint" style="margin-bottom:8px">当前环境无法自动复制，请长按下面的文字复制：</p>' +
            '<p class="reverse-quote" style="font-size:17px">' + esc(text) + '</p>',
      buttons: [{ label: '知道了', value: 'ok' }]
    });
    return 'manual';
  }

  /** 优先调用系统分享面板（移动端原生体验），不支持则退化为复制 */
  async function shareText(text, title) {
    if (navigator.share) {
      try {
        await navigator.share({ title: title || BRAND.title(), text: text });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
      }
    }
    return copyText(text);
  }

  /* =======================================================================
     5.7 结果带走 · 图片卡片
     文字复制之外再给一条「存成图」的路：用 Canvas 现画一张卡片，
     能系统分享就分享文件（部分浏览器支持分享图片），不支持就退化为下载。
     全程本地完成，不上传任何数据。
     ======================================================================= */
  const ICON_IMAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="8.6" cy="9.6" r="1.7"/><path d="M4.6 17.6 9.6 12.6l3.4 3.4 3-2.6 3.8 4.2"/></svg>';

  /** 从分享正文里剥掉品牌装饰，拆出「模块名 + 结果值」供卡片使用 */
  function cardParts(text) {
    let t = String(text || '').trim();
    t = t.replace(new RegExp('^「' + BRAND.name + '」'), '');
    t = t.replace(new RegExp('　?——\\s*来自「' + BRAND.name + '」$'), '');
    const m = t.match(/^(.+?)[：:]([\s\S]+)$/);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: t };
  }

  /** 按最大宽度折行（中文按字断行，不依赖 CSS） */
  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || '').split('');
    const out = [];
    let line = '';
    for (let i = 0; i < chars.length; i++) {
      const next = line + chars[i];
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = chars[i];
      } else {
        line = next;
      }
    }
    if (line) out.push(line);
    return out;
  }

  /** 结果卡片：纯 Canvas 绘制，不引任何库 */
  function resultCard(opt) {
    const o = opt || {};
    const W = 1000;
    const H = 1000;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;

    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0b16');
    bg.addColorStop(1, '#171738');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    const glow = g.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, W * 0.62);
    glow.addColorStop(0, 'rgba(139,92,246,0.42)');
    glow.addColorStop(1, 'rgba(139,92,246,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 3;
    g.strokeRect(28, 28, W - 56, H - 56);

    g.textAlign = 'left';
    g.fillStyle = '#22e1ff';
    g.font = '700 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(BRAND.name, 72, 126);
    g.fillStyle = 'rgba(185,192,230,0.72)';
    g.font = '400 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(BRAND.tagline, 72, 164);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(185,192,230,0.85)';
    g.font = '500 28px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText(BRAND.strip(o.label || o.title || ''), W / 2, 340);

    // 结果大字：先按 92px 排版，超过 4 行就自动缩字号，长文本也不会溢出卡片
    const value = String(o.value || '').trim() || '—';
    const maxW = W - 160;
    let fs = 92;
    g.font = '700 ' + fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    let lines = wrapText(g, value, maxW);
    while (lines.length > 4 && fs > 40) {
      fs -= 6;
      g.font = '700 ' + fs + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      lines = wrapText(g, value, maxW);
    }
    g.fillStyle = '#eef0ff';
    const lineH = Math.round(fs * 1.34);
    const startY = H * 0.52 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((ln, i) => g.fillText(ln, W / 2, startY + i * lineH));

    g.fillStyle = 'rgba(125,133,174,0.95)';
    g.font = '400 24px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillText('密码学级随机 · 数据仅存本地 · ' + todayKey(), W / 2, H - 96);

    return c;
  }

  /**
   * 导出结果图片：能分享就分享文件，否则下载。
   * 返回 'shared' | 'saved' | 'cancel' | 'fail'
   */
  async function shareImage(opt) {
    const o = opt || {};
    const canvas = resultCard(o);
    if (!canvas || typeof canvas.toBlob !== 'function') return 'fail';

    const blob = await new Promise((resolve) => {
      try { canvas.toBlob(resolve, 'image/png'); } catch (e) { resolve(null); }
    });
    if (!blob) return 'fail';

    const fileName = (BRAND.name + '-' + (BRAND.strip(o.title || '') || o.label || '结果'))
      .replace(/[\\/:*?"<>|\s]+/g, '-') + '.png';

    let file = blob;
    try {
      if (typeof File === 'function') file = new File([blob], fileName, { type: 'image/png' });
    } catch (e) { /* 老浏览器没有 File 构造器，直接用 blob 分享 */ }

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: o.title || BRAND.title(), text: o.text || '' });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancel';
        // 分享被拒不放弃，继续走下载，至少让用户拿到图
      }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return 'saved';
    } catch (e) {
      return 'fail';
    }
  }

  /**
   * 生成「复制结果 / 分享 / 存为图片」操作行。
   * getText 是函数而不是字符串：点击时才取当前结果，切换结果不需要重新绑定事件。
   */
  function shareRow(getText, opt) {
    const o = opt || {};
    const row = el('<div class="result-actions"></div>');

    const copyBtn = el('<button type="button" class="btn btn-ghost">' + ICON_COPY + '复制结果</button>');
    copyBtn.addEventListener('click', async () => {
      Sfx.click();
      Haptic.tap();
      const r = await copyText(getText());
      toast(r === 'copied' ? '已复制到剪贴板' : '可长按文字手动复制');
    });
    row.appendChild(copyBtn);

    if (navigator.share) {
      const shareBtn = el('<button type="button" class="btn btn-ghost">' + ICON_SHARE + '分享</button>');
      shareBtn.addEventListener('click', async () => {
        Sfx.click();
        Haptic.tap();
        const r = await shareText(getText(), o.title);
        if (r === 'copied') toast('已复制到剪贴板');
      });
      row.appendChild(shareBtn);
    }

    // 存为图片：从当前结果文本里拆出「模块名 + 结果」，画成卡片后分享或下载
    const imgBtn = el('<button type="button" class="btn btn-ghost">' + ICON_IMAGE + '存为图片</button>');
    imgBtn.addEventListener('click', async () => {
      Sfx.click();
      Haptic.tap();
      const parts = cardParts(getText());
      const r = await shareImage({
        title: o.title,
        label: parts.label,
        value: parts.value,
        text: getText()
      });
      if (r === 'shared') toast('已调起系统分享');
      else if (r === 'saved') toast('图片已保存到下载');
      else if (r === 'fail') toast('当前环境不支持导出图片');
    });
    row.appendChild(imgBtn);

    return row;
  }

  App.prefersReducedMotion = prefersReducedMotion;
  App.celebrate = celebrate;
  App.copyText = copyText;
  App.shareText = shareText;
  App.shareRow = shareRow;
  App.shareImage = shareImage;
  App.resultCard = resultCard;
  App.cardParts = cardParts;
  App.themeColors = themeColors;

  /* =======================================================================
     6. 全局提示 Toast
     ======================================================================= */
  let toastTimer = null;
  function toast(message, ms) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-on'), ms || 1800);
  }
  App.toast = toast;

  /* =======================================================================
     7. 弹窗（Promise 化，供「假装硬币」等模块使用）
     modal({ title, text, html, buttons:[{label,value,kind}], dismissible })
     返回：被点击按钮的 value，或用户关闭时的 null
     ======================================================================= */
  function modal(options) {
    const opt = options || {};
    const buttons = opt.buttons || [{ label: '知道了', value: 'ok', kind: 'primary' }];
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      const backdrop = el(
        '<div class="modal-backdrop">' +
          '<div class="modal-card" role="dialog" aria-modal="true">' +
            (opt.icon ? '<div class="modal-icon">' + opt.icon + '</div>' : '') +
            (opt.title ? '<h3 class="modal-title">' + esc(opt.title) + '</h3>' : '') +
            (opt.text ? '<p class="modal-text">' + esc(opt.text) + '</p>' : '') +
            (opt.html ? '<div class="modal-body">' + opt.html + '</div>' : '') +
            '<div class="modal-actions"></div>' +
          '</div>' +
        '</div>'
      );

      const actions = backdrop.querySelector('.modal-actions');
      let done = false;

      function close(value) {
        if (done) return;
        done = true;
        backdrop.classList.add('is-closing');
        setTimeout(() => backdrop.remove(), 180);
        document.removeEventListener('keydown', onKey);
        if (before && typeof before.focus === 'function') {
          try { before.focus(); } catch (e) { /* 元素可能已被移除 */ }
        }
        resolve(value);
      }

      // 焦点陷阱：Tab / Shift+Tab 只在弹窗内循环，关闭后把焦点还给触发它的元素，
      // 避免键盘用户「跳到」弹窗背后的页面上操作看不见的控件。
      const before = document.activeElement;
      function focusables() {
        return Array.prototype.slice
          .call(backdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((n) => !n.disabled && n.offsetParent !== null);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          close(null);
          return;
        }
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }

      buttons.forEach((b) => {
        const btn = el(
          '<button type="button" class="btn ' + (b.kind === 'ghost' ? 'btn-ghost' : 'btn-primary') + '">' +
            esc(b.label) +
          '</button>'
        );
        btn.addEventListener('click', () => {
          Sfx.click();
          Haptic.tap();
          close(b.value);
        });
        actions.appendChild(btn);
      });

      if (opt.dismissible !== false) {
        backdrop.addEventListener('click', (e) => {
          if (e.target === backdrop) close(null);
        });
        document.addEventListener('keydown', onKey);
      }

      root.appendChild(backdrop);
      requestAnimationFrame(() => backdrop.classList.add('is-on'));
      const first = actions.querySelector('button');
      if (first) first.focus();
    });
  }
  App.modal = modal;

  /* =======================================================================
     8. 模块注册表
     ======================================================================= */
  const modules = {};
  const moduleOrder = [];

  App.register = function (mod) {
    if (!mod || !mod.id || typeof mod.render !== 'function') {
      console.warn('[' + BRAND.name + '] 模块注册失败', mod);
      return;
    }
    modules[mod.id] = mod;
    moduleOrder.push(mod.id);
  };

  App.getModules = function (groupId) {
    return moduleOrder
      .map((id) => modules[id])
      .filter((m) => !groupId || m.group === groupId);
  };

  App.getGroups = function () {
    const groups = [];
    moduleOrder.forEach((id) => {
      const m = modules[id];
      if (!m.group) return;
      let g = groups.find((x) => x.name === m.group);
      if (!g) { g = { name: m.group, items: [] }; groups.push(g); }
      g.items.push(m);
    });
    return groups;
  };

  /* =======================================================================
     9. 顶部栏 / 底部 Tab / 路由
     ======================================================================= */
  const TABS = [
    { id: 'home', label: '首页', hash: '#/', icon: '<path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>' },
    { id: 'book', label: '答案', hash: '#/book', icon: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M8.5 7.5h6.5M8.5 11h4"/>' },
    { id: 'wheel', label: '转盘', hash: '#/wheel', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.5l6.4 4.9"/>' },
    { id: 'blindbox', label: '抽签', hash: '#/blindbox', icon: '<path d="M3.6 8.6 12 4.2l8.4 4.4v6.8L12 19.8l-8.4-4.4z"/><path d="M3.6 8.6 12 13l8.4-4.4M12 13v6.8"/>' },
    { id: 'notodo', label: '禁止', hash: '#/notodo', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M6.6 17.4 17.4 6.6"/>' }
  ];

  let cleanup = null;          // 当前模块的清理函数
  let currentId = null;

  /* =======================================================================
     8.5 PWA 安装引导
     浏览器把 beforeinstallprompt 事件暂存下来，等用户主动点「安装」时才弹原生面板；
     已安装（standalone 模式）或浏览器不支持时入口自动隐藏，不做无谓打扰。
     ======================================================================= */
  const ICON_INSTALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11"/><path d="M8 10.5 12 14.5l4-4"/><path d="M4 18.5h16"/></svg>';
  let deferredPrompt = null;

  function isInstalled() {
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  async function onInstallClick() {
    if (!deferredPrompt) return;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = true;
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      toast(choice && choice.outcome === 'accepted' ? '正在添加到桌面' : '已取消，随时可以再来');
    } catch (e) {
      toast('安装未完成，可稍后再试');
    }
  }

  function paintInstallButton() {
    const btn = document.getElementById('installBtn');
    if (!btn) return;
    const show = !!deferredPrompt && !isInstalled();
    btn.hidden = !show;
    if (!show) return;
    btn.innerHTML = ICON_INSTALL;
    btn.title = '把「' + BRAND.name + '」装到桌面';
    btn.setAttribute('aria-label', '安装到桌面');
    btn.addEventListener('click', onInstallClick);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    paintInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    paintInstallButton();
    toast('已添加到桌面，下次从图标进入');
  });

  /* =======================================================================
     8.6 最近使用
     底部 Tab 只放得下 5 个高频入口，其余工具靠首页卡片进入；
     这里记下最近用过的几个并在首页置顶，减少每次都要翻遍首页的成本。
     ======================================================================= */
  const RECENT_MAX = 4;

  function noteVisit(id) {
    if (!id || id === 'home') return;
    const list = storage.get('recent', []).filter((x) => x !== id);
    list.unshift(id);
    storage.set('recent', list.slice(0, RECENT_MAX));
  }

  App.getRecent = function () {
    return storage
      .get('recent', [])
      .map((id) => modules[id])
      .filter(Boolean);
  };

  function renderTabbar() {
    const bar = document.getElementById('tabbar');
    bar.innerHTML = '';
    TABS.forEach((t) => {
      const a = el(
        '<a class="tab" href="' + t.hash + '" data-id="' + t.id + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' + t.icon + '</svg>' +
          '<span>' + esc(t.label) + '</span>' +
        '</a>'
      );
      bar.appendChild(a);
    });
  }

  function setActiveTab(id) {
    document.querySelectorAll('.tab').forEach((a) => {
      a.classList.toggle('is-active', a.dataset.id === id);
    });
  }

  function renderTopbar(mod) {
    const bar = document.getElementById('topbar');
    if (!mod) {
      bar.innerHTML =
        '<div class="topbar-inner topbar-home">' +
          '<div class="brand">' +
            '<span class="brand-mark">抛</span>' +
            '<span class="brand-text">' + esc(BRAND.name) + '<small>' + esc(BRAND.tagline) + '</small></span>' +
          '</div>' +
          '<button type="button" class="icon-btn" id="installBtn" aria-label="安装到桌面" hidden></button>' +
          '<button type="button" class="icon-btn" id="sfxBtn" aria-label="音效开关"></button>' +
        '</div>';
    } else {
      bar.innerHTML =
        '<div class="topbar-inner">' +
          '<button type="button" class="icon-btn" id="backBtn" aria-label="返回首页">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
          '</button>' +
          '<div class="topbar-title">' +
            '<h1>' + esc(mod.name) + '</h1>' +
            (mod.tagline ? '<p>' + esc(mod.tagline) + '</p>' : '') +
          '</div>' +
          '<button type="button" class="icon-btn" id="installBtn" aria-label="安装到桌面" hidden></button>' +
          '<button type="button" class="icon-btn" id="sfxBtn" aria-label="音效开关"></button>' +
        '</div>';
    }

    paintInstallButton();

    const back = document.getElementById('backBtn');
    if (back) {
      back.addEventListener('click', () => {
        Sfx.click();
        location.hash = '#/';
      });
    }

    const sfxBtn = document.getElementById('sfxBtn');
    paintSfxButton(sfxBtn);
    sfxBtn.addEventListener('click', () => {
      const next = !Sfx.isEnabled();
      Sfx.setEnabled(next);
      paintSfxButton(sfxBtn);
      toast(next ? '音效已开启' : '音效已关闭');
    });
  }

  function paintSfxButton(btn) {
    const on = Sfx.isEnabled();
    btn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.4 6.6a7.5 7.5 0 0 1 0 10.8"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z"/><path d="M16 9.6l4 4.8M20 9.6l-4 4.8"/></svg>';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? '音效：开' : '音效：关';
  }

  /** 首页：分组卡片网格 */
  function renderHome(root) {
    const groups = App.getGroups();
    const wrap = el(
      '<div class="page page-home">' +
        '<section class="hero">' +
          '<p class="hero-kicker">选择困难专用</p>' +
          '<h2 class="hero-title">别纠结了，<br /><em>' + esc(BRAND.name) + '</em>。</h2>' +
          '<p class="hero-sub">八个工具，覆盖从“吃什么”到“今天什么事别干”的全部犹豫。<br />把选择抛出去，把自己还给自己。</p>' +
        '</section>' +
        '<div class="home-groups"></div>' +
        '<p class="home-foot">所有结果均由密码学级随机数生成 · 数据仅存本地</p>' +
      '</div>'
    );

    const box = wrap.querySelector('.home-groups');

    // 最近使用：置顶一排快捷入口，省去每次都要翻完整张工具清单
    const recent = App.getRecent();
    if (recent.length) {
      const sec = el('<section class="group"><h3 class="group-title">最近使用</h3><div class="recent-row"></div></section>');
      const row = sec.querySelector('.recent-row');
      recent.forEach((m) => {
        row.appendChild(el('<a class="chip recent-chip" href="#/' + esc(m.id) + '">' + esc(m.name) + '</a>'));
      });
      box.appendChild(sec);
    }

    groups.forEach((g) => {
      const section = el('<section class="group"><h3 class="group-title">' + esc(g.name) + '</h3><div class="card-grid"></div></section>');
      const grid = section.querySelector('.card-grid');
      g.items.forEach((m) => {
        const card = el(
          '<a class="tool-card accent-' + esc(m.accent || 'violet') + '" href="#/' + esc(m.id) + '">' +
            '<span class="tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true">' + m.icon + '</svg></span>' +
            '<span class="tool-name">' + esc(m.name) + '</span>' +
            '<span class="tool-desc">' + esc(m.desc || m.tagline || '') + '</span>' +
            (m.badge ? '<span class="tool-badge">' + esc(m.badge) + '</span>' : '') +
          '</a>'
        );
        grid.appendChild(card);
      });
      box.appendChild(section);
    });

    root.appendChild(wrap);
  }

  function currentRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    if (!raw || raw === 'home') return 'home';
    return modules[raw] ? raw : 'home';
  }

  function route() {
    const id = currentRoute();
    if (id === currentId && id !== 'home') {
      // 同一路由重复点击：回到顶部即可
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (e) { console.warn(e); }
      cleanup = null;
    }
    currentId = id;

    // 页面切换：优先用原生 View Transitions（浏览器自带的转场能力），
    // 不支持的浏览器回退到 CSS 的 page-enter 动画，功能完全一致。
    const useViewTransition = !!document.startViewTransition && !prefersReducedMotion;

    const swap = () => {
      const view = document.getElementById('view');
      view.innerHTML = '';
      view.classList.remove('page-enter');
      if (!useViewTransition) {
        void view.offsetWidth;           // 重排以重启动画
        view.classList.add('page-enter');
      }
      window.scrollTo(0, 0);

      if (id === 'home') {
        renderTopbar(null);
        setActiveTab('home');
        document.title = BRAND.title();
        renderHome(view);
      } else {
        const mod = modules[id];
        noteVisit(id);
        renderTopbar(mod);
        setActiveTab(mod.tab || id);
        document.title = BRAND.title(mod.name);
        const maybe = mod.render(view);
        if (typeof maybe === 'function') cleanup = maybe;
      }
    };

    if (useViewTransition) document.startViewTransition(swap);
    else swap();
  }

  window.addEventListener('hashchange', route);

  /* =======================================================================
     10. 启动
     ======================================================================= */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        // 有更新时静默刷新缓存
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (sw) sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[' + BRAND.name + '] 新版本已就绪，下次打开自动生效');
            }
          });
        });
      }).catch((e) => console.warn('[' + BRAND.name + '] Service Worker 注册失败', e));
    });
  }

  function init() {
    renderTabbar();
    route();
    registerServiceWorker();

    // 全局按键：Esc 返回首页
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && currentId !== 'home') {
        const openModal = document.querySelector('.modal-backdrop');
        if (!openModal) location.hash = '#/';
      }
    });

    console.info('%c' + BRAND.name + ' v' + App.version, 'color:#8b5cf6;font-weight:bold', '已启动');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
