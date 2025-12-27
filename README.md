# LeetCode Hot 100 刷题助手

<p align="center">
  <img src="resources/leetcode.svg" width="128" height="128" alt="LeetCode Logo">
</p>

<p align="center">
  <b>一款专为 LeetCode Hot 100 题目设计的 VS Code 刷题插件</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.96.0+-blue?logo=visualstudiocode" alt="VS Code Version">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-16+-green?logo=nodedotjs" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 🎯 项目简介

本项目是一个功能完整的 VS Code 扩展，旨在为开发者提供高效的 LeetCode 刷题体验。通过深度集成 LeetCode API 和 VS Code 扩展生态，实现了从题目浏览、代码编写、在线测试到提交的全流程支持。

## �️ 技术栈

### 核心技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | 5.7+ | 主要开发语言，提供类型安全和更好的开发体验 |
| **VS Code Extension API** | 1.96+ | 扩展开发框架，实现 IDE 深度集成 |
| **Node.js** | 16+ | 运行时环境 |
| **pnpm** | 8+ | 高效的包管理工具 |

### 前端渲染技术

| 技术 | 用途 |
|------|------|
| **Webview API** | 在 VS Code 中渲染富文本内容 |
| **Marked.js** | Markdown 解析引擎，处理题解内容 |
| **KaTeX** | LaTeX 数学公式渲染，支持复杂度分析公式 |
| **Custom CSS** | 自适应 VS Code 主题的样式系统 |

### 后端通信技术

| 技术 | 用途 |
|------|------|
| **GraphQL** | 与 LeetCode API 通信的查询语言 |
| **HTTP/HTTPS** | 网络请求，支持 Cookie 认证 |
| **JSON** | 数据序列化格式 |

## � 技术亮点与创新点

### 1. 🔐 安全的 Cookie 认证机制

```typescript
// 采用 VS Code 安全存储机制
context.workspaceState.update('leetcode_session', session);
context.workspaceState.update('leetcode_csrftoken', csrftoken);
```

- **安全存储**：使用 VS Code 的 `workspaceState` 安全存储用户凭证，不写入任何本地文件
- **会话管理**：实现完整的登录/登出状态管理
- **请求拦截**：自动在所有 API 请求中注入认证信息

### 2. 📊 GraphQL API 深度集成

