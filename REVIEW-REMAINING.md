# 发版前审查遗留项（未做清单）

> 来源：2026-09-23 发版前全面审查（64 项）修复后的如实遗留。全部为**低/中严重度的可读性与小工程项，无功能影响**；
> 高危与功能/安全问题已在当日全部修复并回归（compile/lint/单测 110/Hot 100 审计 100/100）。
> 每项标注：程度 | 位置 | 建议。完成一项勾一项。

## 一、重构类（中；建议单独 PR，避免淹没功能 diff）

- [ ] **[中] `activate()` 完整拆分** — `src/extension.ts`（activate 已从 ~1960 行净减至 ~1500 行：viewSolution 支线删除、test/submit 合并为 `runJudgeFlow`、孤儿注释清理；但未做完整的 `registerJudgeCommands`/`registerLoginCommand` 子注册函数化）
  建议：按域拆出子注册函数或独立 `commands/` 模块，依赖以显式参数传递。
- [ ] **[中] 模块级全局状态对象化** — `src/extension.ts`（`problemPanels`/`pendingProblemOpens`/`customCaseFiles`/`solutionHtmlCache`/`ffmpegCorePromise`/`sessionExpiredNotifiedAt` 仍为模块级；`solutionPanels`/`pendingSolutionOpens` 已随 viewSolution 移除）
  建议：收敛为 `activate` 持有的 `PanelManager`/`JudgeSession` 对象，便于多实例与测试。
- [ ] **[中] `generatePanelHtml` 资源拆分** — `src/views/problemPanel.ts`（双份高亮 CSS 已合并、语言优先级已收口；但 ~1300 行 HTML/CSS/webview 脚本仍在单一模板字符串内）
  建议：CSS 与 webview 脚本拆独立 `.tmpl`/资源模块，函数只做数据拼装（可让脚本被语法工具链检查）。
- [ ] **[低] 全文格式化** — 全仓（本次刻意未跑：5000 行 diff 会淹没审查修复）
  建议：单独 PR 一次性格式化并保持（统一 tab/缩进层级，extension.ts 1545-1700、problemPanel 模板体历史上缩进错乱）。

## 二、类型与命名（低）

- [ ] **[低] `videoDebug` 消息改联合类型** — `src/shared/webviewMessages.ts:15`、`src/extension.ts`（videoDebug 分支）、`src/views/problemPanel.ts` webview 脚本（3 处 postMessage）
  现状：`info: string` 靠子串嗅探 `'AUDIO_PROBLEM'/'AUDIO_DIAG'` 分流。建议：`{ kind: 'audioProblem' | 'audioDiag' | 'log'; detail: string }`。
- [ ] **[低] 残余 magic number** — `src/extension.ts`（转码输出下限 `1024`×2、视频 uuid 正则 `{20,40}`、`runCustomCaseWith` 超时文案"90 秒"单点未接 `JUDGE_POLL_BUDGET_MS`）
  建议：提命名常量，文案与常量同源（判题轮询预算已导出 `JUDGE_POLL_BUDGET_MS` 可复用）。
- [ ] **[低] `getProblemCodeEditor` 拆两步** — `src/extension.ts`（名为 getter 但会打开并抢焦点；`viewSubmissions` 等只要路径的调用方被迫焦点跳动）
  建议：拆为"解析路径"与"显示编辑器"两步，仅判题命令做显示。

## 三、健壮性收尾（低）

- [ ] **[低] `shellQ` 接入终端命令拼接** — `src/extension.ts`（`runDebug` 快速运行分支）：转义函数已定义但 ~10 处 `runCommand`/`runSteps` 模板串仍直接双引号拼路径（引号/反引号/`$` 可注入终端，属自伤面）
  建议：路径统一走 `shellQ()`，或改用任务 API 替代字符串拼接。
- [ ] **[低] `release.mjs` 发布脚本收尾** — `scripts/release.mjs`：`--dry-run` 仍写系统临时文件（95-96 行缺 `if (!DRY)`）；`git add` 硬编码清单为误导性死路径（88 行，建议 `git add -u`）；`git push` 成功而 `gh release create` 失败的半发布态无补救提示（`run()` 裸抛）
  建议：`run()` try/catch 走 `fail()` 并打印恢复命令。
- [ ] **[低] `src/test/extension.test.ts` 换真实冒烟** — 现为 vscode-test 脚手架 `Sample test`（断言 `indexOf`，永不执行；产物进包问题已由 `.vscodeignore` 的 `out/test/**` 解决）
  建议：替换为"激活扩展 + 命令注册存在"的最小冒烟，或删除。
- [ ] **[低] eslint 接入 recommended + `no-unused-vars`** — `eslint.config.mjs`（现仅 5 条手写规则；死代码类问题的直接成因）
  建议：接入 `typescript-eslint` recommended，`no-unused-vars` 设 error。

## 四、发布工程（低）

- [ ] **[低] README/MARKETPLACE 同步 CI 校验** — 两文件正文须一致（仅 README 文末 fork 块例外），现靠人工约定
  建议：CI 加"除文末 fork 块外 diff 为空"检查步。
- [ ] **[低] 打包杂项排除复核** — `.vscodeignore` 已补 `out/test/**`、`.idea/**`、`*.log`、`**/.DS_Store`、`**/Thumbs.db`、`dist/**`、本文件；如有新增根目录杂项记得同处登记。

## 有意保留（勿"修复"）

- **publish-marketplace.yml 的发布步保持 `@vscode/vsce@next`**：`publish --oidc` 仅存在于 next 系列（3.9.3 系列，需 Node ≥22），钉 stable 会直接断发布（AGENTS 2026-09-10 实测结论）。打包步已钉 `@vscode/vsce@3.9.3`。
- **`statusOf`/`matchesStatusFilter` 的 `| string` 宽入参**：容忍 globalState 历史脏值是既有测试语义（"未知状态串按未做处理"），有意保留并已补注释。

## 待人工验证（无头环境测不到）

webview 真实交互与 F5 真机流程：① 打开题目→切题解/刷新；② 复制代码按钮、多语言标签页；③ 带官方动画帧的题解（如 21 题官方文章，验证旧格式动画与帧 URL）；④ 测试/提交各一次；⑤ 「查看题解」命令（现进面板题解页）；⑥ 视频题解倍速/音量。发现问题发截图/输出即可。
