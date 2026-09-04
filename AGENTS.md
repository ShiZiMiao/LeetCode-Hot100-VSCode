# AGENTS.md

本文件为 AI 辅助编码代理（agent）在 `Hot100-for-VSCode` 仓库中工作时提供指导。

## 项目概览

一款 VS Code 扩展，用于刷 LeetCode Hot 100 题目。功能包括：浏览题目列表、查看题目描述与题解、编写多种语言代码、在线测试/提交、本地调试。

- **原仓库**：`https://github.com/Imzhou-tju/Hot100-for-VSCode`（MIT，原作者）
- **当前仓库（fork 修复版）**：`https://github.com/ShiZiMiao/LeetCode-Hot100-VSCode`
- **当前版本**：`0.1.4`
- **技术栈**：TypeScript、Node.js（>=16）、VS Code Extension API（>=1.107）、pnpm
- **运行时依赖**：`marked`（仅用于 webview 场景，实际通过 CDN 加载）

## 常用命令（Windows 环境）

本机 Node 装在受保护目录 `C:\Program Files\nodejs`，全局 npm/pnpm 工具装在用户目录：`C:\Users\lecoo\AppData\Roaming\npm`。用 bash 调用时需把该目录加入 `PATH`：

```bash
# 编译
PATH="$APPDATA/npm:$PATH" pnpm run compile

# 监听编译（开发调试用）
PATH="$APPDATA/npm:$PATH" pnpm run watch

# lint
PATH="$APPDATA/npm:$PATH" pnpm run lint

# 安装依赖
PATH="$APPDATA/npm:$PATH" pnpm install
```

> 注意：本环境为 `win32` 但 Shell 是 `bash`。PowerShell 专用命令（如 `Get-ChildItem`）不可用；路径中的反斜杠在 bash 中需转义或用 `workdir` 参数，绝对 Windows 路径建议 `D:/code/lc/...` 形式。

## 打包 VSIX

`vsce` 是打包工具（本机装在用户全局目录 `C:\Users\lecoo\AppData\Roaming\npm`）。**它不是项目依赖**，本仓库 `package.json` 中不含 `@vscode/vsce`，勿把它加入 devDependencies（会污染 lockfile）。

```bash
PATH="/c/Users/lecoo/AppData/Roaming/npm:$PATH" \
  vsce package --out Hot100-for-VSCode.vsix --no-dependencies --skip-license
```

### 打包必备步骤

1. **SVG 被 vsce 拦截**：`README.md` 中包含 `<img src="resources/leetcode.svg">`，vsce 会禁止打包。打包前需先从 README 移除该 SVG 图片块，打包后再恢复（用 `git checkout README.md` 恢复）。
2. **`--no-dependencies` 必须加**：否则 vsce 内部会运行 `npm install` 做依赖检查，与 pnpm 的 `node_modules/.pnpm` 布局冲突，报大量 `missing` 错误。
3. **`--skip-license` 需加**：项目 `LICENSE` 文件与 vsce 校验冲突时会拒绝打包。

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

## 核心架构

```
src/
├── extension.ts          扩展入口，注册全部命令与 webview 渲染逻辑（主体）
├── core/
│   ├── authManager.ts    Cookie 会话管理（存在 context.secrets）
│   └── leetcodeApi.ts    LeetCode GraphQL 封装（https://leetcode.cn/graphql）
├── data/
│   └── hot100Data.ts     Hot 100 题目静态数据
├── views/
│   └── hot100Provider.ts TreeView 数据提供者
├── utils/
│   ├── debugUtils.ts     本地调试文件生成
│   ├── languageUtils.ts  语言检测/文件扩展名
│   └── webviewUtils.ts   题解 Webview HTML 生成
├── commands/
│   └── solutionCommands.ts  题解命令（目前未被主流程使用/基本是死代码）
└── test/
    └── extension.test.ts
```

### 登录/认证

