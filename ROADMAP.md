# 后续路线规划

> 裁决原则：用户高频触点优先；工程项须"能防住已发生过的 bug 类型"或"解锁用户功能"才进版本，纯洁癖进观察区。

## 0.1.9 · 稳（安全与信任，约 1~2 天）

- [x] 恢复 TLS 严格校验（2026-09-14：`leetcodeApi.ts` 四处 `rejectUnauthorized: false` 全部移除；本机严格 TLS 直连 graphql/判题端点冒烟通过，瞬断重试链路不变；重试判定表由 `utils/networkRetry.ts` 单测覆盖）
- [x] 测试/提交在途忙碌锁（2026-09-14：`judgeInFlight` 全局锁，`tryBeginJudge` 在判题发起前同步占位，回调 finally 释放；并发时 toast「已有测试/提交在判题中」）
- [x] 判题轮询优化（2026-09-14：`pollJudgeResult` 统一 test/submit——1s 起 ×1.5 退避封顶 5s、预算 ~90s；`judgeStatusBar` 状态栏显示已等待秒数（点击打开原始判题响应）；提交超时 toast 带「打开提交页」按钮；status_code 1002 抛错提前终止不空等）
- [x] 登录体验（2026-09-14：登录 webview 支持整段 Cookie 粘贴任一输入框，`utils/loginCookie.ts` 按键名自动拆分；会话过期主动检测——请求层 401/1002 触发限频 toast + activate 后台校验 `userStatus.isSignedIn`）
- [x] 核心纯逻辑单测层（2026-09-14：抽纯模块 `judgeReport`/`problemText`/`loginCookie`/`networkRetry`（判题分组与回退、期望输出提取、文件名身份解析、Cookie 拆分、重试幂等判定表）+ `src/unit/` node:test 26 用例（含生成 Python 驱动的 same_value 跨语言断言）；`.github/workflows/ci.yml` push/PR 跑 lint+compile+test:unit）
- [ ] 商店获客：~~`categories` 改为 `Education`/`Programming Languages`~~（2026-09-14 已完成）；商店页上传 3~4 张界面截图**待用户在 Marketplace 管理页手动操作**（截图素材可从题面 webview/题解页/判题输出面板/侧栏列表采集）
- [x] 随版带上精简后的新 readme（发版打包 `--readme-path MARKETPLACE.md` 自动生效）；删除 `marked` 死依赖（2026-09-14：`pnpm remove marked`）
- [x] **登录一键化**（2026-09-14）：点「打开浏览器自动登录」→ playwright-core（vendor 副本，1.63.0）驱动系统 Edge/Chrome 开隔离临时 profile 的真实登录页（密码/验证码/扫码/GitHub 全支持）→ 轮询读 leetcode.cn 会话 Cookie → 自动存 SecretStorage 并校验；手动粘贴保留为兜底。放弃"直读浏览器 Cookie 库"路线（Windows v20 App-Bound 加密已封堵第三方解密）。单测 + 真机 Edge 端到端（启动/轮询/取消/临时目录清理）通过。VSIX +约 2MB（vendor 已裁 vite/tools）

## 0.2.0 · 好用（复盘体系 + 借机重构，约 1 周）

- [x] 进度与复盘：侧栏首行总进度（n/100 + 百分比 + 状态筛选提示）；分组标题显示「已解 x / 总数」；侧栏状态筛选（未做/已解决/尝试过）——点击总进度行或命令 `leetcode.setStatusFilter`（2026-09-16：纯逻辑 `utils/progressStats.ts` + 单测；判题结果实时更新侧栏与分组进度，提交通过=已解决、测试/未通过=尝试过，已解决不被测试降级）
- [x] 错题回顾队列：提交失败自动记录（时间/原因/题目），侧栏「❌ 错题回顾」入口按失败时间倒序展示，点击重开题目，提交通过自动移出，`leetcode.clearWrongQueue` 一键清空；本地存储走 globalState（2026-09-16：纯逻辑 `utils/wrongQueue.ts` + 单测）
- [x] extension.ts 模块化拆分（2026-09-16：题面/题解 HTML 生成与 Markdown 渲染器 → `src/views/problemPanel.ts`；判题上报/忙碌锁/轮询 → `src/judgeFeedback.ts`；共用 HTML 工具 → `src/utils/htmlUtil.ts`；收藏消息协议类型化 → `src/shared/webviewMessages.ts`；extension.ts 从 3654 行降至约 1900 行；tsconfig 排除 scripts）
- [x] `pnpm release <version>` 发布脚本（2026-09-16：`scripts/release.mjs`——版本/CHANGELOG 条目/工作区干净校验 → 改版本号 → vsce 打包（固定三参数）→ commit/tag/push → gh release 挂 VSIX → Open VSX（检测 OVSX_PAT）→ 输出 Marketplace 手动上传指引；支持 `--dry-run`）

## 0.3.0+ · 增长

- [ ] 刷题列表从 Hot 100 泛化到任意 study plan（面试经典 169、LeetCode 75 等）：`studyPlanV2Detail` 通路已验证，列表配置化
- [ ] 题目笔记功能（对齐网页版备注）
- [ ] 非 Python 语言调试驱动一键终端运行
- [ ] ffmpeg.wasm 改按需下载（VSIX 减重约 60%，代价是供应链信任，需单独决策）
- [ ] 活动栏图标更换为自有品牌（现为 LeetCode 面具）
- [ ] webview CSP 加固

## 观察区（等上游成熟，不排期）

- **纯 TypeScript 展示**：业务代码已是 100% TS；仓库语言栏中 0.3% JavaScript 来自 `eslint.config.mjs`（ESLint flat config 稳定形态只支持 JS 族）与 `.vscode-test.mjs`（@vscode/test-cli 固定文件名），均属上游工具链钉死；`vendor/` 下的第三方 JS（aliplayer/hls/highlight/ffmpeg-core）已被 Linguist 按 vendor 规则排除，不在统计内。待 ESLint 将 TS 配置转稳定、test-cli 支持 TS 配置后顺势切换。
- Marketplace OIDC 可信发布：等微软服务端 `/_apis/gallery/token` 端点与 publisher 管理端信任策略入口上线（隔几周 `gh workflow run` 探活），上线后 CI 发布全自动、工作流去掉预期失败标注。
- Open VSX 命名空间 verified 徽章：跟踪 EclipseFdn/open-vsx.org#13131。
