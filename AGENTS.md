# AGENTS.md

本文件为 AI 辅助编码代理（agent）在 `Hot100-for-VSCode` 仓库中工作时提供指导。

## 项目概览

一款 VS Code 扩展，用于刷 LeetCode Hot 100 题目。功能包括：浏览题目列表、查看题目描述与题解、编写多种语言代码、在线测试/提交、本地调试。

- **原仓库**：`https://github.com/Imzhou-tju/Hot100-for-VSCode`（MIT，原作者）
- **当前仓库（fork 修复版）**：`https://github.com/ShiZiMiao/LeetCode-Hot100-VSCode`
- **当前版本**：`0.1.10`
- **技术栈**：TypeScript、Node.js（>=16）、VS Code Extension API（>=1.107）、pnpm
- **运行时依赖**：`playwright-core`（登录一键浏览器功能，`require` 走 `vendor/playwright-core/` 副本）。**打包不经过 node_modules**（vsce 带 `--no-dependencies`），vendor 副本须先同步（见打包步骤）；历史死依赖 `marked` 已移除。webview 渲染全部扩展端自研 + 本地 vendor 资源。

## 常用命令（Windows 环境）

本机 Node 装在受保护目录 `C:\Program Files\nodejs`，全局 npm/pnpm 工具装在用户目录：`C:\Users\lecoo\AppData\Roaming\npm`。用 bash 调用时需把该目录加入 `PATH`：

```bash
# 编译
PATH="$APPDATA/npm:$PATH" pnpm run compile

# 监听编译（开发调试用）
PATH="$APPDATA/npm:$PATH" pnpm run watch

# lint
PATH="$APPDATA/npm:$PATH" pnpm run lint

# 纯逻辑单测（需先 compile；CI 同款，见 .github/workflows/ci.yml：lint+compile+单测）
PATH="$APPDATA/npm:$PATH" pnpm run test:unit

# 安装依赖
PATH="$APPDATA/npm:$PATH" pnpm install
```

> 注意：本环境为 `win32` 但 Shell 是 `bash`。PowerShell 专用命令（如 `Get-ChildItem`）不可用；路径中的反斜杠在 bash 中需转义或用 `workdir` 参数，绝对 Windows 路径建议 `D:/code/lc/...` 形式。

## 打包 VSIX

`vsce` 是打包工具（本机装在用户全局目录 `C:\Users\lecoo\AppData\Roaming\npm`）。**它不是项目依赖**，本仓库 `package.json` 中不含 `@vscode/vsce`，勿把它加入 devDependencies（会污染 lockfile）。

```bash
PATH="/c/Users/lecoo/AppData/Roaming/npm:$PATH" \
  vsce package --out Hot100-for-VSCode.vsix --no-dependencies --skip-license --readme-path MARKETPLACE.md
```

### 打包必备步骤

1. **`--no-dependencies` 必须加**：否则 vsce 内部会运行 `npm install` 做依赖检查，与 pnpm 的 `node_modules/.pnpm` 布局冲突，报大量 `missing` 错误。
2. **`--skip-license` 需加**：项目 `LICENSE` 文件与 vsce 校验冲突时会拒绝打包。
3. **`--readme-path MARKETPLACE.md` 必须加**：两个插件商店（VS Code Marketplace / Open VSX）展示的详情页内容取自 VSIX 内的 readme 资产。`README.md`（仓库首页用）在文末带一行 fork 归属声明；`MARKETPLACE.md` 是不含任何 fork 说明的商店专用版本。vsce 的 ReadmeProcessor 按此选项匹配文件名生成 `Content.Details` 资产——**不加该参数会退回 README.md，把 fork 声明带上商店**。CI 的 package 步已加。改 README 正文时记得同步 MARKETPLACE.md。
4. ~~打包前需删除 README 的 SVG 图片块~~：已修复，`README.md` 现在引用 `resources/hot100-pro.png`（Marketplace 不渲染 SVG），不再需要打包前的临时改动。
5. 其他仓库根目录的临时文件（如 `__pycache__/`、`*.tmp_*.js`）会被 vsce 打进 VSIX，打包前确认 `git status` 只有预期的改动。
6. **打包前同步 `vendor/playwright-core/`**（登录一键浏览器功能的运行时库，VSIX 走它而非 node_modules）：playwright-core 版本变化后重新拷贝——`lib/ index.js index.mjs package.json browsers.json LICENSE NOTICE ThirdPartyNotices.txt` 拷入 `vendor/playwright-core/`，随后**只删除 `lib/vite/` 与 `lib/tools/`**（trace/UI 资产，进程内 launch 不加载，省约 4MB）；`lib/entry/`、`lib/server/` 等其余 lib 内容必须保留。`types/`、`bin/`、`index.d.ts` 不用拷（bin 是 CLI 与捆绑 node，进程内 API 不经过它；已实测裁剪后的 vendor 副本可正常拉起系统 Edge）。`tsconfig.json` 已 `exclude: vendor`，别让 tsc 去编译第三方包。

