# LeetCode Hot100 Pro

<p align="center">
  <img src="resources/hot100-pro.png" width="128" height="128" alt="LeetCode Hot100 Pro">
</p>

<p align="center">
  <b>LeetCode 热题 100 一站式 VS Code 刷题插件</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.107.0+-blue?logo=visualstudiocode" alt="VS Code Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 简介

在 VS Code 中完成 LeetCode 热题 100 的全流程：浏览题目、编写 14 种语言的解法、在线测试与提交、查看官方/社区题解、本地运行与断点调试。题面与题解在编辑器内原生渲染（公式、语法高亮、多语言代码标签页），判题结果带完整细节。

## 特性

| 功能 | 说明 |
|------|------|
| 🔐 Cookie 登录 | 凭证存入 VS Code SecretStorage（系统密钥链加密，不落明文），自动校验会话 |
| 📋 题目列表 | 与官网《热题 100》一致的 100 题，实时显示难度与通过状态，通过自动打勾 |
| 📝 题面渲染 | 富文本题面/题解，每题单页（重复点击自动聚焦），LaTeX 公式、语法高亮、多语言标签页 |
| ✅ 测试与提交 | 一键运行示例测试、提交判题；通过与否都有完整判题详情（输入/输出/预期/错误原因），可一键跳转官方判题页 |
| 🐞 本地调试 | 生成含全部示例与期望输出的调试驱动，Python 断点直接打在题解文件上 |
| ▶ 快速运行 | 当前文件一键在终端编译执行 |
| 🌐 网络健壮 | 超时兜底、禁用死连接复用、TLS 瞬断自动安全重试（杜绝重复提交） |

## 安装

**插件市场（推荐）**

- VS Code Marketplace：搜索 `LeetCode Hot100 Pro`，或访问 [marketplace.visualstudio.com/items?itemName=ShiZiMiao.leetcode](https://marketplace.visualstudio.com/items?itemName=ShiZiMiao.leetcode)
- Open VSX（Cursor / VSCodium / Windsurf 等）：[open-vsx.org/extension/ShiZiMiao/leetcode](https://open-vsx.org/extension/ShiZiMiao/leetcode)

**从源码**

```bash
git clone https://github.com/ShiZiMiao/LeetCode-Hot100-VSCode.git
cd LeetCode-Hot100-VSCode
pnpm install && pnpm run compile
# VS Code 中按 F5 启动扩展开发主机
```

## 使用方法

### 1. 登录

点击状态栏 **"LeetCode: 未登录"**，粘贴两个 Cookie 值：`LEETCODE_SESSION` 与 `csrftoken`。

> 获取方式：浏览器登录 [leetcode.cn](https://leetcode.cn) → F12 → Application → Cookies

### 2. 刷题

侧边栏选择题目 → 首次会询问语言并创建 `leetcode/{题号}_{题名}.{ext}` → 编写代码 → 编辑器右上角按钮依次可用：**▶ 运行**（终端执行）、**🐞 调试**（本地调试驱动）、**▷ 测试**、**☁ 提交**。

### 3. 判题详情

测试/提交后结果写入输出面板「**LeetCode 判题结果**」（自动展开）：状态（中英双语）、通过用例数、首个失败用例、输入/输出/预期结果、编译/运行时错误；toast 上可直接**在浏览器打开**官方判题页或查看**原始判题响应**（JSON 编辑器，可折叠）。编译/运行时错误同时以波浪线标注在代码行上。

### 4. 本地调试

点击 **🐞 调试**：生成调试驱动到 `debug/` 子目录（如 `1_two-sum_debug.py`），自动注入全部示例并对照题面提取的期望输出（比对语义与判题机一致：列表类输出顺序无关、tuple/list 等价）。

- **Python**：直接启动 VS Code 原生调试会话（需 Python Debugger 扩展，可一键安装），断点打在题解文件上即可命中
- **Java / C++ / JavaScript / TypeScript / Go / Rust**：生成自包含模板并打开，运行查看结果
- 需已安装对应语言的工具链（`python` / `javac` / `g++` / `node` / `ts-node` / `go` / `rustc`）

## 技术实现

- **数据层**：leetcode.cn GraphQL + REST 封装（题面、测试 `interpret_solution`、提交、判题轮询、官方/社区题解、登录校验）；列表按 100/页并行分页拉取，状态与难度实时同步
- **渲染层**：Markdown 在扩展进程渲染为静态 HTML（不依赖 CDN 解析库），题解代码标签页取自官方语言标签；highlight.js 本地打包（明暗主题自动切换），KaTeX 作可选增强
- **判题详情**：通过/未通过统一解析输出通道展示，原始响应在可折叠的 JSON 编辑器中按需查看
- **网络层**：20s 超时、连接不复用、瞬断安全重试（GET 总是重试；POST 仅在请求体未完整发出前重试）

## 项目结构

```
src/
├── extension.ts              # 入口：命令注册、题面/题解 webview、判题上报
├── core/
│   ├── authManager.ts        # SecretStorage 会话管理
│   └── leetcodeApi.ts        # GraphQL/REST 封装 + 重试
├── data/hot100Data.ts        # 热题 100 静态数据
├── views/hot100Provider.ts   # TreeView（难度/状态）
└── utils/
    ├── debugUtils.ts         # 各语言调试驱动生成
    └── languageUtils.ts      # 语言/扩展名映射与选择
```

（`utils/webviewUtils.ts`、`commands/solutionCommands.ts` 为历史遗留模块，不在主流程中使用。）

## 支持语言

**刷题 14 种**：Python3、Java、C++、C、C#、JavaScript、TypeScript、Go、Rust、Kotlin、Swift、Ruby、Scala、PHP
**本地调试驱动 7 种**：Python3（原生调试会话）、Java、C++、JavaScript、TypeScript、Go、Rust

## 开发

```bash
pnpm install       # 安装依赖
pnpm run compile   # 编译
pnpm run watch     # 监听编译
pnpm run lint      # 代码检查
pnpm test          # 运行测试
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)

## 许可证

[MIT](LICENSE)

## 致谢

- [LeetCode](https://leetcode.cn) · [VS Code](https://code.visualstudio.com)
- [highlight.js](https://highlightjs.org) · [KaTeX](https://katex.org)
