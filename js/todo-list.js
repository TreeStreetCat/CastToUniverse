/* =========================================================================
   模块六：今天不做什么（逆向决策）
   思路：正向清单让人愧疚，逆向清单让人轻松——今天只需要「不做」一件事。
   缓存：以本地日期（startsWith 当天 YYYY-MM-DD）为键写入 localStorage，
        同一天无论刷新多少次都抽到同一件事，第二天自动换新。
   ========================================================================= */
(function () {
  'use strict';

  const FALLBACK = {
    items: [
      { text: '刷短视频 2 小时', why: '你会记得那些视频，但不记得自己的两小时。', tag: '手机' },
      { text: '复盘昨天的尴尬事', why: '全场只有你一个人在反复回放。', tag: '情绪' },
      { text: '在购物车里比价 40 分钟', why: '为省十块钱，花掉半小时的精力。', tag: '消费' },
      { text: '为一件没发生的事焦虑', why: '你交了两份痛苦：预支的，和可能永远不来的。', tag: '情绪' },
      { text: '跟陌生人争论对错', why: '赢了没奖品，输了更难受。', tag: '社交' },
      { text: '熬夜刷剧到三点', why: '借来的快乐，明天连本带利还。', tag: '作息' },
      { text: '反复上秤', why: '体重秤不会替你运动，只会替你焦虑。', tag: '内耗' },
      { text: '对自己说「再刷五分钟」', why: '五分钟从不守约。', tag: '手机' }
    ]
  };

  App.register({
    id: 'notodo',
    name: '今天不做什么',
    tagline: '每天只禁止一件事',
    desc: '反向清单，比自律更轻松',
    badge: '每日',
    group: '反内耗',
    accent: 'magenta',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M6.6 17.4 17.4 6.6"/>',

    render(root) {
      let items = [];
      let today = App.todayKey();
      let timers = [];
      let destroyed = false;

      const wrap = App.el(
        '<div class="page page-notodo">' +
          '<div id="ntCard"></div>' +

          '<div class="panel" style="margin-top:14px">' +
            '<h3 class="panel-title">使用规则</h3>' +
            '<p class="panel-hint">' +
              '每天只抽一件事。抽到之后就当它是今天唯一的禁令——' +
              '不需要完成什么，只需要不做它。做到了就打个卡，没做到也没关系，明天还有新的。' +
            '</p>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">禁止清单 <span class="panel-hint" id="ntPoolInfo"></span></h3>' +
            '<div class="notodo-pool" id="ntPool"></div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const cardBox = wrap.querySelector('#ntCard');
      const poolBox = wrap.querySelector('#ntPool');
      const poolInfo = wrap.querySelector('#ntPoolInfo');

      function later(fn, ms) {
        const id = setTimeout(() => { if (!destroyed) fn(); }, ms);
        timers.push(id);
        return id;
      }

      /* ---------------- 本地记录 ---------------- */
      function getRecord() {
        const rec = App.storage.get('notodo:today', null);
        if (rec && rec.date === today && rec.text) return rec;
        return null;
      }

      function saveRecord(rec) {
        App.storage.set('notodo:today', rec);
        // 历史天数：仅用于统计连续/累计天数
        const days = App.storage.get('notodo:days', []);
        if (days.indexOf(today) === -1) {
          days.push(today);
          App.storage.set('notodo:days', days.slice(-400));
        }
      }

      function isDone() {
        const done = App.storage.get('notodo:done', []);
        return done.indexOf(today) !== -1;
      }

      function markDone() {
        const done = App.storage.get('notodo:done', []);
        if (done.indexOf(today) === -1) {
          done.push(today);
          App.storage.set('notodo:done', done.slice(-400));
        }
      }

      /** 连续天数：从今天往前推，遇到缺失的一天就停 */
      function streakDays() {
        const days = App.storage.get('notodo:days', []);
        const set = {};
        days.forEach((d) => { set[d] = true; });
        let streak = 0;
        const cursor = new Date();
        for (let i = 0; i < 400; i++) {
          const key = App.todayKey(cursor);
          if (set[key]) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
          } else {
            break;
          }
        }
        return streak;
      }

      /* ---------------- 抽签 ---------------- */
      function draw(reason) {
        const picked = items[App.randInt(items.length)];
        const rec = {
          date: today,
          text: picked.text,
          why: picked.why || '',
          tag: picked.tag || '',
          at: Date.now(),
          reroll: ((getRecord() || {}).reroll || 0) + 1
        };
        saveRecord(rec);
        paintCard(rec, true);
        paintPool(rec);
        if (reason === 'reroll') {
          App.sfx.pop();
          App.haptic.tap();
        } else {
          App.sfx.ding();
          App.haptic.land();
        }
      }

      /* ---------------- 卡片渲染 ---------------- */
      function paintCard(rec, animate) {
        const done = isDone();
        const streak = streakDays();
        const days = App.storage.get('notodo:days', []);

        cardBox.innerHTML =
          '<div class="notodo-card' + (animate ? ' pop-in' : '') + '">' +
            '<span class="ban-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="M6.6 17.4 17.4 6.6"/></svg></span>' +
            '<p class="notodo-label">今 日 禁 止</p>' +
            '<p class="notodo-rule">抽到就照做，今天不做这件事</p>' +
            '<p class="notodo-text" id="ntText">' + App.esc(rec.text) + '</p>' +
            (rec.why ? '<p class="panel-hint" style="max-width:26em;margin:0 auto 14px">' + App.esc(rec.why) + '</p>' : '') +
            '<p class="notodo-date">' + App.esc(rec.date) + (rec.tag ? ' · ' + App.esc(rec.tag) : '') +
              (done ? ' · <span style="color:var(--lime)">已打卡 ✓</span>' : '') +
            '</p>' +

            '<div class="btn-row" style="margin-top:18px">' +
              '<button type="button" class="btn ' + (done ? 'btn-ghost' : 'btn-primary') + '" id="ntDone" ' + (done ? 'disabled' : '') + '>' +
                (done ? '今天已打卡' : '今天做到了') +
              '</button>' +
              '<button type="button" class="btn btn-ghost" id="ntReroll">换一个</button>' +
            '</div>' +

            '<div class="notodo-stats">' +
              '<div class="notodo-stat"><b>' + streak + '</b><span>连续天数</span></div>' +
              '<div class="notodo-stat"><b>' + days.length + '</b><span>累计天数</span></div>' +
              '<div class="notodo-stat"><b>' + ((rec.reroll || 1) - 1) + '</b><span>今天换过</span></div>' +
            '</div>' +
          '</div>';

        // 换一个：需要一次显式确认，避免「随便换」让这个工具失去意义
        cardBox.querySelector('#ntReroll').addEventListener('click', async () => {
          const ok = await App.modal({
            title: '确定要换一个吗',
            text: '今天的禁令已经定下来了。换掉它，通常不是因为抽得不好，而是因为不想做。',
            buttons: [
              { label: '不换，就它了', value: false },
              { label: '还是换一个吧', value: true, kind: 'ghost' }
            ]
          });
          if (ok === true) draw('reroll');
        });

        const doneBtn = cardBox.querySelector('#ntDone');
        if (doneBtn && !done) {
          doneBtn.addEventListener('click', () => {
            markDone();
            App.sfx.ding();
            App.haptic.land();
            App.celebrate({ particleCount: 58, spread: 76, origin: { x: 0.5, y: 0.34 } });
            App.toast('打卡成功，明天见');
            paintCard(rec, false);
          });
        }
      }

      /* ---------------- 清单渲染 ---------------- */
      function paintPool(rec) {
        poolInfo.textContent = items.length + ' 项';
        poolBox.innerHTML = items
          .map((it) => {
            const hit = rec && it.text === rec.text;
            return '<div class="notodo-pool-row' + (hit ? ' is-hit' : '') + '">' +
              (hit ? '<span>▍</span>' : '') +
              '<span>' + App.esc(it.text) + '</span>' +
            '</div>';
          })
          .join('');
        if (rec) {
          const hitNode = poolBox.querySelector('.is-hit');
          // offsetTop 是相对最近的定位祖先，这里换算成相对滚动容器再留一点上边距
          if (hitNode) poolBox.scrollTop = Math.max(0, hitNode.offsetTop - poolBox.offsetTop - 56);
        }
      }

      /* ---------------- 初始化 ---------------- */
      App.loadData('data/notodo.json', FALLBACK).then((json) => {
        if (destroyed) return;
        items = ((json && json.items) || FALLBACK.items).filter((i) => i && i.text);
        if (!items.length) items = FALLBACK.items;

        const rec = getRecord();
        if (rec) {
          // 同一天刷新：结果不变，不做入场动画
          paintCard(rec, false);
          paintPool(rec);
        } else {
          // 新的一天：自动抽取，带一次弹出 + 抖动动画
          paintPool(null);
          draw('auto');
          later(() => {
            const card = cardBox.querySelector('.notodo-card');
            if (card) {
              card.classList.remove('pop-in');
              card.classList.add('shake');
            }
          }, 420);
        }
      });

      return function cleanupNotodo() {
        destroyed = true;
        timers.forEach(clearTimeout);
        timers = [];
      };
    }
  });
})();