打包后在本地安装测试：

```bash
code --install-extension "D:/code/lc/Hot100-for-VSCode/Hot100-for-VSCode.vsix" --force
```

## 关键的仓库约定

- **提交与发布需用户明确指示**：除非用户明确说"提交/发布/发版"，否则**不要** `git commit`、不要 `git push`、不要创建 GitHub Release。源码改动允许，但只保留在工作区。
- **版本号**：不要在每次修改时递增版本号。仅在用户明确要求发版时才调整。
- **git remote**：`origin` 指向 `ShiZiMiao/LeetCode-Hot100-VSCode`。发布用 `gh`（已登录 `ShiZiMiao`，repo 权限）。
- **`.gitignore` 已忽略**：`out/`、`node_modules/`、`*.vsix`、`dist/`。VSIX 不应提交，走 GitHub Releases 资产。
- **发布方式**：`gh release create v0.x.y --title "..." --notes "..." Hot100-for-VSCode.vsix`（仓库公开，资产可匿名下载）。
- **Marketplace 自动同步**：`.github/workflows/publish-marketplace.yml` 在 GitHub Release 发布后自动打包并上传 VS Code Marketplace（`ShiZiMiao.leetcode`），用 OIDC 可信发布（`vsce publish --oidc`），**无需 PAT / Azure DevOps**。前置条件：在 https://marketplace.visualstudio.com/manage 的发布者设置中为 `ShiZiMiao.leetcode` 配置 Trusted Publishing 信任策略（关联本仓库与 publish-marketplace.yml 工作流；GitHub Actions 作为受信任来源）。注意：**GitHub Release 前必须先把 package.json 版本号提到对应版本**，Marketplace 同步的是 package.json 里的版本。
- **OIDC 可信发布现状（2026-09-10 实测）**：CLI 侧已就绪——`publish --oidc` 仅存在于 `@vscode/vsce@next`（3.9.3 系列，需 Node ≥22；latest 3.9.2 没有），且该选项被上游 `hideHelp()` 隐藏（PR #1291 实现、#1297 隐藏 help），**用 `--help` 验证会误判为不存在，需读源码**。工作流已切 `@vscode/vsce@next` + `node-version: 22`。**但 Marketplace 服务端未实现**：2026-09-10 用测试分支手动触发 workflow_dispatch 实测，GitHub Actions OIDC token 获取成功，但凭证交换请求 `https://marketplace.visualstudio.com/_apis/gallery/token` 返回 **404**（controller 不存在）；服务端 issue（microsoft/vscode-vsce#1275）仍 open，维护者 2026-08 称"可能 9 月左右提供"，Marketplace 管理端（publisher 的 Extensions/Details/Members、扩展 hub 的 Manage）也**没有 Trusted Publishing 配置入口**。→ 在端点上线并在管理端配好信任策略之前，**CI 的 publish 步必然失败（属预期），发布继续走手动网页上传**：Marketplace 管理页 → 扩展条目 → 上传本地 `vsce package` 产物（`D:/code/lc/Hot100-for-VSCode/Hot100-for-VSCode.vsix`，同版本可覆盖）。

  **网页上传必须由用户手动完成（2026-09-10 实测自动化三路全封死）**：① IAB 与 Tabbit 的 CDP 运行时都拒绝 `DOM.setFileInputFiles`（"Not allowed"，即 filechooser.setFiles 也不可用）；无 filechooser 监听时点击上传区也不会弹系统文件框；② 管理页 CSP `connect-src` 白名单不含本地回环地址，页面内 fetch+DataTransfer 注入文件被 CSP 拒绝（实测 "Failed to fetch"；route 剥 CSP 响应头会引发全请求拦截挂起、任务被 quarantine，勿再尝试）。→ 上传那一步固定交给用户：打开管理页 → New extension → **Visual Studio Code**（注意是下拉菜单）→ 选择 VSIX 文件 → Upload。上传前把 VSIX 拷到 `C:\Users\lecoo\Downloads`。
