# 抛给宇宙 · 随机决策工具箱

移动端优先的随机决策单页应用（SPA）。纯静态文件，零构建步骤：**HTML + CSS + 原生 JavaScript**，核心逻辑无第三方依赖（仅一个可选视觉效果插件），可直接部署到 Vercel 免费套餐。

> 一句话定位：把选择抛出去，把自己还给自己。

## 功能一览

| 分组 | 工具 | 说明 |
| --- | --- | --- |
| 让命运回答 | 答案之书 | 225 条答案、10 个分类；闭眼默念 3 秒 → 3D 翻页揭晓 |
| 让命运回答 | 大转盘 | Canvas 轮盘，扇区文字/颜色/权重可编辑；可重命名、可导出/导入 JSON 配置、4 个预设场景 |
| 纯随机 | 抛硬币 | CSS 3D 翻转，正反面统计 |
| 纯随机 | 掷骰子 | CSS 3D 立方体，1~3 颗，带合计与大小单双；支持摇一摇手机 |
| 纯随机 | 盲盒抽签 | 洗牌后抽取，支持不重复抽签、批量抽取 |
| 纯随机 | 随机时钟 | 5 秒倒计时倒逼法，空格 / 点击叫停 |
| 反内耗 | 假装硬币 | 反向心理学：抛完追问你的真实感受 |
| 反内耗 | 今天不做什么 | 每天随机禁止一件事，按日期缓存，可打卡 |

结果都能「带走」：所有工具的结果下方提供**复制结果 / 系统分享**（`navigator.share` → 剪贴板 → 手动复制三级降级）。

## 目录结构

```
.
├── index.html            # 入口：只放骨架容器，页面由 JS 渲染
├── css/style.css         # 全部样式（流体令牌 / 组件 / 各模块 / 响应式 / 无障碍）
├── js/
│   ├── app.js            # 内核：随机数、存储、音效、震动、Toast、弹窗、分享、庆祝、路由
│   ├── answers.js        # 模块一：答案之书
│   ├── wheel.js          # 模块二：大转盘（含配置导入导出）
│   ├── coin-dice.js      # 模块三：硬币 + 骰子（含摇一摇）
│   ├── blindbox.js       # 模块三之二：盲盒抽签
│   ├── reverse-coin.js   # 模块四：假装硬币（并暴露 App.reverseAsk 给硬币复用）
│   ├── countdown.js      # 模块五：随机时钟
│   └── todo-list.js      # 模块六：今天不做什么
├── data/
│   ├── answers.json      # 答案之书题库（225 条）
│   └── notodo.json       # 「今天不做什么」候选清单（44 条）
├── vendor/
│   └── canvas-confetti.min.js   # 可选插件：结果庆祝粒子（MIT，10.8KB）
├── icons/                # PWA 图标（脚本生成）+ favicon.svg
├── tools/
│   ├── make_icons.py     # 生成 PNG 图标
│   ├── smoke-test.js     # 功能自检：逐页截图 + 采集控制台报错
│   └── mobile-audit.js   # 移动端审计：8 种视口 × 9 条路由的溢出与触控检查
├── manifest.json         # PWA 配置
├── sw.js                 # Service Worker（离线可用）
└── vercel.json           # 缓存策略 / rewrite / 安全响应头
```

## 本地预览

Service Worker 与 `fetch()` 都需要 HTTP 环境（`file://` 会走内置兜底数据，但 PWA 不生效）：

```bash
python3 -m http.server 5173
# 打开 http://127.0.0.1:5173
```

自检（需要本机安装 Chrome）：

```bash
node tools/smoke-test.js   http://127.0.0.1:5173   # 功能 + 控制台
node tools/mobile-audit.js http://127.0.0.1:5173   # 移动端适配审计
```

`mobile-audit.js` 会在 320×568 / 360×640 / 375×667 / 390×844 / 414×896 / 430×932 / 740×360（横屏）/ 768×1024 共 8 种视口下遍历全部路由，检查三件事：

1. **横向溢出**：`documentElement.scrollWidth` 是否超过视口宽度，越界时逐个列出元素（含 left/right/width）；
2. **触控目标**：所有可点元素的命中区域是否小于 44px（Apple HIG / WCAG 建议值）；
3. **运行时报错**：控制台 error、未捕获异常、HTTP ≥ 400。

小屏视口会触发真实交互（翻书、转盘、抛硬币、抽签……），因为部分溢出只在结果渲染之后才暴露。有溢出或报错时退出码为 1，可直接用来卡发布。

## 部署到 Vercel

**方式一：CLI（推荐）**

```bash
npm i -g vercel
vercel --prod        # 首次运行会引导登录并关联项目，结束后输出生产 URL
```

**方式二：Vercel Drop**：打开 vercel.com/drop，把整个项目文件夹拖进浏览器。

**方式三：GitHub 自动部署**：推送到 GitHub 仓库后在 Vercel 导入，之后每次 push 自动部署。

> Hobby 计划每月 100GB 带宽、100 万次函数调用、6000 分钟构建，个人项目足够；仅限非商业用途，含广告或商业推广需升级 Pro。

## 数据维护

