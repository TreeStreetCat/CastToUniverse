/* =========================================================================
   模块一：答案之书
   流程：选分类 → 点击「翻开」→ 3 秒冥想倒计时（呼吸环）→ 封面 3D 翻页 → 答案淡入
   数据：data/answers.json（228 条，10 个分类）；离线或 file:// 时自动使用内置兜底题库
   ========================================================================= */
(function () {
  'use strict';

  /* 兜底题库：仅当 answers.json 无法加载时启用，保证工具永远可用 */
  const FALLBACK = {
    categories: [
      { id: 'all', name: '全部' },
      { id: 'action', name: '行动' },
      { id: 'wait', name: '等待' },
      { id: 'humor', name: '幽默' }
    ],
    answers: [
      { text: '大胆去做', category: 'action' },
      { text: '现在就动手', category: 'action' },
      { text: '别犹豫，先迈第一步', category: 'action' },
      { text: '做了再说', category: 'action' },
      { text: '等三天再说', category: 'wait' },
      { text: '时机未到', category: 'wait' },
      { text: '先放一放', category: 'wait' },
      { text: '让子弹飞一会儿', category: 'wait' },
      { text: '换个角度看', category: 'humor' },
      { text: '答案在风中，风今天请假', category: 'humor' },
      { text: '问就是不行，不问也不行', category: 'humor' },
      { text: '抛硬币吧，别为难我了', category: 'humor' }
    ]
  };

  const MEDITATE_MS = 3000;
  const RING_R = 44;
  const RING_C = 2 * Math.PI * RING_R;

  App.register({
    id: 'book',
    name: '答案之书',
    tagline: '闭眼默念问题，翻开一页',
    desc: '默念 3 秒，书会替你回答',
    badge: '经典',
    group: '让命运回答',
    accent: 'violet',
    icon: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M8.5 7.5h6.5M8.5 11h4"/>',

    render(root) {
      const wrap = App.el(
        '<div class="page page-book">' +
          '<div class="chips answer-filters" id="bkFilters" role="group" aria-label="答案分类"></div>' +
          '<div class="book-stage">' +
            '<div class="book-scene" id="bkScene">' +
              '<div class="book">' +
                '<div class="book-base">' +
                  '<div class="book-page-inner" id="bkPage">' +
                    '<p class="book-ornament">A N S W E R</p>' +
                    '<p class="book-answer" id="bkAnswer">准备好了吗</p>' +
                    '<span class="book-cat" id="bkCat">点击下方按钮开始</span>' +
                  '</div>' +
                '</div>' +
                '<div class="book-cover" id="bkCover">' +
                  '<div class="cover-face cover-front">' +
                    '<span class="book-cover-seal">翻开</span>' +
                    '<span class="book-cover-title">答案之书</span>' +
                    '<span class="book-cover-sub">THE BOOK OF ANSWERS</span>' +
                  '</div>' +
                  '<div class="cover-face cover-back"></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div id="bkControl"></div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const filters = wrap.querySelector('#bkFilters');
      const scene = wrap.querySelector('#bkScene');
      const page = wrap.querySelector('#bkPage');
      const answerEl = wrap.querySelector('#bkAnswer');
      const catEl = wrap.querySelector('#bkCat');
      const cover = wrap.querySelector('#bkCover');
      const control = wrap.querySelector('#bkControl');

      let bank = [];              // 全部答案
      let categories = [];        // 分类定义
      let activeCat = App.storage.get('book:cat', 'all');
      let phase = 'idle';         // idle | meditating | opened
      let lastText = '';          // 避免连续两次抽到同一条
      let lastPicked = null;      // 当前页面的答案，供「复制 / 分享」延迟取值
      let rafId = 0;
      let timers = [];
      let destroyed = false;

      function later(fn, ms) {
        const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
        timers.push(id);
        return id;
      }

      /* ---------- 分类筛选条 ---------- */
      function renderFilters() {
        filters.innerHTML = '';
        categories.forEach((c) => {
          const btn = App.el(
            '<button type="button" class="chip' + (c.id === activeCat ? ' is-active' : '') + '" data-cat="' + App.esc(c.id) + '">' +
              App.esc(c.name) +
            '</button>'
          );
          btn.addEventListener('click', () => {
            if (phase === 'meditating') return;
            activeCat = c.id;
            App.storage.set('book:cat', activeCat);
            App.sfx.tick();
            App.haptic.tap();
            renderFilters();
            reset();
          });
          filters.appendChild(btn);
        });
      }

      function pool() {
        if (activeCat === 'all') return bank;
        const list = bank.filter((a) => a.category === activeCat);
        return list.length ? list : bank;
      }

      function categoryName(id) {
        const c = categories.find((x) => x.id === id);
        return c ? c.name : id;
      }

      /* ---------- 控制区（三种状态） ---------- */
      function paintControl() {
        if (phase === 'idle') {
          control.innerHTML =
            '<button type="button" class="btn btn-primary btn-block" id="bkStart">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M14 10l3 2-3 2z"/></svg>' +
              '翻开答案' +
            '</button>' +
            '<p class="panel-hint" style="text-align:center;margin-top:10px">闭上眼睛，在心里把问题默念一遍</p>';
          control.querySelector('#bkStart').addEventListener('click', start);

        } else if (phase === 'meditating') {
          control.innerHTML =
            '<div class="meditate">' +
              '<div class="meditate-ring breathing" id="bkRing">' +
                '<svg viewBox="0 0 96 96" aria-hidden="true">' +
                  '<circle class="ring-bg" cx="48" cy="48" r="' + RING_R + '" fill="none" />' +
                  '<circle class="ring-fg" id="bkRingFg" cx="48" cy="48" r="' + RING_R + '" fill="none" ' +
                    'stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '" />' +
                '</svg>' +
                '<span class="meditate-count" id="bkCount">3</span>' +
              '</div>' +
              '<p class="meditate-text">屏住呼吸，把问题问完整<br />（轻点可跳过冥想）</p>' +
            '</div>';
          const ring = control.querySelector('#bkRing');
          ring.style.cursor = 'pointer';
          ring.addEventListener('click', () => {
            // 至少等待 1 秒才能跳过，避免误触导致流程名存实亡
            if (performance.now() - startAt > 1000) finishMeditation();
          });

        } else {
          control.innerHTML =
            '<div class="btn-row">' +
              '<button type="button" class="btn btn-primary" id="bkAgain">再问一次</button>' +
              '<button type="button" class="btn btn-ghost" id="bkClose">合上书</button>' +
            '</div>';
          // 答案可带走：复制 / 系统分享
          if (lastPicked) {
            control.appendChild(App.shareRow(
              () => '「抛给宇宙」答案之书：' + lastPicked.text,
              { title: '抛给宇宙 · 答案之书' }
            ));
          }
          control.querySelector('#bkAgain').addEventListener('click', () => {
            scene.classList.remove('is-open');
            App.sfx.click();
            later(() => {
              phase = 'idle';
              reset();
              start();
            }, 420);
          });
          control.querySelector('#bkClose').addEventListener('click', () => {
            App.sfx.click();
            later(() => {
              scene.classList.remove('is-open');
              later(() => { phase = 'idle'; reset(); }, 620);
            }, 120);
          });
        }
      }

      /* ---------- 书页重置 ---------- */
      function reset() {
        answerEl.textContent = '准备好了吗';
        catEl.textContent = '点击下方按钮开始';
        page.classList.remove('pop-in');
        void page.offsetWidth;
        scene.classList.remove('is-open');
        paintControl();
      }

      /* ---------- 3 秒冥想 ---------- */
      let startAt = 0;
      let finished = false;

      function start() {
        if (phase === 'meditating') return;
        phase = 'meditating';
        finished = false;
        startAt = performance.now();
        App.sfx.click();
        App.haptic.tap();
        paintControl();

        const fg = control.querySelector('#bkRingFg');
        const countEl = control.querySelector('#bkCount');
        let lastSecond = 3;

        function step(now) {
          if (destroyed || phase !== 'meditating') return;
          const p = Math.min(1, (now - startAt) / MEDITATE_MS);
          const left = Math.max(0, Math.ceil((MEDITATE_MS - (now - startAt)) / 1000));
          if (fg) fg.setAttribute('stroke-dashoffset', (RING_C * (1 - p)).toFixed(2));
          if (countEl && left !== lastSecond) {
            lastSecond = left;
            countEl.textContent = String(left);
            App.sfx.tick();
            App.haptic.tap();
          }
          if (p >= 1) {
            finishMeditation();
            return;
          }
          rafId = requestAnimationFrame(step);
        }
        rafId = requestAnimationFrame(step);
      }

      function finishMeditation() {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(rafId);
        phase = 'opened';

        // 抽答案：允许重复，但避免与上一条相同
        const list = pool();
        let picked = list[App.randInt(list.length)];
        if (list.length > 1 && picked.text === lastText) {
          picked = list[(list.indexOf(picked) + 1 + App.randInt(list.length - 1)) % list.length];
        }
        lastText = picked.text;
        lastPicked = picked;

        App.sfx.whoosh();
        scene.classList.add('is-open');

        later(() => {
          answerEl.textContent = picked.text;
          catEl.textContent = '· ' + categoryName(picked.category) + ' ·';
          page.classList.add('pop-in');
          App.sfx.ding();
          App.haptic.land();
          App.celebrate({ particleCount: 64, spread: 84, origin: { x: 0.5, y: 0.42 } });
          paintControl();
        }, 560);
      }

      /* ---------- 初始化 ---------- */
      App.loadData('data/answers.json', FALLBACK).then((json) => {
        if (destroyed) return;
        categories = (json && json.categories) || FALLBACK.categories;
        bank = ((json && json.answers) || FALLBACK.answers).filter((a) => a && a.text);
        if (!categories.some((c) => c.id === activeCat)) activeCat = 'all';
        renderFilters();
        paintControl();
      });

      // 封面本身也可点击开始，降低操作门槛
      cover.addEventListener('click', () => {
        if (phase === 'idle') start();
      });
      cover.style.cursor = 'pointer';

      /* ---------- 清理 ---------- */
      return function cleanupBook() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        timers.forEach(clearTimeout);
        timers = [];
      };
    }
  });
})();
