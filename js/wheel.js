/* =========================================================================
   模块二：大转盘 / 轮盘选择
   渲染：Canvas 2D 手写（不引第三方库，保证离线可用与零构建）
   概率：每个扇区带相对权重 weight，按权重抽取中奖扇区后再反推旋转角度，
        因此「停在哪个扇区」与权重严格一致，而不是靠视觉假象。
   预设：中午吃什么 / 周末去哪 / 谁买单；支持自定义扇区并保存到本地。
   ========================================================================= */
(function () {
  'use strict';

  const PALETTE = [
    '#8b5cf6', '#22e1ff', '#ff3ea5', '#ffb020', '#b6ff3b', '#ff6b6b',
    '#4f8cff', '#00d6a3', '#c084fc', '#f472b6', '#38bdf8', '#facc15'
  ];

  const MAX_SEGMENTS = 12;
  const MIN_SEGMENTS = 2;

  const TEMPLATES = {
    lunch: {
      name: '中午吃什么',
      segments: [
        { label: '黄焖鸡', weight: 2 },
        { label: '麻辣烫', weight: 1 },
        { label: '轻食沙拉', weight: 1 },
        { label: '螺蛳粉', weight: 3 },
        { label: '沙县小吃', weight: 1 },
        { label: '便利店', weight: 1 },
        { label: '楼下快餐', weight: 1 },
        { label: '随便点外卖', weight: 2 }
      ]
    },
    weekend: {
      name: '周末去哪',
      segments: [
        { label: '公园', weight: 2 },
        { label: '电影院', weight: 1 },
        { label: '咖啡馆', weight: 2 },
        { label: '博物馆', weight: 1 },
        { label: '健身房', weight: 1 },
        { label: '爬山', weight: 1 },
        { label: '逛超市', weight: 1 },
        { label: '在家躺平', weight: 3 }
      ]
    },
    pay: {
      name: '谁买单',
      segments: [
        { label: '我买', weight: 1 },
        { label: '你买', weight: 1 },
        { label: 'AA', weight: 3 },
        { label: '猜拳决定', weight: 2 },
        { label: '下次再说', weight: 2 }
      ]
    },
    kpi: {
      name: '今天先做哪件',
      segments: [
        { label: '写周报', weight: 2 },
        { label: '回邮件', weight: 1 },
        { label: '改需求', weight: 1 },
        { label: '开会', weight: 1 },
        { label: '先摸鱼', weight: 3 },
        { label: '准时下班', weight: 2 }
      ]
    }
  };

  function makeSegments(list) {
    return list.map((s, i) => ({
      label: s.label,
      weight: Math.max(0, Number(s.weight) || 0),
      color: PALETTE[i % PALETTE.length]
    }));
  }

  App.register({
    id: 'wheel',
    name: '大转盘',
    tagline: '把选项丢给概率，谁也别争',
    desc: '自定义扇区与权重，公平决定',
    badge: '可编辑',
    group: '让命运回答',
    accent: 'cyan',
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v8.5l6.4 4.9"/>',

    render(root) {
      const saved = App.storage.get('wheel:segments', null);
      let segments = (Array.isArray(saved) && saved.length >= MIN_SEGMENTS)
        ? makeSegments(saved)
        : makeSegments(TEMPLATES.lunch.segments);
      let rotation = 0;
      let spinning = false;
      let rafId = 0;
      let destroyed = false;
      let history = App.storage.get('wheel:history', []);
      let activeTemplate = App.storage.get('wheel:template', 'lunch');
      let title = App.storage.get('wheel:title', TEMPLATES.lunch.name);

      const wrap = App.el(
        '<div class="page page-wheel">' +
          '<h2 class="wheel-title" id="whTitleBar"></h2>' +
          '<div class="wheel-stage">' +
            '<div class="wheel-canvas-wrap" id="whWrap">' +
              '<div class="wheel-pointer" aria-hidden="true"></div>' +
              '<canvas id="whCanvas" role="img" aria-label="选择转盘"></canvas>' +
              '<button type="button" class="wheel-hub" id="whHub" aria-label="开始旋转">开始</button>' +
            '</div>' +
          '</div>' +
          '<div id="whResult" style="margin-bottom:14px"></div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">转盘名称</h3>' +
            '<input class="input" id="whTitle" type="text" maxlength="16" placeholder="给这个转盘起个名字" />' +
            '<p class="panel-hint" style="margin-top:8px">名称会显示在转盘上方，也会写进导出的配置文件。</p>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">预设场景 <span class="panel-hint">点一下就切换</span></h3>' +
            '<div class="templates" id="whTemplates"></div>' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">扇区设置 <span class="panel-hint" id="whSummary"></span></h3>' +
            '<div id="whEditor"></div>' +
            '<div class="seg-row" style="margin-top:12px">' +
              '<input class="input" id="whNewLabel" type="text" maxlength="14" placeholder="新增一项，如：吃火锅" />' +
              '<button type="button" class="btn btn-ghost" id="whAdd" style="min-height:40px;padding:0 14px">添加</button>' +
            '</div>' +
            '<div class="btn-row" style="margin-top:10px">' +
              '<button type="button" class="btn btn-ghost" id="whReset">恢复该场景</button>' +
              '<button type="button" class="btn btn-ghost" id="whExport">导出配置</button>' +
              '<button type="button" class="btn btn-ghost" id="whImport">导入配置</button>' +
              '<button type="button" class="btn btn-ghost" id="whClearHistory">清空历史</button>' +
            '</div>' +
            '<input type="file" id="whImportFile" accept="application/json,.json" hidden />' +
          '</div>' +

          '<div class="panel">' +
            '<h3 class="panel-title">最近结果</h3>' +
            '<div class="history-list" id="whHistory"></div>' +
          '</div>' +
        '</div>'
      );
      root.appendChild(wrap);

      const canvasWrap = wrap.querySelector('#whWrap');
      const canvas = wrap.querySelector('#whCanvas');
      const hub = wrap.querySelector('#whHub');
      const resultBox = wrap.querySelector('#whResult');
      const editor = wrap.querySelector('#whEditor');
      const summary = wrap.querySelector('#whSummary');
      const tplBox = wrap.querySelector('#whTemplates');
      const historyBox = wrap.querySelector('#whHistory');
      const ctx = canvas.getContext('2d');
      const titleInput = wrap.querySelector('#whTitle');
      const titleBar = wrap.querySelector('#whTitleBar');

      let size = 320;          // CSS 像素下的直径

      /** 名称同时出现在转盘上方与输入框里，两处一起改 */
      function paintTitle() {
        titleBar.textContent = title || '';
        titleBar.style.display = title ? '' : 'none';
        if (titleInput.value !== title) titleInput.value = title;
      }

      /* ---------------- 尺寸与绘制 ---------------- */
      function resize() {
        // 三重约束：容器宽度 / 绝对上限 340 / 视口宽度的 72%，最后用 180 兜底，
        // 保证 320px 这类小屏既不会溢出，也不会小到看不清扇区文字。
        const usable = Math.max(200, canvasWrap.parentElement.clientWidth - 8);
        const cap = Math.min(usable, 340);
        const fluid = Math.min(cap, Math.max(220, window.innerWidth * 0.72));
        size = Math.max(180, Math.floor(fluid));
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        canvas.width = Math.floor(size * dpr);
        canvas.height = Math.floor(size * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
      }

      function totalWeight() {
        return segments.reduce((sum, s) => sum + Math.max(0, s.weight), 0);
      }

      function draw() {
        const cx = size / 2;
        const cy = size / 2;
        const R = size / 2 - 3;
        ctx.clearRect(0, 0, size, size);

        const total = totalWeight();
        const n = segments.length;
        // 字体随扇区数量收缩
        const fs = Math.max(10.5, Math.min(16, (size * 0.062) - n * 0.55));

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);

        let a0 = -Math.PI / 2;   // 从正上方开始
        segments.forEach((seg) => {
          const w = Math.max(0, seg.weight);
          const span = total > 0 ? (w / total) * Math.PI * 2 : (Math.PI * 2) / n;
          if (span <= 0) { a0 += span; return; }

          // 扇形
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R, a0, a0 + span);
          ctx.closePath();
          ctx.fillStyle = seg.color;
          ctx.fill();

          // 分隔线
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(11,11,22,0.55)';
          ctx.stroke();

          // 文字（沿半径方向排版）
          const mid = a0 + span / 2;
          let label = String(seg.label || '');
          if (label.length > 12) label = label.slice(0, 11) + '…';
          ctx.save();
          ctx.rotate(mid);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.font = '700 ' + fs.toFixed(1) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
          // 扇形太窄时把文字压得更小，避免溢出到邻区
          const usable = Math.max(18, R - 16 - Math.max(0, fs * 0.9));
          if (ctx.measureText(label).width > usable) {
            ctx.font = '700 ' + (fs * 0.78).toFixed(1) + 'px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
          }
          ctx.fillStyle = 'rgba(11,11,22,0.92)';
          ctx.fillText(label, R - 13, 0);
          ctx.restore();

          a0 += span;
        });

        ctx.restore();

        // 外圈装饰
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.stroke();
      }

      /** 当前指针（正上方）指向的扇区下标 */
      function indexAtPointer(rot) {
        const total = totalWeight();
        const n = segments.length;
        if (total <= 0) return 0;
        const norm = ((-rot) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); // 0 = 正上方，顺时针
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const span = (Math.max(0, segments[i].weight) / total) * Math.PI * 2;
          if (norm >= acc && norm < acc + span) return i;
          acc += span;
        }
        return n - 1;
      }

      /* ---------------- 旋转 ---------------- */
      function spin() {
        if (spinning) return;
        if (segments.length < MIN_SEGMENTS) {
          App.toast('至少要有两个选项');
          App.sfx.warn();
          return;
        }
        if (totalWeight() <= 0) {
          App.toast('权重不能全为 0');
          App.sfx.warn();
          return;
        }

        spinning = true;
        wrap.querySelector('.wheel-canvas-wrap').classList.add('is-spinning');
        hub.textContent = '…';
        resultBox.innerHTML = '<div class="result-box pulse"><p class="result-label">正在旋转</p><p class="result-value">？</p></div>';
        App.sfx.whoosh();
        App.haptic.tap();

        // 1. 先按权重定中奖扇区（保证权重语义为真实概率）
        const idx = App.weightedIndex(segments.map((s) => s.weight));
        const total = totalWeight();
        let acc = 0;
        for (let i = 0; i < idx; i++) acc += Math.max(0, segments[i].weight);
        const span = (Math.max(0, segments[idx].weight) / total) * Math.PI * 2;
        const mid = ((acc + Math.max(0, segments[idx].weight) / 2) / total) * Math.PI * 2;

        // 2. 扇区内随机偏移，避免每次都停在正中显得假
        const jitter = (App.rand() - 0.5) * span * 0.6;

        // 3. 反推目标角度：让该扇区中点落在指针（正上方）处
        const twoPi = Math.PI * 2;
        const want = -(mid + jitter);
        const current = ((rotation % twoPi) + twoPi) % twoPi;
        let delta = ((want - current) % twoPi + twoPi) % twoPi;
        const spins = App.randRange(4, 8);
        const from = rotation;
        const to = rotation + spins * twoPi + delta;
        const duration = 4200 + App.randInt(900);
        const t0 = performance.now();
        let lastTick = 0;
        let lastIdx = indexAtPointer(from);

        function easeOutQuart(t) {
          return 1 - Math.pow(1 - t, 4);
        }

        function frame(now) {
          if (destroyed) return;
          const p = Math.min(1, (now - t0) / duration);
          rotation = from + (to - from) * easeOutQuart(p);
          draw();

          // 经过扇区边界时发出「咔哒」声，最长 28ms 一次，避免噪音堆积
          const cur = indexAtPointer(rotation);
          if (cur !== lastIdx) {
            lastIdx = cur;
            if (now - lastTick > 28) {
              lastTick = now;
              App.sfx.tick();
            }
          }

          if (p >= 1) {
            finish(segments[idx]);
            return;
          }
          rafId = requestAnimationFrame(frame);
        }
        rafId = requestAnimationFrame(frame);
      }

      function finish(seg) {
        spinning = false;
        canvasWrap.classList.remove('is-spinning');
        hub.textContent = '再转';
        App.sfx.ding();
        App.haptic.land();

        resultBox.innerHTML =
          '<div class="result-box pop-in">' +
            '<p class="result-label">' + App.esc(title || '转盘决定') + '</p>' +
            '<p class="result-value">' + App.esc(seg.label) + '</p>' +
          '</div>';
        // 结果可带走：复制 / 系统分享（getText 延迟取值，切结果无需重绑）
        resultBox.appendChild(App.shareRow(
          () => (title ? title + '：' : '') + seg.label + '　—— 来自「抛给宇宙」',
          { title: '抛给宇宙 · ' + (title || '大转盘') }
        ));
        App.celebrate({ origin: { x: 0.5, y: 0.5 }, particleCount: 80 });

        // 记录历史
        const t = new Date();
        const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
        history.unshift({ label: seg.label, time: time });
        history = history.slice(0, 12);
        App.storage.set('wheel:history', history);
        paintHistory();
      }

      /* ---------------- 编辑器 ---------------- */
      function paintSummary() {
        const total = totalWeight();
        summary.textContent = segments.length + ' 项 · 权重合计 ' + total;
      }

      function paintPercent() {
        const total = totalWeight();
        editor.querySelectorAll('[data-pct]').forEach((node) => {
          const i = Number(node.dataset.pct);
          const w = Math.max(0, segments[i].weight);
          node.textContent = total > 0 ? ((w / total) * 100).toFixed(w === 0 ? 0 : (total > 0 && (w / total) * 100 < 10 ? 1 : 0)) + '%' : '—';
        });
      }

      function paintEditor() {
        editor.innerHTML = '';
        segments.forEach((seg, i) => {
          const row = App.el(
            '<div class="seg-row">' +
              '<span class="list-idx">' + (i + 1) + '</span>' +
              '<span class="swatch" data-color="' + i + '" style="background:' + seg.color + '" title="点击换颜色"></span>' +
              '<input class="input" data-label="' + i + '" type="text" maxlength="14" value="' + App.esc(seg.label) + '" aria-label="第 ' + (i + 1) + ' 项文字" />' +
              '<input class="input seg-weight" data-weight="' + i + '" type="number" min="0" max="99" step="1" value="' + seg.weight + '" aria-label="第 ' + (i + 1) + ' 项权重" />' +
              '<span class="list-idx" data-pct="' + i + '" style="width:40px">—</span>' +
              '<button type="button" class="seg-del" data-del="' + i + '" aria-label="删除第 ' + (i + 1) + ' 项">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
              '</button>' +
            '</div>'
          );
          editor.appendChild(row);
        });
        paintSummary();
        paintPercent();
      }

      editor.addEventListener('input', (e) => {
        const labelInput = e.target.closest('[data-label]');
        const weightInput = e.target.closest('[data-weight]');
        if (labelInput) {
          segments[Number(labelInput.dataset.label)].label = labelInput.value;
          draw();
        } else if (weightInput) {
          const i = Number(weightInput.dataset.weight);
          const v = Math.max(0, Math.min(99, Number(weightInput.value) || 0));
          segments[i].weight = v;
          draw();
          paintSummary();
          paintPercent();
        }
        persist();
      });

      editor.addEventListener('click', (e) => {
        const sw = e.target.closest('[data-color]');
        const del = e.target.closest('[data-del]');
        if (sw) {
          const i = Number(sw.dataset.color);
          const cur = PALETTE.indexOf(segments[i].color);
          segments[i].color = PALETTE[(cur + 1) % PALETTE.length];
          sw.style.background = segments[i].color;
          App.sfx.tick();
          draw();
          persist();
        } else if (del) {
          if (segments.length <= MIN_SEGMENTS) {
            App.toast('至少保留 2 个选项');
            App.sfx.warn();
            return;
          }
          segments.splice(Number(del.dataset.del), 1);
          App.sfx.click();
          App.haptic.tap();
          paintEditor();
          draw();
          persist();
        }
      });

      function addSegment() {
        const input = wrap.querySelector('#whNewLabel');
        const label = (input.value || '').trim();
        if (!label) {
          App.toast('先写点什么');
          App.sfx.warn();
          input.focus();
          return;
        }
        if (segments.length >= MAX_SEGMENTS) {
          App.toast('最多 ' + MAX_SEGMENTS + ' 个选项');
          App.sfx.warn();
          return;
        }
        if (segments.some((s) => s.label === label)) {
          App.toast('已经有这一项了');
          App.sfx.warn();
          return;
        }
        segments.push({ label: label, weight: 1, color: PALETTE[segments.length % PALETTE.length] });
        input.value = '';
        App.sfx.pop();
        App.haptic.tap();
        paintEditor();
        draw();
        persist();
        input.focus();
      }

      wrap.querySelector('#whAdd').addEventListener('click', addSegment);
      wrap.querySelector('#whNewLabel').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addSegment();
      });

      function persist() {
        App.storage.set('wheel:segments', segments.map((s) => ({ label: s.label, weight: s.weight, color: s.color })));
        App.storage.set('wheel:title', title);
      }

      /* ---------------- 配置导入 / 导出 ----------------
         参考同类项目的常见做法：把选项列表变成可备份、可分享的 JSON 文件，
         换设备或清空浏览器数据后也能一键恢复。导出内容带 app/type/version 字段，
         方便以后做兼容判断。 */
      function exportConfig() {
        const data = {
          app: '抛给宇宙',
          type: 'wheel',
          version: 1,
          title: title,
          segments: segments.map((s) => ({ label: s.label, weight: s.weight, color: s.color })),
          exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '抛给宇宙-转盘-' + (title || '未命名') + '-' + App.todayKey().replace(/-/g, '') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        App.sfx.pop();
        App.haptic.tap();
        App.toast('配置已导出为 JSON 文件');
      }

      function importConfig(file) {
        if (!file) return;
        if (file.size > 256 * 1024) {
          App.toast('文件过大，请确认是本工具导出的配置');
          App.sfx.warn();
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          let data = null;
          try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
          const list = data && Array.isArray(data.segments) ? data.segments : null;
          if (!list) {
            App.toast('不是有效的转盘配置');
            App.sfx.warn();
            return;
          }

          const cleaned = list
            .filter((x) => x && typeof x.label === 'string' && x.label.trim())
            .slice(0, MAX_SEGMENTS)
            .map((x, i) => ({
              label: x.label.trim().slice(0, 14),
              weight: Math.max(0, Math.min(99, Math.round(Number(x.weight) || 0))),
              color: /^#[0-9a-fA-F]{3,8}$/.test(String(x.color || '')) ? String(x.color) : PALETTE[i % PALETTE.length]
            }));

          if (cleaned.length < MIN_SEGMENTS) {
            App.toast('配置里至少要有两个有效选项');
            App.sfx.warn();
            return;
          }
          // 权重全为 0 时按等概率处理，避免转盘画不出来
          if (cleaned.every((x) => x.weight === 0)) cleaned.forEach((x) => { x.weight = 1; });

          segments = cleaned;
          if (typeof data.title === 'string' && data.title.trim()) {
            title = data.title.trim().slice(0, 16);
            App.storage.set('wheel:title', title);
            paintTitle();
          }
          rotation = 0;
          resultBox.innerHTML = '';
          App.sfx.ding();
          App.haptic.land();
          paintEditor();
          draw();
          persist();
          App.toast('已导入 ' + cleaned.length + ' 个选项');
        };
        reader.onerror = () => {
          App.toast('读取文件失败，请重试');
          App.sfx.warn();
        };
        reader.readAsText(file);
      }

      /* ---------------- 预设模板 ---------------- */
      function paintTemplates() {
        tplBox.innerHTML = '';
        Object.keys(TEMPLATES).forEach((key) => {
          const t = TEMPLATES[key];
          const btn = App.el(
            '<button type="button" class="chip' + (key === activeTemplate ? ' is-active' : '') + '" data-tpl="' + key + '">' +
              App.esc(t.name) +
            '</button>'
          );
          btn.addEventListener('click', () => applyTemplate(key));
          tplBox.appendChild(btn);
        });
      }

      function applyTemplate(key) {
        const t = TEMPLATES[key];
        if (!t) return;
        activeTemplate = key;
        App.storage.set('wheel:template', key);
        segments = makeSegments(t.segments);
        title = t.name;
        App.storage.set('wheel:title', title);
        paintTitle();
        rotation = 0;
        resultBox.innerHTML = '';
        App.sfx.pop();
        App.haptic.tap();
        paintTemplates();
        paintEditor();
        draw();
        persist();
        App.toast('已切换到「' + t.name + '」');
      }

      wrap.querySelector('#whReset').addEventListener('click', () => applyTemplate(activeTemplate));

      titleInput.addEventListener('input', () => {
        title = titleInput.value.slice(0, 16);
        titleBar.textContent = title;
        titleBar.style.display = title ? '' : 'none';
        persist();
      });

      wrap.querySelector('#whExport').addEventListener('click', exportConfig);

      const importInput = wrap.querySelector('#whImportFile');
      wrap.querySelector('#whImport').addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', () => {
        importConfig(importInput.files && importInput.files[0]);
        importInput.value = '';      // 允许连续导入同一个文件
      });

      /* ---------------- 历史 ---------------- */
      function paintHistory() {
        if (!history.length) {
          historyBox.innerHTML = '<p class="panel-hint">还没有结果，转一次就有了。</p>';
          return;
        }
        historyBox.innerHTML = history
          .map((h) => '<div class="history-item"><span>' + App.esc(h.label) + '</span><time>' + App.esc(h.time) + '</time></div>')
          .join('');
      }

      wrap.querySelector('#whClearHistory').addEventListener('click', () => {
        history = [];
        App.storage.set('wheel:history', history);
        paintHistory();
        App.toast('历史已清空');
      });

      /* ---------------- 事件绑定 ---------------- */
      hub.addEventListener('click', spin);
      canvas.addEventListener('click', spin);

      let ro = null;
      if (window.ResizeObserver) {
        ro = new ResizeObserver(() => resize());
        ro.observe(canvasWrap.parentElement);
      } else {
        window.addEventListener('resize', resize);
      }

      paintTitle();
      paintTemplates();
      paintEditor();
      paintHistory();
      resize();

      return function cleanupWheel() {
        destroyed = true;
        cancelAnimationFrame(rafId);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', resize);
      };
    }
  });
})();
