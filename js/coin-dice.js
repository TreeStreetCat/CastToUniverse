/* =========================================================================
   模块三：硬币 / 骰子
   硬币：CSS 3D 翻转（perspective + preserve-3d + backface-visibility），
        旋转角按「目标面」精确计算，不会出现视觉与结果不一致。
   骰子：CSS 3D 立方体六面，按点数反推目标旋转角。
   可选：开启「反向提问」后，结果出来会追问你真实的感受（见 reverse-coin.js）。
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------- 硬币 ---------------- */
  App.register({
    id: 'coin',
    name: '抛硬币',
    tagline: '正反之间，二选一',
    desc: '3D 翻转，一秒定胜负',
    group: '纯随机',
    accent: 'amber',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6v8.8M9.4 10.2h5.2M9.4 13.8h5.2"/>',

    render(root) {
      let curRotation = 0;          // 当前累计角度，保证每次都向前翻
      let flipping = false;
      let stat = App.storage.get('coin:stat', { heads: 0, tails: 0, total: 0 });
      let reverseOn = App.storage.get('coin:reverse', false) === true;
      let destroyed = false;

      const wrap = App.el(
        '<div class="page page-coin">' +
          '<div class="coin-stage" id="cnStage">' +
            '<div>' +
              '<div class="coin" id="cnCoin">' +
                '<div class="coin-face front"><span class="glyph">正<small>H E A D S</small></span></div>' +
                '<div class="coin-face back"><span class="glyph">反<small>T A I L S</small></span></div>' +
              '</div>' +
              '<div class="coin-shadow"></div>' +
            '</div>' +
          '</div>' +

          '<div id="cnResult" style="margin-bottom:14px"></div>' +

          '<button type="button" class="btn btn-primary btn-block" id="cnFlip" style="margin-bottom:14px">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>' +
            '抛一次' +
          '</button>' +

          '<div class="panel">' +
            '<h3 class="panel-title">玩法设置</h3>' +
            '<label class="switch">' +
              '<input type="checkbox" id="cnReverse" />' +
              '<span class="switch-track"></span>' +
              '<span>抛出后反问一句「你其实希望是哪面」</span>' +
            '</label>' +
            '<div class="notodo-stats" style="margin-top:14px">' +
              '<div class="notodo-stat"><b id="cnHeads">0</b><span>正面</span></div>' +
              '<div class="notodo-stat"><b id="cnTails">0</b><span>反面</span></div>' +
              '<div class="notodo-stat"><b id="cnTotal">0</b><span>累计次数</span></div>' +
            '</div>' +
            '<div class="btn-row" style="margin-top:14px">' +
              '<button type="button" class="btn btn-ghost" id="cnReset">重置统计</button>' +
            '</div>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">小提示</h3>' +
            '<p class="panel-hint">硬币不会替你做决定，它只会让你看清自己希望的那一面。<br />掷之前先在心里给正反各绑一个选项，效果最好。</p>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const coin = wrap.querySelector('#cnCoin');
      const stage = wrap.querySelector('#cnStage');
      const resultBox = wrap.querySelector('#cnResult');
      const flipBtn = wrap.querySelector('#cnFlip');
      const reverseInput = wrap.querySelector('#cnReverse');
      const headsEl = wrap.querySelector('#cnHeads');
      const tailsEl = wrap.querySelector('#cnTails');
      const totalEl = wrap.querySelector('#cnTotal');

      reverseInput.checked = reverseOn;
      reverseInput.addEventListener('change', () => {
        reverseOn = reverseInput.checked;
        App.storage.set('coin:reverse', reverseOn);
        App.sfx.tick();
        App.haptic.tap();
      });

      function paintStats() {
        headsEl.textContent = String(stat.heads);
        tailsEl.textContent = String(stat.tails);
        totalEl.textContent = String(stat.total);
      }
      paintStats();

      wrap.querySelector('#cnReset').addEventListener('click', () => {
        stat = { heads: 0, tails: 0, total: 0 };
        App.storage.set('coin:stat', stat);
        paintStats();
        App.toast('统计已重置');
      });

      async function flip() {
        if (flipping) return;
        flipping = true;
        flipBtn.disabled = true;
        resultBox.innerHTML = '';
        stage.classList.add('is-flipping');

        const isHeads = App.rand() < 0.5;
        const spins = 4;
        let next = curRotation + spins * 360;
        // 让最终角度对 360 取模正好等于目标面
        next = next - (next % 360) + (isHeads ? 0 : 180);
        if (next <= curRotation) next += 360;
        curRotation = next;

        coin.classList.remove('hop');
        void coin.offsetWidth;
        coin.classList.add('hop');
        coin.style.transform = 'rotateY(' + curRotation + 'deg)';

        App.sfx.whoosh();
        App.haptic.tap();

        // 动画 2.6s，落地瞬间给反馈
        setTimeout(() => {
          if (destroyed) return;
          stage.classList.remove('is-flipping');
          App.sfx.ding();
          App.haptic.land();
          stat.total += 1;
          if (isHeads) stat.heads += 1; else stat.tails += 1;
          App.storage.set('coin:stat', stat);
          paintStats();

          const label = isHeads ? '正面' : '反面';
          resultBox.innerHTML =
            '<div class="result-box pop-in">' +
              '<p class="result-label">硬币落下</p>' +
              '<p class="result-value">' + label + '</p>' +
            '</div>';
          resultBox.appendChild(App.shareRow(
            () => '「抛给宇宙」硬币：' + label,
            { title: '抛给宇宙 · 抛硬币' }
          ));
          App.celebrate({ particleCount: 56, spread: 70, origin: { x: 0.5, y: 0.5 } });

          finishTurn(label, isHeads ? '反面' : '正面');
        }, 2650);
      }

      /** 结果展示完成后，按开关决定是否进入反向提问 */
      async function finishTurn(label, other) {
        if (reverseOn && typeof App.reverseAsk === 'function') {
          // 等结果在屏幕上停留一会儿再追问，避免信息挤在一起
          setTimeout(async () => {
            if (destroyed) return;
            const feeling = await App.reverseAsk({ picked: label, other: other });
            if (destroyed || !feeling) return;
            const html = feeling === 'relieved'
              ? '<div class="reverse-result pop-in"><p class="big">好，那就这么定了。</p>' +
                '<p class="sub">你松了一口气，说明这个结果正是你想要的——只是需要一个理由同意自己。</p></div>'
              : '<div class="reverse-result pop-in"><p class="big">别自欺欺人了。</p>' +
                '<p class="sub">你心里早就想选' + App.esc(other) + '，这次随机只是在替你说出来。</p></div>';
            resultBox.insertAdjacentHTML('beforeend', html);
            App.sfx.pop();
            App.haptic.tap();
          }, 700);
        }
        flipping = false;
        flipBtn.disabled = false;
      }

      flipBtn.addEventListener('click', flip);
      coin.addEventListener('click', flip);

      return function cleanupCoin() {
        destroyed = true;
      };
    }
  });

  /* ---------------- 骰子 ---------------- */
  const PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  // 每个点数对应的立方体目标旋转（先 rotateX 再 rotateY）
  const FACE_ROTATION = {
    1: { x: 0, y: 0 },
    2: { x: -90, y: 0 },    // 上面
    3: { x: 0, y: -90 },    // 右面
    4: { x: 0, y: 90 },     // 左面
    5: { x: 90, y: 0 },     // 下面
    6: { x: 0, y: 180 }     // 后面
  };

  // 六个面的排列顺序；每个面在立方体上的位移由 CSS 变量 --dice-half 推导（见 style.css），
  // 这样小屏只需改 --dice 就能整体缩放，JS 不必参与像素计算。
  const FACE_ORDER = [1, 6, 3, 4, 2, 5];

  function diceFaceHTML(value) {
    const on = PIPS[value] || [];
    let cells = '';
    for (let i = 0; i < 9; i++) {
      cells += '<span class="dice-pip' + (on.indexOf(i) === -1 ? ' empty' : '') + '"></span>';
    }
    return '<div class="dice-face" data-face="' + value + '">' + cells + '</div>';
  }

  App.register({
    id: 'dice',
    name: '掷骰子',
    tagline: '1 到 6，也可三连掷',
    desc: '真·3D 立方体，带合计点数',
    group: '纯随机',
    accent: 'magenta',
    icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="8.4" cy="8.4" r="1.25" fill="currentColor" stroke="none"/><circle cx="15.6" cy="15.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',

    render(root) {
      let count = App.storage.get('dice:count', 2) || 2;
      let rolling = false;
      let spins = [0, 0, 0];       // 每颗骰子累计圈数，保证一直向前滚
      let destroyed = false;

      const wrap = App.el(
        '<div class="page page-dice">' +
          '<div class="dice-stage" id="dcStage"></div>' +
          '<div id="dcResult" style="margin-bottom:14px"></div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">骰子数量</h3>' +
            '<div class="dice-count-row">' +
              '<div class="segmented" id="dcCount">' +
                '<button type="button" data-n="1">1 颗</button>' +
                '<button type="button" data-n="2">2 颗</button>' +
                '<button type="button" data-n="3">3 颗</button>' +
              '</div>' +
              '<span class="dice-total" id="dcTotal"></span>' +
            '</div>' +
            '<label class="switch" style="margin-top:14px">' +
              '<input type="checkbox" id="dcShake" />' +
              '<span class="switch-track"></span>' +
              '<span>摇一摇手机掷骰子</span>' +
            '</label>' +
          '</div>' +

          '<button type="button" class="btn btn-accent btn-block" id="dcRoll" style="margin-bottom:14px">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>' +
            '摇一摇' +
          '</button>' +

          '<div class="panel">' +
            '<h3 class="panel-title">玩法提示</h3>' +
            '<p class="panel-hint">三颗骰子可以做「大 / 小」或「单 / 双」：<br />10 点以下算小，11 点及以上算大；合计为奇数算单，偶数算双。</p>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const stage = wrap.querySelector('#dcStage');
      const resultBox = wrap.querySelector('#dcResult');
      const rollBtn = wrap.querySelector('#dcRoll');
      const totalEl = wrap.querySelector('#dcTotal');
      const countBox = wrap.querySelector('#dcCount');
      const shakeInput = wrap.querySelector('#dcShake');

      function buildDice() {
        stage.innerHTML = '';
        for (let i = 0; i < count; i++) {
          const cube = App.el('<div class="dice" data-i="' + i + '">' + FACE_ORDER.map((v) => diceFaceHTML(v)).join('') + '</div>');
          cube.style.transform = 'rotateX(' + (spins[i] * 360) + 'deg) rotateY(' + (spins[i] * 360) + 'deg)';
          stage.appendChild(cube);
        }
        countBox.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('is-active', Number(b.dataset.n) === count);
        });
        totalEl.textContent = '';
      }

      countBox.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-n]');
        if (!btn) return;
        const n = Number(btn.dataset.n);
        if (n === count || rolling) return;
        count = n;
        App.storage.set('dice:count', count);
        App.sfx.tick();
        App.haptic.tap();
        buildDice();
        resultBox.innerHTML = '';
      });

      function roll() {
        if (rolling) return;
        rolling = true;
        rollBtn.disabled = true;
        resultBox.innerHTML = '';
        App.sfx.shake();
        App.haptic.shake();

        const values = [];
        stage.querySelectorAll('.dice').forEach((cube, i) => {
          const value = App.randInt(6) + 1;
          values.push(value);
          const target = FACE_ROTATION[value];
          spins[i] += 1 + App.randInt(2);           // 1~2 圈
          const x = target.x + 360 * spins[i];
          const y = target.y + 360 * spins[i];
          // 错开一点时间，看起来像分别落定
          setTimeout(() => {
            if (destroyed) return;
            cube.style.transform = 'rotateX(' + x + 'deg) rotateY(' + y + 'deg)';
          }, i * 110);
        });

        setTimeout(() => {
          if (destroyed) return;
          rolling = false;
          rollBtn.disabled = false;
          App.sfx.ding();
          App.haptic.land();

          const total = values.reduce((a, b) => a + b, 0);
          totalEl.innerHTML = '合计 <b>' + total + '</b> 点';
          const extra = count === 3
            ? '　' + (total >= 11 ? '大' : '小') + ' · ' + (total % 2 === 1 ? '单' : '双')
            : '';
          resultBox.innerHTML =
            '<div class="result-box pop-in">' +
              '<p class="result-label">点数</p>' +
              '<p class="result-value">' + values.join(' + ') + (count > 1 ? ' = ' + total : '') + '</p>' +
              (extra ? '<p class="panel-hint" style="margin-top:8px">' + extra.replace('　', '') + '</p>' : '') +
            '</div>';
          resultBox.appendChild(App.shareRow(
            () => '「抛给宇宙」掷骰子：' + values.join(' + ') + (count > 1 ? ' = ' + total : '') + (extra ? extra : ''),
            { title: '抛给宇宙 · 掷骰子' }
          ));
          App.celebrate({ particleCount: 54, spread: 72, origin: { x: 0.5, y: 0.45 } });
        }, 1600 + count * 110);
      }

      rollBtn.addEventListener('click', roll);
      stage.addEventListener('click', roll);

      /* ---------------- 摇一摇（移动端原生交互） ----------------
         iOS 13+ 必须在用户手势里申请动作权限，所以只在开关被点击时申请。
         权限被拒、设备没有传感器、或桌面浏览器没有事件流时，一律安全降级为按钮触发。 */
      let motionHandler = null;
      let motionSeen = false;
      let motionProbe = null;
      const SHAKE_SPEED = 900;        // 加速度变化阈值（越大越迟钝），可按手感调整
      const SHAKE_COOLDOWN = 1400;    // 两次「摇动」之间的最小间隔

      async function enableShake() {
        if (typeof window.DeviceMotionEvent === 'undefined') {
          App.toast('当前设备不支持动作感应，请用按钮掷骰子');
          App.sfx.warn();
          return false;
        }
        if (typeof window.DeviceMotionEvent.requestPermission === 'function') {
          try {
            const res = await window.DeviceMotionEvent.requestPermission();
            if (res !== 'granted') {
              App.toast('未获得动作权限，可稍后重试');
              App.sfx.warn();
              return false;
            }
          } catch (e) {
            App.toast('无法申请动作权限');
            App.sfx.warn();
            return false;
          }
        }

        let last = null;
        let lastTime = 0;
        let lastShake = 0;

        motionHandler = (e) => {
          motionSeen = true;
          const a = e.accelerationIncludingGravity || e.acceleration;
          if (!a || a.x === null) return;
          const now = performance.now();
          if (!last) {
            last = a;
            lastTime = now;
            return;
          }
          const dt = Math.max(16, now - lastTime);
          const delta = Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
          const speed = (delta / dt) * 1000;
          last = a;
          lastTime = now;

          if (speed > SHAKE_SPEED && now - lastShake > SHAKE_COOLDOWN) {
            lastShake = now;
            App.haptic.shake();
            roll();
          }
        };
        window.addEventListener('devicemotion', motionHandler);

        // 1.6 秒内没有任何动作数据，说明设备/浏览器不提供事件流，自动关掉开关
        motionProbe = setTimeout(() => {
          if (destroyed || motionSeen) return;
          App.toast('没有检测到动作数据，已自动关闭摇一摇');
          shakeInput.checked = false;
          disableShake();
        }, 1600);

        return true;
      }

      function disableShake() {
        if (motionHandler) window.removeEventListener('devicemotion', motionHandler);
        motionHandler = null;
        clearTimeout(motionProbe);
        motionProbe = null;
      }

      shakeInput.addEventListener('change', async () => {
        if (shakeInput.checked) {
          const ok = await enableShake();
          shakeInput.checked = ok;
          if (ok) {
            App.sfx.pop();
            App.haptic.tap();
            App.toast('摇一摇已开启，晃动手机试试');
          }
        } else {
          disableShake();
          App.sfx.click();
          App.toast('摇一摇已关闭');
        }
      });

      buildDice();

      return function cleanupDice() {
        destroyed = true;
        disableShake();
      };
    }
  });
  /* 测试钩子：tools/test-logic.js 用它校验「点数 ↔ 立方体旋转 ↔ CSS 面位移」三者是否仍然自洽。
     一旦有人改了 style.css 里某一面的 rotate 值、或改了 FACE_ROTATION，测试会立刻报错，
     避免出现「骰子转到 5 点、朝向用户的却是 3 点」这类只在真机上才看得出来的问题。
     运行时不读取这个对象，可安全忽略。 */
  App.__dice = {
    PIPS: PIPS,
    FACE_ROTATION: FACE_ROTATION,
    FACE_ORDER: FACE_ORDER
  };
})();