- **Open VSX 同步发版**（`ShiZiMiao.leetcode`，与 Marketplace 并行；0.1.7 起已打通）。一次性前置已全部完成，无需再做：① open-vsx.org 用 GitHub（ShiZiMiao）登录；② Eclipse 账号（用户名 shizimiao）与 GitHub 已在 accounts.eclipse.org 的 **Link GitHub Account** 页双向绑定（注意资料页的 GitHub Username 字段只读，必须走 linked-accounts 绑定，否则 open-vsx 报 "Eclipse profile is missing a GitHub username"）；③ 已在 open-vsx.org Profile 页签署 Open VSX Publisher Agreement；④ 命名空间 `ShiZiMiao` 已用 `ovsx create-namespace` 创建。
  发新版的步骤：
  1. 生成 Access Token：open-vsx.org → 头像 → Access Tokens → Generate new token（浏览器有登录态，值一次性显示）。
  2. 发布：`PATH="/c/Users/lecoo/AppData/Roaming/npm:$PATH" OVSX_PAT=<token> ovsx publish Hot100-for-VSCode.vsix`（`ovsx` CLI v1.1.1 已全局装好；命名空间/协议就绪后无需 `-p` 之外的其他参数）。
  3. 新扩展首次发布会进入 **"Under review"**，约 1~2 分钟自动通过后 API/搜索/下载才可查。用 `curl --ssl-no-revoke https://open-vsx.org/api/ShiZiMiao/leetcode/latest` 验证。
  注意：VSIX 的 `publisher`/`name` 必须与已建命名空间一致（`ShiZiMiao` / `leetcode`）。token 可随时在 Access Tokens 页 Delete all 吊销。

## 核心架构

```
src/
├── extension.ts          扩展入口，注册全部命令与判题/调试/面板编排（0.2.0 模块化后主体）
├── core/
│   ├── authManager.ts    Cookie 会话管理（存在 context.secrets）
│   ├── browserLogin.ts   浏览器一键登录（playwright-core 走 vendor 副本，驱动系统 Edge/Chrome 临时 profile 读 Cookie）
│   └── leetcodeApi.ts    LeetCode GraphQL 封装（https://leetcode.cn/graphql）
├── data/
│   └── hot100Data.ts     Hot 100 题目静态数据
├── views/
│   ├── hot100Provider.ts TreeView 数据提供者（按分类/按难度分组、刷题统计节点、每日一题入口、状态筛选/错题复习队列/收藏分组、列表元数据展示与本地收藏，判题结果经 recordJudgeResult 实时更新；分组方式/打卡日期/收藏集/今日已复习存 globalState）
│   └── problemPanel.ts   题面/题解 webview：generatePanelHtml + Markdown 渲染器全家（公式/动画播放器/代码高亮）+ 图片本地化 + 播放器资源
├── judgeFeedback.ts      判题反馈（上报/输出通道/编辑器诊断/状态栏/在途锁/pollJudgeResult 轮询）
├── shared/
│   └── webviewMessages.ts webview ↔ 扩展消息协议类型（webview 端是模板字符串 JS，只能靠类型做扩展端校验与文档）
├── utils/                （judgeReport/problemText/loginCookie/networkRetry/progressStats/wrongQueue/htmlUtil/difficultyGroups/studyStats/questionOrder/metaFormat 为无 vscode 依赖的纯逻辑，src/unit 单测覆盖）
│   ├── debugUtils.ts     本地调试文件生成（Python 驱动含原地入参比对 + pydevd 自排除注册）
│   ├── judgeReport.ts    判题报告纯逻辑（逐用例分组 / 提交场景汇总回退 / 逐用例结构化信息提取）
│   ├── problemText.ts    题面期望输出提取、文件名身份解析
│   ├── loginCookie.ts    登录 Cookie 组装（裸值拼装 / 整段粘贴自动拆分）
│   ├── networkRetry.ts   瞬时网络故障与重试幂等判定纯逻辑
│   ├── progressStats.ts  刷题进度统计/状态筛选纯逻辑
│   ├── wrongQueue.ts     错题回顾队列纯逻辑（去重/排序/限量/时间格式化）
│   ├── htmlUtil.ts       escapeHtml/errMsg/formatArticleDate 共用工具
│   └── languageUtils.ts  语言检测/文件扩展名（仅 python3，leetcode.cn 的 'python' slug 是 Python 2 判题环境，勿加回）
├── unit/                 纯逻辑单测（node:test，不依赖 vscode；`pnpm run test:unit` 运行编译产物）
└── test/
    └── extension.test.ts （vscode-test 集成测试，glob 只匹配 out/test/**，勿把单测文件放进去）
```