- 登录命令收集 `LEETCODE_SESSION` 与 `csrftoken`，组装为 `Cookie` 存入 `context.secrets`（不落盘）。
- 请求时由 `leetcodeApi.getHeaders()` 读取 Cookie，并自动从 Cookie 提取 `csrftoken` 注入 `x-csrftoken` 请求头。
- 用 `getUserProfile()` 的 `userStatus.isSignedIn` 校验是否登录成功。

## 已知重要约束与坑（务必知晓）

1. **官方题解不含代码**：`getOfficialSolution` 返回的内容只有文字 + `<iframe src="https://leetcode.cn/playground/...">`，代码全部藏在 playground iframe 内。**LeetCode 公共 GraphQL 只暴露 playground 的 uuid，不暴露源码**。因此无法直接把官方题解的代码抓成代码块。

2. **iframe 登录页问题**：在 VS Code webview 内，跨域 iframe（`https://leetcode.cn/playground/...`）加载时不携带会话 Cookie，会被 LeetCode 重定向成登录页。`sanitizeSolutionContent()` 会把这些 iframe 整块移除。

3. **题解代码的来源**：`question.solution` 的 content 只有文字 + playground iframe，代码抓不到；真正带完整代码的题解是社区题解文章（`getSolutionArticles` → `getSolutionArticle`），其中 `byLeetcode: true` 的**官方文章**（如 `liang-shu-zhi-he-by-leetcode-solution`）包含官方的完整多语言代码（markdown 围栏 ` ```Java [sol1-Java]` 之类），且始终排在 `MOST_UPVOTE` 前 10 内。

4. **webview 渲染的可靠性**：早期实现依赖 webview 里 CDN 加载的 `marked`（新版可能 API 变化/加载失败）和脚本执行顺序（`processCodeTabs` 定义在页面底部，早期内联代码块脚本可能先于其执行），容易导致代码不渲染。**当前方案** `renderMarkdownToHtml()` 直接在扩展端（TypeScript）完成完整 Markdown → 静态 HTML 渲染（标题/列表/表格/图片/代码块等），不依赖 CDN marked，确保内容一定能显示。`codeMode: 'preferred'` 时相邻的多语言代码块按优先级（Python3/Python → C/C++ → 其他）只保留一种语言（用于官方题解）；`'all'` 时保留全部语言并生成标签页（用于社区题解）。

5. **`marked` 依赖**：`package.json` 里保留了 `marked` 依赖，但主流程（extension.ts）已不 `require` 也不在 webview 加载它（只 `webviewUtils.ts` 死代码还引用 CDN）。不要误以为需要打包 `node_modules`。

6. **社区题解/pk检查脚本**：答题解析、注入若依赖外部 API，注意 `leetcodeApi.ts` 中 GraphQL 的字段名（如 `codeSnippets` 含 `lang`、`langSlug`、`code`）。

## 题解页数据流（当前实现）

`loadSolution` 消息处理中：
1. `getOfficialSolution` → 官方题解文字（回退用，`sanitizeSolutionContent` 移除 iframe）。
2. `getSolutionArticles` → 社区题解列表（可点击逐篇查看）。
3. **官方题解（含代码）**：取 `byLeetcode: true` 的官方文章全文，用 `renderMarkdownToHtml(content, 'preferred')` 渲染（每个解法只显示一种优先语言）。
4. **社区精选题解（含代码）**：取最高赞的非官方社区题解全文，用 `renderMarkdownToHtml(content, 'all')` 渲染（保留全部语言标签页）。

## 调试方式（开发模式）

项目已内置 VS Code 调试配置：
- `.vscode/launch.json`：`Run Extension`（按 `F5` 启动扩展开发主机，独立窗口加载扩展，加载 `out/` 实时产物）。
- `.vscode/tasks.json`：`watch` 编译作为默认前置任务，改 `src/*.ts` 保存即自动重新编译，开发主机窗口 `Ctrl+R` 重载生效。

## 语言优先级（曾实现、现已移除）

曾为用户定制的"代码模板"功能（`selectPreferredSnippet`）已按要求**移除**。若需加固题解代码展示，直接复用 `renderMarkdownToHtml`，勿恢复模板代码区块。