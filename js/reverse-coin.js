/* =========================================================================
   模块四：假装硬币（反向心理学）
   核心逻辑：随机结果本身不重要，重要的是你看到结果那一刻的情绪反应。
   因此流程是「抛 → 揭晓 → 追问情绪 → 反推你真正想要的那个选项」。
   本文件同时向全局暴露 App.reverseAsk()，供硬币 / 骰子模块复用同一个追问弹窗。
   ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     全局能力：反问弹窗
     App.reverseAsk({ picked, other }) → Promise<'relieved'|'disappointed'|'unsure'|null>
     picked：刚刚随机到的选项；other：另一个选项（用于「你其实想选另一个」的措辞）
     ----------------------------------------------------------------------- */
  App.reverseAsk = function (opts) {
    const o = opts || {};
    const picked = o.picked || '这个结果';
    const other = o.other || '另一个选项';
    return App.modal({
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 2.8C19 15.6 12 20 12 20z"/></svg>',
      title: '停一下，问自己一句',
      text: '结果是「' + picked + '」。你心里是松了一口气，还是隐隐觉得失望？',
      buttons: [
        { label: '松了一口气，就是它了', value: 'relieved' },
        { label: '有点失望……', value: 'disappointed' },
        { label: '说不上来', value: 'unsure', kind: 'ghost' }
      ]
    }).then((value) => {
      if (!value) return null;
      // 把落点也告诉调用方，便于拼装措辞
      o.onPick && o.onPick(value);
      return value;
    });
  };

  App.register({
    id: 'reverse',
    name: '假装硬币',
    tagline: '硬币不重要，你的反应才重要',
    desc: '反推你真正想要的答案',
    group: '反内耗',
    accent: 'coral',
    icon: '<path d="M12 20s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 2.8C19 15.6 12 20 12 20z"/><path d="M9 11.4h6"/>',

    render(root) {
      let curRotation = 0;
      let busy = false;
      let destroyed = false;
      let round = 0;

      const wrap = App.el(
        '<div class="page page-reverse">' +
          '<div class="panel">' +
            '<h3 class="panel-title">它是怎么起作用的</h3>' +
            '<p class="panel-hint">' +
              '硬币本身没有答案，但它会逼你表态。' +
              '当你看到结果的第一反应是「松了一口气」，那就是你想要的；' +
              '如果是「有点失望」，真正的答案也同时出现了。' +
            '</p>' +
          '</div>' +

          '<div class="coin-stage" id="rvStage">' +
            '<div>' +
              '<div class="coin" id="rvCoin">' +
                '<div class="coin-face front"><span class="glyph">甲<small>O P T I O N  A</small></span></div>' +
                '<div class="coin-face back"><span class="glyph">乙<small>O P T I O N  B</small></span></div>' +
              '</div>' +
              '<div class="coin-shadow"></div>' +
            '</div>' +
          '</div>' +

          '<button type="button" class="btn btn-primary btn-block" id="rvFlip" style="margin-bottom:14px">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>' +
            '抛一次，问自己的感受' +
          '</button>' +

          '<div id="rvFlow" style="margin-bottom:14px"></div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">使用建议</h3>' +
            '<p class="panel-hint">' +
              '先给硬币的甲乙两面各绑一个明确选项，例如「甲 = 换工作、乙 = 留下」，' +
              '抛之前在心里确认一遍。抛完不要急着执行结果，先看自己的第一反应。' +
            '</p>' +
            '<div class="notodo-stats" style="margin-top:14px">' +
              '<div class="notodo-stat"><b id="rvRound">0</b><span>本轮次数</span></div>' +
              '<div class="notodo-stat"><b id="rvHonest">0</b><span>承认失望的次数</span></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const coin = wrap.querySelector('#rvCoin');
      const stage = wrap.querySelector('#rvStage');
      const flipBtn = wrap.querySelector('#rvFlip');
      const flow = wrap.querySelector('#rvFlow');
      const roundEl = wrap.querySelector('#rvRound');
      const honestEl = wrap.querySelector('#rvHonest');

      let honest = App.storage.get('reverse:honest', 0) || 0;

      function paintStats() {
        roundEl.textContent = String(round);
        honestEl.textContent = String(honest);
      }
      paintStats();

      function flip() {
        if (busy) return;
        busy = true;
        flipBtn.disabled = true;
        flow.innerHTML = '';

        const isAlpha = App.rand() < 0.5;
        const spins = 4;
        let next = curRotation + spins * 360;
        next = next - (next % 360) + (isAlpha ? 0 : 180);
        if (next <= curRotation) next += 360;
        curRotation = next;

        coin.classList.remove('hop');
        void coin.offsetWidth;
        coin.classList.add('hop');
        coin.style.transform = 'rotateY(' + curRotation + 'deg)';
        stage.classList.add('is-flipping');
        App.sfx.whoosh();
        App.haptic.tap();

        setTimeout(async () => {
          if (destroyed) return;
          stage.classList.remove('is-flipping');
          App.sfx.ding();
          App.haptic.land();

          const picked = isAlpha ? '甲' : '乙';
          const other = isAlpha ? '乙' : '甲';
          round += 1;
          paintStats();
          flow.innerHTML =
            '<div class="result-box pop-in">' +
              '<p class="result-label">硬币停下</p>' +
              '<p class="result-value">' + picked + ' 面朝上</p>' +
              '<p class="panel-hint" style="margin-top:8px">记住你的第一反应，答案就在这里</p>' +
            '</div>';

          await App.wait(650);
          if (destroyed) return;

          const feeling = await App.reverseAsk({
            picked: picked + ' 面',
            other: other + ' 面'
          });
          if (destroyed) return;

          if (!feeling) {
            flow.insertAdjacentHTML('beforeend',
              '<p class="panel-hint" style="margin-top:10px;text-align:center">这次先放过自己，想好了再来。</p>');
          } else if (feeling === 'relieved') {
            flow.insertAdjacentHTML('beforeend',
              '<div class="result-box reverse-step" style="margin-top:12px;border-color:rgba(182,255,59,0.4)">' +
                '<p class="reverse-quote">好，那就这么定了。</p>' +
                '<p class="panel-hint" style="margin-top:10px">松了一口气，说明这个结果正好是你想要的——' +
                '你缺的不是答案，是一个同意自己的理由。</p>' +
              '</div>');
            App.sfx.pop();
          } else if (feeling === 'disappointed') {
            honest += 1;
            App.storage.set('reverse:honest', honest);
            paintStats();
            flow.insertAdjacentHTML('beforeend',
              '<div class="result-box reverse-step" style="margin-top:12px;border-color:rgba(255,62,165,0.45)">' +
                '<p class="reverse-quote">别自欺欺人了，其实你心里早就想选「' + App.esc(other) + '」。</p>' +
                '<p class="panel-hint" style="margin-top:10px">失望是一个很有用的信号：' +
                '它比任何理由都更早知道你想要什么。现在就按那个选项去安排吧。</p>' +
              '</div>');
            App.sfx.pop();
          } else {
            flow.insertAdjacentHTML('beforeend',
              '<div class="result-box reverse-step" style="margin-top:12px">' +
                '<p class="reverse-quote">说不上来，说明这两个选项的差别没你想的那么大。</p>' +
                '<p class="panel-hint" style="margin-top:10px">那就别在这件事上继续耗着了，' +
                '随便选一个先动起来——大部分选择的价值是在做之后才长出来的。</p>' +
              '</div>');
            App.sfx.pop();
          }

          busy = false;
          flipBtn.disabled = false;
        }, 2650);
      }

      flipBtn.addEventListener('click', flip);
      coin.addEventListener('click', flip);

      return function cleanupReverse() {
        destroyed = true;
      };
    }
  });
})();