- `data/answers.json`：`answers[]` 每项为 `{ "text": "答案", "category": "分类 id" }`，`text` 建议不超过 14 字（大字排版）。新增分类时同步补 `categories[]`。
- `data/notodo.json`：`items[]` 每项为 `{ "text": "禁止项", "why": "一句揭示成本的话", "tag": "标签" }`。
- 两个文件都无法加载时，对应模块会退化为内置兜底数据，工具本身不会失效。
- 转盘选项不必手改代码：在页面里改完点「导出配置」即可拿到 JSON，换设备用「导入配置」恢复。

## 移动端适配要点

| 关注点 | 做法 |
| --- | --- |
| 字号 / 间距 | 全部用 `clamp()` 流体令牌（`--fs-hero` / `--fs-result` / `--gutter` 等），随视口连续缩放，不做阶梯式跳变 |
| 横向溢出 | 根元素 `overflow-x: hidden` 只是兜底；真正的手段是网格 `minmax(0, 1fr)`、flex 子项 `min-width: 0`、文本 `overflow-wrap: anywhere`，长选项 / 长答案也撑不破容器 |
| 触控目标 | 按钮 / Tab / 图标按钮 / chip / 分段控件 / 输入框统一 ≥ 44px |
| iOS 输入框缩放 | 所有输入控件字号 ≥ 16px，避免聚焦时页面被自动放大 |
| 刘海与手势条 | `env(safe-area-inset-*)` 参与容器内边距与底部导航高度 |
| 小屏 ≤ 400px / ≤ 340px | 骰子边长通过 `--dice` 变量整体缩小（六面 `translateZ` 由 `--dice-half` 推导，JS 不参与像素计算）；扇区编辑器隐藏概率列 |
| 横屏矮屏 | 压缩顶栏与卡片留白，`--tab-h` 降到 52px，主内容不被底部导航顶住 |
| 触屏手感 | `touch-action: manipulation`（去掉双击缩放延迟）、去除点击高亮、`prefers-reduced-motion` 时关闭全部动画 |
| 页面切换 | 优先使用原生 View Transitions API，不支持的浏览器回退到 CSS 动画 |

## 可选插件与原生能力

| 能力 | 实现 | 降级策略 |
| --- | --- | --- |
| 结果庆祝粒子 | `vendor/canvas-confetti.min.js`（MIT，10.8KB，本地 vendor + Service Worker 预缓存） | 未加载 / 系统开启「减弱动态效果」→ `App.celebrate()` 直接返回，功能不受影响 |
| 系统分享 | `navigator.share` | 不支持 → 剪贴板 → 剪贴板不可用 → 手动复制弹窗 |
| 摇一摇掷骰 | `DeviceMotion`（iOS 需在用户手势内申请权限） | 无传感器 / 权限被拒 / 1.6 秒内收不到事件流 → 自动关闭开关并提示，按钮照常可用 |
| 页面转场 | View Transitions API | 不支持 → CSS `page-enter` 动画 |
| 音效 | Web Audio 实时合成，无音频文件 | 无 AudioContext → 静默跳过 |

## 参考的同类开源项目与借鉴点

| 项目 | 借鉴的做法 |
| --- | --- |
| [cherkasovaa/decision-making-tool](https://github.com/cherkasovaa/decision-making-tool)（TypeScript + Canvas） | 加权选项语义、**选项列表 JSON 导入导出**、可选音效开关 |
| [wangling-miao/LuckyWheel](https://github.com/wangling-miao/LuckyWheel)（Vue 3 + Canvas） | **转盘可重命名**、历史记录 + 清空、localStorage 持久化 |
| [lepari23/SpinToDecide](https://github.com/lepari23/SpinToDecide)（原生 Canvas） | 极简交互路径：输入选项 → 转盘 → 结果，移动端优先 |
| [michaelsboost/DecisionWheel](https://github.com/michaelsboost/DecisionWheel)（Alpine + GSAP） | **canvas-confetti 结果庆祝**、神秘风格的视觉基调 |
| [tadyPi/decision-spinner](https://github.com/tadyPi/decision-spinner)（React + Tailwind） | 干净无广告的界面层级、持久化选项、统一的线性图标风格 |

## 实现要点

- **随机**：统一走 `crypto.getRandomValues()`（`Math.random()` 仅作降级），权重抽取用累计权重法，`weight` 是真实概率而非视觉假象——转盘先按权重定中奖扇区，再反推旋转角度。
- **不重复抽签**：Fisher-Yates 洗牌后顺序取用，而非每次独立随机。
- **震动**：能力检测 + 用户手势门控（未发生真实手势前不调用，避免控制台报 No user activation）。iOS Safari 不支持则静默降级。
- **路由**：hash 路由（`#/book`），每页返回清理函数，切换时取消 rAF / 定时器 / ResizeObserver / 设备传感器监听。
- **离线**：Service Worker 预缓存全部静态资源（含 vendor 插件），导航请求网络优先、断网回退首页缓存；改 `sw.js` 的 `VERSION` 即触发旧缓存清理。
- **无障碍**：主要按钮 ≥ 44×44px；键盘可用空格 / 回车 / Esc；尊重 `prefers-reduced-motion`。
