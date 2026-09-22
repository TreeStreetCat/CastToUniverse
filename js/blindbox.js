/* =========================================================================
   模块三之二：盲盒抽签
   - 输入框一行一项（也支持逗号 / 顿号 / 分号分隔）
   - 不重复抽签采用 Fisher-Yates 洗牌后顺序取用，而不是每次独立随机，
     因此「抽过的不会再抽到」是数学上严格的，而不是概率上的
   - 抽签池与设置写入 localStorage，刷新后不丢
   ========================================================================= */
(function () {
  'use strict';

  const DEFAULT_POOL = [
    '今天吃火锅',
    '今天吃日料',
    '今天吃烧烤',
    '今天吃家常菜',
    '今天吃沙拉',
    '今天吃面条',
    '今天吃炸鸡',
    '今天吃饺子'
  ].join('\n');

  function parsePool(text) {
    return String(text || '')
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((item, i, arr) => arr.indexOf(item) === i);   // 去重，保留首次出现顺序
  }

  App.register({
    id: 'blindbox',
    name: '盲盒抽签',
    tagline: '一堆选项里，抽一个出来',
    desc: '洗牌后抽取，可保证不重复',
    badge: '不重复',
    group: '纯随机',
    accent: 'lime',
    icon: '<path d="M3.6 8.6 12 4.2l8.4 4.4v6.8L12 19.8l-8.4-4.4z"/><path d="M3.6 8.6 12 13l8.4-4.4M12 13v6.8"/>',

    render(root) {
      let pool = parsePool(App.storage.get('box:pool', DEFAULT_POOL));
      let remaining = pool.slice();             // 不重复模式下的剩余池
      let noRepeat = App.storage.get('box:noRepeat', true) !== false;
      let drawCount = App.storage.get('box:count', 1) || 1;
      let lastDrawn = [];                       // 本次抽出的结果，用于「补抽」提示
      let drawing = false;
      let timers = [];
      let destroyed = false;

      const wrap = App.el(
        '<div class="page page-blindbox">' +
          '<div class="box-stage">' +
            '<div class="box-shape" id="bxShape">' +
              '<div class="box-face"><span>?</span></div>' +
            '</div>' +
          '</div>' +

          '<div id="bxResult" style="margin-bottom:14px"></div>' +

          '<div class="btn-row" style="margin-bottom:14px">' +
            '<button type="button" class="btn btn-primary" id="bxDraw">抽一个</button>' +
            '<button type="button" class="btn btn-ghost" id="bxResetPool">重置抽签池</button>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">抽签设置 <span class="panel-hint" id="bxPoolInfo"></span></h3>' +
            '<label class="field-label">抽取数量</label>' +
            '<div class="segmented" id="bxCount" style="margin-bottom:14px">' +
              '<button type="button" data-n="1">1 个</button>' +
              '<button type="button" data-n="2">2 个</button>' +
              '<button type="button" data-n="3">3 个</button>' +
              '<button type="button" data-n="5">5 个</button>' +
            '</div>' +
            '<label class="switch">' +
              '<input type="checkbox" id="bxNoRepeat" />' +
              '<span class="switch-track"></span>' +
              '<span>不重复抽签（抽走的不再放回）</span>' +
            '</label>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">候选项 <span class="panel-hint">一行一项</span></h3>' +
            '<textarea class="textarea" id="bxInput" placeholder="每行写一个选项，例如：&#10;吃火锅&#10;吃日料&#10;吃烧烤"></textarea>' +
            '<div class="btn-row" style="margin-top:10px">' +
              '<button type="button" class="btn btn-ghost" id="bxApply">应用修改</button>' +
              '<button type="button" class="btn btn-ghost" id="bxSample">填入示例</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const shape = wrap.querySelector('#bxShape');
      const resultBox = wrap.querySelector('#bxResult');
      const input = wrap.querySelector('#bxInput');
      const countBox = wrap.querySelector('#bxCount');
      const noRepeatInput = wrap.querySelector('#bxNoRepeat');
      const poolInfo = wrap.querySelector('#bxPoolInfo');

      input.value = pool.join('\n');
      noRepeatInput.checked = noRepeat;

      function later(fn, ms) {
        const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
        timers.push(id);
        return id;
      }

      function paintInfo() {
        const left = noRepeat ? remaining.length : pool.length;
        poolInfo.textContent = '池内 ' + pool.length + ' 项' + (noRepeat ? ' · 剩余 ' + remaining.length : '');
        countBox.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('is-active', Number(b.dataset.n) === drawCount);
        });
      }

      /* ---------------- 设置交互 ---------------- */
      countBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-n]');
        if (!btn || drawing) return;
        drawCount = Number(btn.dataset.n);
        App.storage.set('box:count', drawCount);
        App.sfx.tick();
        App.haptic.tap();
        paintInfo();
      });

      noRepeatInput.addEventListener('change', () => {
        noRepeat = noRepeatInput.checked;
        App.storage.set('box:noRepeat', noRepeat);
        remaining = pool.slice();
        App.sfx.tick();
        App.haptic.tap();
        paintInfo();
      });

      wrap.querySelector('#bxApply').addEventListener('click', () => {
        const next = parsePool(input.value);
        if (next.length < 2) {
          App.toast('至少写两个选项');
          App.sfx.warn();
          return;
        }
        pool = next;
        remaining = pool.slice();
        App.storage.set('box:pool', pool);
        input.value = pool.join('\n');
        resultBox.innerHTML = '';
        App.sfx.pop();
        App.haptic.tap();
        paintInfo();
        App.toast('已更新 ' + pool.length + ' 个选项');
      });

      wrap.querySelector('#bxSample').addEventListener('click', () => {
        input.value = DEFAULT_POOL;
        App.sfx.click();
        App.toast('已填入示例，记得点「应用修改」');
      });

      wrap.querySelector('#bxResetPool').addEventListener('click', () => {
        remaining = pool.slice();
        lastDrawn = [];
        resultBox.innerHTML = '';
        App.sfx.pop();
        App.haptic.tap();
        paintInfo();
        App.toast('抽签池已重置');
      });

      /* ---------------- 抽取 ---------------- */
      function draw() {
        if (drawing) return;

        const source = noRepeat ? remaining : pool;
        if (source.length === 0) {
          remaining = pool.slice();
          App.toast('池子空了，已自动重置');
          App.sfx.warn();
          paintInfo();
          return;
        }

        drawing = true;
        resultBox.innerHTML = '';

        // 先洗牌再顺序取，保证不重复是严格的
        const shuffled = App.shuffle(source);
        const n = Math.min(drawCount, shuffled.length);
        if (n < drawCount) {
          App.toast('池内只剩 ' + shuffled.length + ' 项，全部抽出');
        }
        const picked = shuffled.slice(0, n);
        lastDrawn = picked;

        if (noRepeat) {
          // 从剩余池中摘掉已抽出的项
          remaining = remaining.filter((x) => picked.indexOf(x) === -1);
        }

        shape.classList.add('is-shaking');
        App.sfx.shake();
        App.haptic.shake();

        later(() => {
          shape.classList.remove('is-shaking');
          App.sfx.ding();
          App.haptic.land();

          resultBox.innerHTML =
            '<div class="draw-results">' +
              picked.map((txt, i) =>
                '<div class="draw-item pop-in" style="animation-delay:' + (i * 90) + 'ms">' +
                  '<span class="rank">' + (i + 1) + '</span>' +
                  '<span class="txt">' + App.esc(txt) + '</span>' +
                '</div>'
              ).join('') +
            '</div>' +
            (noRepeat ? '<p class="pool-note" style="margin-top:10px">池内还剩 ' + remaining.length + ' 项</p>' : '');

          App.celebrate({ particleCount: 62, spread: 78, origin: { x: 0.5, y: 0.34 } });
          picked.forEach((txt, i) => later(() => App.sfx.pop(), i * 90));
          drawing = false;
          paintInfo();
        }, 900);
      }

      wrap.querySelector('#bxDraw').addEventListener('click', draw);
      shape.addEventListener('click', draw);

      paintInfo();

      return function cleanupBox() {
        destroyed = true;
        timers.forEach(clearTimeout);
        timers = [];
      };
    }
  });
})();
