# Changelog

All notable changes to the "leetcode" extension will be documented in this file.

## 0.1.6

- **修复错题状态残留**：运行/调试/测试/提交/查看题解此前以全局记录的"当前题"为准，打开新题但流程未完整走完（如语言选择被取消、窗口重启）时会用到上一题状态，导致运行/提交错题。现全部改为**以实际编辑的文件为准**（文件名 `{题号}_{slug}.{ext}`），状态不一致时自动按文件重新拉取题面并同步
- **本地调试比对修正**：期望输出比对与 LeetCode 判题语义一致——tuple 与 list 等价（如两数之和返回 `(0, 1)` 通过）、int/float 数值等价；bool 与 `1` 不再误判通过
- **C++ 编译错误行号**：`main.cpp:3:5: error:` 格式可正确解析定位
- **打开题目优化**：题目已有代码文件时不再弹语言选择框，直接打开

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