> `scripts/release.mjs`（`pnpm release <version>`）是发版自动化脚本（tsconfig 已 exclude scripts），临时脚本不要放在 src/ 下。

### 登录/认证

- **一键自动登录（主路径）**：登录 webview 的「打开浏览器自动登录」→ `core/browserLogin.ts` 先探**系统默认浏览器**（`detectDefaultBrowser`：win32 读 `HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice` 的 ProgId、linux 走 `xdg-settings`；仅 Edge/Chrome 可驱动，Firefox/Tabbit 等归 other）→ 默认不可用/不可驱动时回退 `pickChromiumChannel`（已装 Edge→Chrome 顺序）并提示原因 → playwright-core（`vendor/playwright-core`，按需 require）以**全新隔离临时 profile** 打开 leetcode.cn 登录页 → 用户完成登录（密码/验证码/扫码/GitHub 均可）→ 1.5s 轮询 `context.cookies('leetcode.cn')` 直到 `LEETCODE_SESSION`+`csrftoken` 齐全（预算 10 分钟）→ finally 关浏览器+删临时目录。注意：临时 profile 与用户日常浏览器数据完全隔离，无法复用日常浏览器里已登录的会话（v20 App-Bound 所封），登录一次即取走。
- **风控现状与应对（2026-09-14）**：LeetCode 登录页接了腾讯验证码（t.captcha.qq.com），会检测自动化浏览器环境——账号密码/滑块路径在受控窗口可能「安全验证失败，请刷新」。已做的缓解：launch 加官方参数 `--disable-blink-features=AutomationControlled`（消除 `navigator.webdriver` 标记，实测有效但**不保证**过深度探测）+ `--test-type`（抑制浏览器对敏感标记弹的"不受支持的命令行标记"黄色警告条，Selenium 同款标准做法，不影响 webdriver 隐藏）+ `chromiumSandbox: true`（Playwright 默认 false 会注入 `--no-sandbox` 触发警告条且真实降低安全性；带沙箱启动失败时自动无沙箱降级重试一次）+ 状态行与面板文案引导改用 **App 扫码登录**（不经过滑块组件，成功率最高，用户实测登录成功）。**不要**继续往更深的反检测对抗发展（伪造指纹/隐藏 CDP 等属风控对抗红线，商店审核与用户信任都过不去）；扫码仍失败的用户走手动整段 Cookie 粘贴。**不做**"读浏览器本地 Cookie 数据库"：Windows 上 Edge/Chrome 127+ 的 Cookie 值全是 v20 App-Bound 加密，第三方进程解密已被系统封堵（亦属恶意软件手法，勿再尝试）。用户关闭登录面板会经 `isAborted` 联动关闭浏览器窗口。
- **手动粘贴（兜底）**：`LEETCODE_SESSION` 与 `csrftoken` 两列裸值或整段 Cookie（`utils/loginCookie.ts` 按键名自动拆分），组装为 `Cookie` 存入 `context.secrets`（不落盘）。
- 两条路径共用 `completeLogin`：`setCookie` → `getUserProfile` 验证 `userStatus.isSignedIn` → 失败 `logout()`。登录 webview 支持把**整段 Cookie 粘贴到任一输入框**，由 `utils/loginCookie.ts` 的 `buildLeetCodeCookie` 按键名自动拆分。
- 会话过期主动检测：HTTP 401 或响应 `status_code===1002` 时触发 `LeetCodeApi.onSessionExpired` → `notifySessionExpired()`（10 分钟限频 toast）；activate 时对已存 Cookie 后台校验一次 `userStatus.isSignedIn`。轮询判题遇 1002 直接抛错终止，不傻等 90 秒。
- 请求时由 `leetcodeApi.getHeaders()` 读取 Cookie，并自动从 Cookie 提取 `csrftoken` 注入 `x-csrftoken` 请求头。
- 用 `getUserProfile()` 的 `userStatus.isSignedIn` 校验是否登录成功。

## 已知重要约束与坑（务必知晓）

