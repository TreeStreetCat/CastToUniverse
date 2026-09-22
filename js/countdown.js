/* =========================================================================
   模块五：随机时钟（倒计时倒逼法）
   玩法：输入备选项 → 点击开始 → 屏幕高速随机高亮 → 在限定时间内按空格或点击屏幕叫停，
        停在哪个就是哪个。核心不是随机，而是「不给你思考时间」，
        让手比脑子先做决定。
   实现：requestAnimationFrame 统一驱动闪烁与倒计时，保证两者同步且不丢帧；
        闪烁节奏 70~80ms，低于人的决策速度但高于阅读速度。
   ========================================================================= */
(function () {
  'use strict';

  const DURATIONS = [
    { sec: 3, name: '3 秒' },
    { sec: 5, name: '5 秒' },
    { sec: 8, name: '8 秒' }
  ];

  const DEFAULT_POOL = ['现在动手', '先睡一觉', '出去走走', '找人说说话'].join('\n');

  function parseOptions(text) {
    return String(text || '')
      .split(/[\n,，、;；]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((item, i, arr) => arr.indexOf(item) === i)
      .slice(0, 20);
  }

  App.register({
    id: 'clock',
    name: '随机时钟',
    tagline: '5 秒内不许思考，手停在哪儿算哪儿',
    desc: '倒计时逼你做出第一反应',
    badge: '倒逼法',
    group: '纯随机',
    accent: 'violet',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2.2"/>',

    render(root) {
      let options = parseOptions(App.storage.get('clock:pool', DEFAULT_POOL));
      let duration = App.storage.get('clock:duration', 5) || 5;
      let running = false;
      let rafId = 0;
      let endAt = 0;
      let lastFlip = 0;
      let hotIndex = 0;
      let stopped = false;
      let destroyed = false;

      const wrap = App.el(
        '<div class="page page-clock">' +

          '<div class="clock-stage" id="ckStage" role="button" tabindex="0" aria-label="开始或叫停">' +
            '<div class="clock-options" id="ckOptions"></div>' +
            '<p class="clock-hint" id="ckHint">点击这里开始</p>' +
          '</div>' +

          '<div id="ckResult" style="margin:14px 0"></div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">限定时间</h3>' +
            '<div class="segmented" id="ckDurations"></div>' +
            '<p class="panel-hint" style="margin-top:10px">时间到会自动停下，不会一直空转。</p>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">备选项 <span class="panel-hint">一行一项</span></h3>' +
            '<textarea class="textarea" id="ckInput" placeholder="每行写一个选项"></textarea>' +
            '<div class="btn-row" style="margin-top:10px">' +
              '<button type="button" class="btn btn-ghost" id="ckApply">应用修改</button>' +
              '<button type="button" class="btn btn-ghost" id="ckSample">填入示例</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const stage = wrap.querySelector('#ckStage');
      const optionsBox = wrap.querySelector('#ckOptions');
      const hint = wrap.querySelector('#ckHint');
      const resultBox = wrap.querySelector('#ckResult');
      const durationBox = wrap.querySelector('#ckDurations');
      const input = wrap.querySelector('#ckInput');

      input.value = options.join('\n');

      /* ---------------- 选项渲染 ---------------- */
      function paintOptions() {
        optionsBox.innerHTML = '';
        if (!options.length) {
          optionsBox.innerHTML = '<p class="panel-hint">先在上面填几个选项</p>';
          return;
        }
        options.forEach((text, i) => {
          const chip = App.el(
            '<button type="button" class="clock-opt" data-i="' + i + '">' + App.esc(text) + '</button>'
          );
          // 点选项也算「点击屏幕」：运行中叫停，未运行则开始
          chip.addEventListener('click', (e) => {
            e.stopPropagation();          // 阻止冒泡，避免和外层舞台的点击逻辑重复触发
            if (running) stop(false);
            else start();
          });
          optionsBox.appendChild(chip);
        });
      }

      function paintDurations() {
        durationBox.innerHTML = '';
        DURATIONS.forEach((d) => {
          const btn = App.el(
            '<button type="button" data-sec="' + d.sec + '" class="' + (d.sec === duration ? 'is-active' : '') + '">' + d.name + '</button>'
          );
          btn.addEventListener('click', () => {
            if (running) return;
            duration = d.sec;
            App.storage.set('clock:duration', duration);
            App.sfx.tick();
            App.haptic.tap();
            paintDurations();
          });
          durationBox.appendChild(btn);
        });
      }

      function clearHot() {
        optionsBox.querySelectorAll('.clock-opt').forEach((c) => {
          c.classList.remove('is-hot');
          c.classList.remove('is-final');
        });
      }

      /* ---------------- 开始 / 叫停 ---------------- */
      function start() {
        if (running) return;
        if (options.length < 2) {
          App.toast('至少写两个选项');
          App.sfx.warn();
          return;
        }

        running = true;
        stopped = false;
        resultBox.innerHTML = '';
        clearHot();
        stage.classList.add('is-running');
        stage.classList.remove('is-done');
        hint.textContent = '按空格或点击屏幕叫停';

        const count = App.el('<div class="clock-count" id="ckCount">' + duration + '</div>');
        const old = stage.querySelector('.clock-count');
        if (old) old.remove();
        stage.appendChild(count);

        endAt = performance.now() + duration * 1000;
        lastFlip = 0;
        hotIndex = -1;

        App.sfx.click();
        App.haptic.tap();

        function frame(now) {
          if (destroyed || !running) return;
          const left = Math.max(0, endAt - now);

          // 倒计时数字（只在整秒变化时更新，避免每秒重排 60 次）
          const secLeft = Math.ceil(left / 1000);
          if (count.textContent !== String(secLeft)) {
            count.textContent = String(secLeft);
            count.classList.toggle('warn', secLeft <= 2);
            if (secLeft <= 2 && secLeft > 0) {
              App.sfx.tick();
              App.haptic.tap();
            }
          }

          // 高速闪烁：70~80ms 换一次，且不与上一次重复
          if (now - lastFlip > 72) {
            lastFlip = now;
            const chips = optionsBox.querySelectorAll('.clock-opt');
            if (chips.length) {
              if (hotIndex >= 0 && chips[hotIndex]) chips[hotIndex].classList.remove('is-hot');
              let next = App.randInt(chips.length);
              if (chips.length > 1 && next === hotIndex) next = (next + 1) % chips.length;
              hotIndex = next;
              chips[hotIndex].classList.add('is-hot');
            }
          }

          if (left <= 0) {
            stop(true);
            return;
          }
          rafId = requestAnimationFrame(frame);
        }
        rafId = requestAnimationFrame(frame);
      }

      function stop(auto) {
        if (!running) return;
        running = false;
        cancelAnimationFrame(rafId);

        const count = stage.querySelector('.clock-count');
        if (count) count.remove();

        stage.classList.remove('is-running');
        stage.classList.add('is-done');

        const chips = optionsBox.querySelectorAll('.clock-opt');
        let finalText = '—';
        chips.forEach((chip, i) => {
          chip.classList.remove('is-hot');
          if (i === hotIndex) {
            chip.classList.add('is-final');
            finalText = chip.textContent;
          }
        });

        hint.textContent = '点一下，重来一次';
        App.sfx.ding();
        App.haptic.land();
        App.celebrate({ particleCount: 38, spread: 54, startVelocity: 26, origin: { x: 0.5, y: 0.36 } });

        resultBox.innerHTML =
          '<div class="result-box pop-in">' +
            '<p class="result-label">' + (auto ? '时间到，停在' : '你停在这里') + '</p>' +
            '<p class="clock-final-text">' + App.esc(finalText) + '</p>' +
            '<p class="panel-hint" style="margin-top:8px">不许改，就按它执行</p>' +
          '</div>';
      }

      stage.addEventListener('click', () => {
        if (running) stop(false);
        else start();
      });

      stage.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
          e.preventDefault();
          if (running) stop(false);
          else start();
        }
      });

      // 全局空格键：只要在随机时钟页面且焦点不在输入框里，都能叫停
      function onGlobalKey(e) {
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (running) stop(false);
        else start();
      }
      document.addEventListener('keydown', onGlobalKey);

      /* ---------------- 选项编辑 ---------------- */
      wrap.querySelector('#ckApply').addEventListener('click', () => {
        const next = parseOptions(input.value);
        if (next.length < 2) {
          App.toast('至少写两个选项');
          App.sfx.warn();
          return;
        }
        options = next;
        App.storage.set('clock:pool', options);
        input.value = options.join('\n');
        resultBox.innerHTML = '';
        hint.textContent = '点击这里开始';
        stage.classList.remove('is-done');
        clearHot();
        App.sfx.pop();
        App.haptic.tap();
        paintOptions();
        App.toast('已更新 ' + options.length + ' 个选项');
      });

      wrap.querySelector('#ckSample').addEventListener('click', () => {
        input.value = DEFAULT_POOL;
        App.sfx.click();
        App.toast('已填入示例，记得点「应用修改」');
      });

      paintDurations();
      paintOptions();

      return function cleanupClock() {
        destroyed = true;
        running = false;
        cancelAnimationFrame(rafId);
        document.removeEventListener('keydown', onGlobalKey);
      };
    }
  });
})();
