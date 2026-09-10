# Changelog

All notable changes to the "leetcode" extension will be documented in this file.

## 0.1.8

- **更名与换标**：显示名称改为 **LeetCode Hot100 Pro**，新图标（琥珀渐变 + 火焰 + 100），与上游 fork 原插件正式区分（扩展 ID `ShiZiMiao.leetcode` 不变，自动更新不受影响）
- **判题详情通道**：每次测试/提交（无论通过与否）的完整判题信息写入输出面板「LeetCode 判题结果」——状态（中英双语）、通过用例数、首个失败用例、输入/输出/预期结果、编译/运行时错误，图标标识（✅/❌/🧪/🚀/📥/📤/🎯 等），判题后自动展开面板；右下角 toast 只留一行简讯，附「原始判题响应」「在浏览器打开」按钮
- **原始判题响应**：可经 toast 按钮或命令「LeetCode: 查看最近一次原始判题响应」在 JSON 编辑器中查看（支持折叠）
- **每题单页**：题面页/题解页按题去重，重复点击只聚焦已打开页面（含快速双击防竞态）；「查看题解」编辑器标题按钮移除，命令面板仍可用
- **修复误提交**：焦点在输出面板等非代码视图时，测试/提交/本地调试不再把面板内容当代码提交，自动回退到当前题解文件
- **网络稳定性**：TLS 偶发瞬断自动安全重试（GET 总重试；POST 仅在请求体未完整发出前重试，杜绝重复提交），失败提示改为中文
- **调试体验**：缺少 Python 调试扩展时可一键安装 ms-python.debugpy；本地调试不支持语言的提示更新为实际支持列表（Python3/Java/C++/JS/TS/Go/Rust）
- **商店信息规范**：商店详情页不再展示 fork 说明（fork 归属移至仓库 README 文末一行）；README 全面对齐当前实现（版本要求、SecretStorage 存储、渲染管线、双商店安装入口、调试文件命名与语言支持）

## 0.1.7

- **本地调试环境与判题机对齐**：按 LeetCode 判题机 `globals()` 实测重建驱动预导入——星导入 `string/re/collections/heapq/bisect/copy/math/random/statistics/itertools/functools/operator/io/sys/json`（含 Counter/defaultdict/lru_cache/inf 等散名），`time/os` 仅模块名，`datetime` 模块 + 常用类，`typing` 最后导入；`sortedcontainers` 本地未安装时自动以 bisect 兜底；补齐 LC 定制的 `heappush_max` 系列大顶堆函数；修复解法中直接引用 `collections.defaultdict` 等模块名时报 NameError 的问题（官方有而本地此前未注入）；移除官方不存在的 `queue`

## 0.1.6

- **修复错题状态残留**：运行/调试/测试/提交/查看题解此前以全局记录的"当前题"为准，打开新题但流程未完整走完（如语言选择被取消、窗口重启）时会用到上一题状态，导致运行/提交错题。现全部改为**以实际编辑的文件为准**（文件名 `{题号}_{slug}.{ext}`），状态不一致时自动按文件重新拉取题面并同步
- **本地调试比对修正**：期望输出比对与 LeetCode 判题语义一致——tuple 与 list 等价（如两数之和返回 `(0, 1)` 通过）、int/float 数值等价；bool 与 `1` 不再误判通过
- **C++ 编译错误行号**：`main.cpp:3:5: error:` 格式可正确解析定位
- **打开题目优化**：题目已有代码文件时不再弹语言选择框，直接打开

## 0.1.5

- **本地调试增强**：Python 一键启动 VS Code 原生调试会话（importlib 驱动，断点直接打在题解代码上）；自动提取题面各示例的期望输出并逐例比对；调试文件统一放入 `debug/` 子目录
- **运行/提交错误诊断化**：错误不再弹长文本，而是标注到编辑器（波浪线 + 问题面板），重跑自动清除旧标注，可一键跳转问题面板
- **网络稳定性**：请求 20s 超时兜底 + 禁用 keep-alive 复用（代理环境避免死连接无限挂起）；题解加载改为官方/社区并行拉取
- **题解页刷新按钮**：题目描述、题解两个标签可独立刷新，加载失败时无需重开面板

## 0.1.4

- **题目难度显示**：题目行现在显示难度，与题号一起放在中括号内（如 `[1 · 简单]`），数据实时取自 leetcode.cn
- **修复状态/难度缺失**：列表接口单页最多返回 100 题，原实现 limit 3000 被截断，导致 128 号以后的题目取不到状态与难度——已改为按 skip 分页并行拉取，Hot 100 全部 100 题的状态图标与难度均能正确显示
- **数据对齐官网**：补充缺失的 152. 乘积最大子数组（Maximum Product Subarray），题目列表与官网《热题 100》完全一致
- **发布元信息完善**：description、license（MIT）、homepage、bugs 字段；README 克隆地址修正为当前仓库

## 0.1.3

- 题目列表状态图标匹配 leetcode.cn 大写状态枚举（AC/TRIED/NOT_STARTED）：已通过显示绿色对勾，尝试过未通过显示红斜杠；提交通过后自动刷新列表状态
- 补充 publisher 字段（ShiZiMiao），扩展 ID 更正为 `ShiZiMiao.leetcode`

## 0.1.2

- 官方题解代码正常显示（byLeetcode 官方文章优先，含真实多语言代码与标签页）
- 视频题解完整链路（playAuth → HLS 合并 → ffmpeg remux 为 MP4 → 原生播放，自动缓存）
- 题解渲染加固（完整 Markdown 渲染、CRLF 兼容）、代码高亮（highlight.js 本地打包 + GitHub 明暗双色板）、代码块复制按钮
- 图片本地化、主题适配（深浅主题下清晰可读）等累计修复

## 0.1.1

- 修复题解 iframe 登录页重定向问题（`sanitizeSolutionContent` 移除跨域 iframe）