```typescript
// 封装 LeetCode GraphQL API
const query = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      title
      content
      codeSnippets { lang code }
    }
  }
`;
```

- **完整 API 封装**：封装了题目获取、代码提交、题解查询等核心 API
- **错误处理**：完善的网络错误和认证错误处理机制
- **类型安全**：所有 API 响应都有完整的 TypeScript 类型定义

### 3. 🎨 智能 Webview 渲染系统

```typescript
// 多层渲染管线
1. Markdown 解析 (Marked.js)
2. LaTeX 公式渲染 (KaTeX)  
3. 代码语法高亮
4. 多语言代码标签页生成
```

**创新特性：**
- **自适应主题**：通过 CSS 变量（`--vscode-*`）自动适配 VS Code 的浅色/深色主题
- **LaTeX 行内渲染**：智能识别 `$...$` 和 `$$...$$` 公式，支持行内/块级显示
- **动态 DOM 操作**：在 Webview 中动态处理 HTML 结构

### 4. 💻 智能多语言代码识别

```javascript
// 基于代码特征的语言检测算法
function detectLang(code) {
    if (/class\s+\w+\s*\{/.test(text) && /public\s+/.test(text)) return 'Java';
    if (/vector<|#include|::/.test(text)) return 'C++';
    if (/def\s+\w+\(self/.test(text)) return 'Python';
    // ... 更多语言检测规则
}
```

**创新特性：**
- **无标记检测**：即使代码块没有语言标识，也能通过语法特征识别语言
- **自动分组**：检测连续代码块并自动转换为可切换的标签页
- **优雅降级**：检测失败时仍能正常显示代码

### 5. 🐛 多语言本地调试支持

```typescript
// 自动生成调试模板
function generateDebugFile(lang: string, code: string, testCases: string) {
    // 根据语言生成包含测试用例的完整可运行文件
    // 支持: Python, Java, C++, JavaScript, TypeScript, Go, Rust, C
}
```

**创新特性：**
- **模板生成**：为每种语言生成标准的调试模板
- **用例注入**：自动将 LeetCode 测试用例转换为本地可用格式
- **一键运行**：直接在 VS Code 终端中执行，无需手动配置

### 6. 🌳 TreeView 数据驱动架构

```typescript
// 实现 TreeDataProvider 接口
class Hot100Provider implements vscode.TreeDataProvider<Question> {
    private _onDidChangeTreeData = new vscode.EventEmitter<Question | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    getTreeItem(element: Question): vscode.TreeItem { ... }
    getChildren(element?: Question): Question[] { ... }
}
```

- **响应式更新**：数据变化自动刷新视图
- **懒加载**：按需加载题目详情，优化性能
- **状态同步**：题目完成状态与 LeetCode 同步

## ✨ 功能特性

| 功能 | 描述 | 技术实现 |
|------|------|----------|
| � Cookie 登录 | 安全的账号认证 | workspaceState + HTTP Headers |
| 📋 题目列表 | Hot 100 完整题目 | TreeView + 静态数据 |
| 📝 题目详情 | 富文本题目描述 | Webview + HTML |
| 📖 题解查看 | 官方/社区题解 | GraphQL + Markdown |
| 🧮 公式渲染 | LaTeX 数学公式 | KaTeX CDN |
| 💻 代码标签页 | 多语言切换 | DOM 操作 + 语言检测 |
| ✅ 在线测试 | 运行测试用例 | GraphQL API |
| 🚀 代码提交 | 提交并获取结果 | GraphQL API |
| �🐛 本地调试 | 生成调试文件 | 模板生成 + 终端执行 |

# 📦 安装

### 从源码安装

```bash
# 1. 克隆仓库
git clone https://github.com/lao-mu-ji/Hot100-for-VSCode.git
cd Hot100-for-VSCode

# 2. 安装依赖
pnpm install

# 3. 编译项目
pnpm run compile

# 4. 在 VS Code 中按 F5 启动扩展开发主机
```

### 打包安装

```bash
# 安装 vsce
npm install -g @vscode/vsce

# 打包扩展
vsce package

# 安装生成的 .vsix 文件
# VS Code: 扩展 -> ... -> 从 VSIX 安装
```

## 🚀 使用方法

### 1. 登录 LeetCode

1. 点击侧边栏的 LeetCode 图标
2. 点击状态栏的 "LeetCode: 未登录"
3. 输入 `LEETCODE_SESSION` 和 `csrftoken`

> 💡 **获取 Cookie**：浏览器登录 leetcode.cn → F12 → Application → Cookies

### 2. 刷题流程

```
选择题目 → 查看描述 → 编写代码 → 测试 → 提交
```

### 3. 查看题解

打开题目 → 点击 "📖 题解" 标签 → 查看官方/社区题解

### 4. 本地调试

打开代码 → 点击 "调试" → 生成调试文件 → 运行调试

## 📁 项目架构

```
src/
├── extension.ts              # 扩展入口，命令注册
├── core/
│   ├── authManager.ts        # 认证管理器：登录/登出/状态管理
│   └── leetcodeApi.ts        # API 封装：GraphQL 请求/响应处理
├── views/
│   └── hot100Provider.ts     # TreeView 数据提供者
├── data/
│   └── hot100Data.ts         # Hot 100 题目静态数据
├── utils/
│   ├── debugUtils.ts         # 调试文件生成器
│   ├── languageUtils.ts      # 语言工具函数
│   └── webviewUtils.ts       # Webview HTML 生成
└── commands/
    └── solutionCommands.ts   # 题解命令处理
```

## ⚙️ 支持的编程语言

| 语言 | 扩展名 | 本地调试 | 编译运行 |
|------|--------|---------|----------|
| Python3 | .py | ✅ | `python` |
| Java | .java | ✅ | `javac` + `java` |
| C++ | .cpp | ✅ | `g++` |
| JavaScript | .js | ✅ | `node` |
| TypeScript | .ts | ✅ | `ts-node` |
| Go | .go | ✅ | `go run` |
| Rust | .rs | ✅ | `rustc` + 运行 |
| C | .c | ✅ | `gcc` |

## 🔧 开发

```bash
pnpm install      # 安装依赖
pnpm run compile  # 编译
pnpm run watch    # 监听模式
pnpm run lint     # 代码检查
pnpm run test     # 运行测试
```

## 📊 项目统计

- **代码行数**：~2000+ 行 TypeScript
- **API 接口**：6+ GraphQL 查询封装
- **支持语言**：8 种编程语言
- **功能模块**：10+ 核心功能

## 📝 更新日志

查看 [CHANGELOG.md](CHANGELOG.md)

## 📄 许可证

MIT License

## 🙏 致谢

- [LeetCode](https://leetcode.cn) - 算法练习平台
- [VS Code](https://code.visualstudio.com) - 代码编辑器
- [Marked](https://marked.js.org) - Markdown 解析
- [KaTeX](https://katex.org) - LaTeX 渲染