1. **官方题解不含代码**：`getOfficialSolution` 返回的内容只有文字 + `<iframe src="https://leetcode.cn/playground/...">`，代码全部藏在 playground iframe 内。**LeetCode 公共 GraphQL 只暴露 playground 的 uuid，不暴露源码**。因此无法直接把官方题解的代码抓成代码块。

2. **iframe 登录页问题**：在 VS Code webview 内，跨域 iframe（`https://leetcode.cn/playground/...`）加载时不携带会话 Cookie，会被 LeetCode 重定向成登录页。`sanitizeSolutionContent()` 会把这些 iframe 整块移除。

3. **题解代码的来源**：`question.solution` 的 content 只有文字 + playground iframe，代码抓不到；真正带完整代码的题解是社区题解文章（`getSolutionArticles` → `getSolutionArticle`），其中 `byLeetcode: true` 的**官方文章**（如 `liang-shu-zhi-he-by-leetcode-solution`）包含官方的完整多语言代码（markdown 围栏 ` ```Java [sol1-Java]` 之类），且始终排在 `MOST_UPVOTE` 前 10 内。

4. **官方题解动画帧有两种格式（2026-09 实测）**：旧格式 `![1200](url),...`（alt=帧停留毫秒数）；当前文章（如第 21 题）是 `<![fig1](url),...,![figN](url)>`——alt 为 `figN`、外层 `<![...]>` 包裹、尾部裸 `>`（渲染时先经 htmlToMarkdown 剥 `<![` 前缀，escapeHtml 后尾部变 `&gt;`）。`renderInlineMarkdown` 的动画正则已同时兼容两种（非数字 alt 取默认 1200ms）。新接入题的官方文章如出现平铺帧序列，先核对正文格式。
5. **刷新题解卡死死循环的根因（2026-09 实测定位）**：VS Code webview 对**内容完全相同的 `panel.webview.html` 再次赋值不触发导航**（iframe src 未变、DOM 保留）——刷新重建的页面与首次加载字节级一致，赋值被吞、页面停在刷新按钮写的「加载题解中」占位符。配套机制：① `generatePanelHtml` 每次生成带唯一 nonce 注释（`lc-nonce:*`），保证任何赋值必然导航；② `extension.ts` 的 `solutionHtmlCache`（会话内，key=titleSlug）——刷新先立即渲染缓存、后台重取，内容与缓存一致时跳过二次赋值防闪屏；③ 首次加载整体 60s 超时（`withTimeout`，超时后内部流程不打断、晚到结果自愈覆盖页面）；④ 加载步骤打点（fetch list/official article/community pick/localize/done）输出到扩展控制台。改任何"重建 webview 页面"的路径（题解重取/文章打开/题目描述刷新）都必须经过 `generatePanelHtml` 拿到新 nonce，切勿手动拼接页面。
6. **webview 渲染的可靠性**：早期实现依赖 webview 里 CDN 加载的 `marked`（新版可能 API 变化/加载失败）和脚本执行顺序（`processCodeTabs` 定义在页面底部，早期内联代码块脚本可能先于其执行），容易导致代码不渲染。**当前方案** `renderMarkdownToHtml()` 直接在扩展端（TypeScript）完成完整 Markdown → 静态 HTML 渲染（标题/列表/表格/图片/代码块等），不依赖 CDN marked，确保内容一定能显示。`codeMode: 'all'` 时保留全部语言并生成标签页（`preferredFirst` 时优先语言 Python3/Python → C/C++ → 其他 排首位并默认选中，用于官方题解，接近网页版切换体验；社区题解保持原文顺序）；`'preferred'` 时只保留优先语言（用于 question.solution 文字回退）。KaTeX 公式为 webview 内 CDN 可选增强（加载失败不影响内容显示）；highlight.js（`vendor/highlight.min.js`，GitHub 明/暗配色由页面脚本按主题亮度切换 CSS 变量）为本地资源随扩展打包，题解代码语法高亮不依赖网络。注意 `.vscodeignore` 排除了 `src/**`，本地资源必须放 `vendor/` 或 `out/` 才会进 VSIX。视频题解先尝试内嵌 `<video>`（`https://video.leetcode.cn/{资产id}.mp4`），若 CDN 防盗链拒绝（video 元素触发 error）自动降级为浏览器播放入口。

7. **运行时依赖现状**：唯一运行时依赖是 `playwright-core`（登录），运行时 `require(context.extensionPath + '/vendor/playwright-core')`，打包走 vendor 副本（见打包步骤第 6 条），VSIX 始终不含 node_modules。历史死依赖 `marked` 已于 0.1.9 移除（主流程不 require、webview 不加载），勿再加回。
8. **TLS 证书校验为严格模式（0.1.9 起恢复）**：所有 https 请求不再 `rejectUnauthorized: false`。代理空闲切断导致的瞬断由"超时 + `agent:false` 禁复用 + `isTransientNetworkError` 幂等重试"兜底（判定表见 `utils/networkRetry.ts` 单测）。若用户环境有 MITM 代理导致证书报错，会透出原始错误信息，不要重新关闭校验。
9. **判题在途忙碌锁与轮询预算**：`judgeInFlight` 全局锁防测试/提交并发（`tryBeginJudge` 占位、withProgress 回调 finally 释放）；`pollJudgeResult` 退避轮询（1s 起 ×1.5 封顶 5s，预算 ~90s），期间状态栏 `judgeStatusBar` 显示已等待秒数。新增判题类命令务必复用这套，不要另起 while 循环。

10. **社区题解/pk检查脚本**：答题解析、注入若依赖外部 API，注意 `leetcodeApi.ts` 中 GraphQL 的字段名（如 `codeSnippets` 含 `lang`、`langSlug`、`code`）。

11. **社区文章正文行尾**：部分社区题解文章（如《动画》系列）正文使用 `\r\n` 行尾，`renderMarkdownToHtml` 渲染前必须 `replace(/\r\n?/g, '\n')` 归一化，否则围栏代码块/标题匹配失败会显示原始 Markdown。

12. **视频题解**：官方文章里的 `![xxx.mp4](资产id)` 指向 `video.leetcode.cn` 内部 CDN（防盗链+登录态，裸访问 403），webview 无法内嵌播放（与 playground iframe 同理）。已渲染为"播放视频题解"按钮，点击经 `openExternal` 消息在系统浏览器打开官方题解页。

## 题解页数据流（当前实现）

`loadSolution` 消息处理中：
1. `getOfficialSolution` → 官方题解文字（回退用，`sanitizeSolutionContent` 移除 iframe）。
2. `getSolutionArticles` → 社区题解列表（可点击逐篇查看）。
3. **官方题解（含代码）**：取 `byLeetcode: true` 的官方文章全文，用 `renderMarkdownToHtml(content, 'all', true)` 渲染（多语言代码标签页，优先语言默认选中）。
4. **社区精选题解（含代码）**：取最高赞的非官方社区题解全文，用 `renderMarkdownToHtml(content, 'all')` 渲染（保留全部语言标签页）。

## 判题失败用例与自定义用例

- **失败用例本地调试**：判题失败后 toast 附「本地调试失败用例」按钮（命令 `leetcode.debugFailedCase`），把失败用例的输入/期望写入调试驱动再启动本地调试；多失败用例时 QuickPick 选择。期望值只传该用例（不掺入题面示例索引对齐），复用 `runDebugWithCases`（与 `leetcode.debug` 共用，已含 Python 驱动/非 Python 模板文案分支）。
- **自定义用例在线测试**：命令 `leetcode.customTest` 生成 `<题解目录>/debug/customcase_{id}_{slug}.txt`（每行一个 JSON 参数值，与 `data_input` 格式一致；文件名以字母开头，`parseProblemFileName` 不会误解析），编辑后 Ctrl+S 自动 runCode 判题——保存钩子按 `customCaseFiles` 路径登记表匹配，只对扩展创建的用例文件生效；同题再次运行命令可立即重跑当前内容。
- 逐用例信息由 `collectJudgeCaseInfos`（judgeReport.ts 纯逻辑）从判题响应提取，测试/提交/自定义用例共用，与 raw 响应一起缓存在模块级 `lastJudgeCases`（含 titleSlug 防串题校验）。

## 调试方式（开发模式）

项目已内置 VS Code 调试配置：
- `.vscode/launch.json`：`Run Extension`（按 `F5` 启动扩展开发主机，独立窗口加载扩展，加载 `out/` 实时产物）。
- `.vscode/tasks.json`：`watch` 编译作为默认前置任务，改 `src/*.ts` 保存即自动重新编译，开发主机窗口 `Ctrl+R` 重载生效。

## 语言优先级（曾实现、现已移除）

曾为用户定制的"代码模板"功能（`selectPreferredSnippet`）已按要求**移除**。若需加固题解代码展示，直接复用 `renderMarkdownToHtml`，勿恢复模板代码区块。