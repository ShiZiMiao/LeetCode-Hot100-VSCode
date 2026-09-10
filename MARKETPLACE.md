# LeetCode Hot100 Pro

<p align="center">
  <img src="resources/hot100-pro.png" width="128" height="128" alt="LeetCode Hot100 Pro">
</p>

<p align="center">
  <b>一款专为 LeetCode Hot 100 题目设计的 VS Code 刷题插件</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.107.0+-blue?logo=visualstudiocode" alt="VS Code Version">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-16+-green?logo=nodedotjs" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 🎯 项目简介

本项目是一个功能完整的 VS Code 扩展，旨在为开发者提供高效的 LeetCode 刷题体验。通过深度集成 LeetCode API 和 VS Code 扩展生态，实现了从题目浏览、代码编写、在线测试到提交的全流程支持。

## 技术栈

### 核心技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | 5.7+ | 主要开发语言，提供类型安全和更好的开发体验 |
| **VS Code Extension API** | 1.107+ | 扩展开发框架，实现 IDE 深度集成 |
| **Node.js** | 16+ | 运行时环境 |
| **pnpm** | 8+ | 高效的包管理工具 |

### 前端渲染技术

| 技术 | 用途 |
|------|------|
| **Webview API** | 在 VS Code 中渲染富文本内容 |
| **扩展端 Markdown 渲染** | 题面/题解的 Markdown 在扩展进程渲染为静态 HTML（不依赖 CDN 解析库，保证内容一定可显示） |
| **highlight.js**（本地打包） | 题解代码语法高亮，随扩展分发，不依赖网络 |
| **KaTeX** | LaTeX 数学公式渲染，支持复杂度分析公式（CDN 可选增强，加载失败不影响正文） |
| **Custom CSS** | 自适应 VS Code 主题的样式系统 |

### 后端通信技术

| 技术 | 用途 |
|------|------|
| **GraphQL** | 与 LeetCode API 通信的查询语言 |
| **HTTP/HTTPS** | 网络请求，支持 Cookie 认证 |
| **JSON** | 数据序列化格式 |

## 技术亮点与创新点

### 1. 🔐 安全的 Cookie 认证机制

```typescript
// 采用 VS Code SecretStorage 安全存储（系统级加密，不落明文文件）
await context.secrets.store('leetcode_session_cookie', cookie);
const cookie = await context.secrets.get('leetcode_session_cookie');
```

- **安全存储**：登录 Cookie 存入 VS Code `SecretStorage`（由操作系统密钥链加密），不写入任何明文文件，也不放进 workspaceState
- **会话管理**：实现完整的登录/登出状态管理，通过 `userStatus.isSignedIn` 校验会话有效性
- **请求拦截**：自动在所有 API 请求中注入 `Cookie` 与 `x-csrftoken` 认证信息

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
// 多层渲染管线（扩展端完成主体渲染）
1. Markdown → 静态 HTML（扩展端 TypeScript 渲染，无 CDN 依赖）
2. LaTeX 公式渲染 (KaTeX，webview 内可选增强)
3. 代码语法高亮 (highlight.js 本地资源，明/暗主题自动切换)
4. 多语言代码标签页生成（官方题解优先语言默认选中）
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
| � Cookie 登录 | 安全的账号认证 | SecretStorage + HTTP Headers |
| 📋 题目列表 | Hot 100 完整题目 | TreeView + 静态数据 |
| 📝 题目详情 | 富文本题目描述，每题单页（重复点击自动聚焦） | Webview + 扩展端渲染 |
| 📖 题解查看 | 官方/社区题解，多语言代码标签页 | GraphQL + Markdown |
| 🧮 公式渲染 | LaTeX 数学公式 | KaTeX（可选增强） |
| 💻 代码标签页 | 多语言切换 | DOM 操作 + 语言检测 |
| ✅ 在线测试 | 运行测试用例 | GraphQL API |
| 🚀 代码提交 | 提交并获取结果 | GraphQL API |
| 🔍 判题详情 | 通过/未通过的完整判题信息（输入/输出/预期/错误，图标标识），可一键跳转官方判题页 | 输出通道 + 编辑器诊断 |
| �🐛 本地调试 | 生成调试驱动，Python 可直接打断点 | 模板生成 + 原生调试会话 |

# 📦 安装

### 从插件市场安装（推荐）

- **VS Code Marketplace**：在扩展面板搜索 `LeetCode Hot100 Pro`（发布ID：`ShiZiMiao.leetcode`），或访问 [marketplace.visualstudio.com/items?itemName=ShiZiMiao.leetcode](https://marketplace.visualstudio.com/items?itemName=ShiZiMiao.leetcode)
- **Open VSX**（Cursor / VSCodium / Windsurf 等衍生编辑器）：[open-vsx.org/extension/ShiZiMiao/leetcode](https://open-vsx.org/extension/ShiZiMiao/leetcode)，或在扩展面板切换源后搜索安装

### 从源码安装

```bash
# 1. 克隆仓库
git clone https://github.com/ShiZiMiao/LeetCode-Hot100-VSCode.git
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

本地调试功能可以让你在本地运行和调试 LeetCode 题目代码，无需每次都提交到 LeetCode 服务器。

#### 使用步骤

1. **打开题目代码文件**
   - 在侧边栏选择一道题目
   - 选择你喜欢的编程语言
   - 代码文件会自动打开

2. **本地调试（LeetCode: 本地调试）**
   - 点击编辑器右上角的 **"🐛 调试"** 按钮，插件自动生成包含全部示例测试用例的调试驱动，统一放在题目文件旁的 `debug/` 子目录
   - **Python**：自动启动 VS Code 原生调试会话（需安装 Python Debugger 扩展），断点直接打在题解文件上即可命中
   - **Java / C++ / JavaScript / TypeScript / Go / Rust**：生成自包含调试模板并打开，按提示运行即可
   - 驱动会逐示例运行并对照从题面提取的预期输出，输出 通过/未通过 与顺序无关比对结果

3. **快速运行（LeetCode: 运行当前文件）**
   - 点击 **"▶ 运行"** 按钮，代码在 VS Code 终端中编译执行，快速查看输出

#### 调试文件说明

调试文件会自动包含：
- ✅ 你编写的解题代码
- ✅ LeetCode 提供的测试用例
- ✅ 主函数入口（用于运行）
- ✅ 结果输出（便于查看）

#### 各语言调试示例

驱动文件命名：Python/C++/JS/TS/Go/Rust 为 `{题号}_{题名}_debug.{ext}`（如 `1_two-sum_debug.py`），Java 为 `{题名驼峰}Debug.java`（如 `TwoSumDebug.java`）。

**Python 调试驱动（自动加载你的题解文件并逐示例比对）：**
```python
# 1_two-sum_debug.py
# 通过 importlib 加载题解文件 1_two-sum.py，注入测试用例运行
if __name__ == "__main__":
    solution = Solution()
    print(solution.twoSum([2,7,11,15], 9))  # 预期: [0,1]
```

**Java 调试模板：**
```java
// TwoSumDebug.java
class Solution {
    public int[] twoSum(int[] nums, int target) {
        // 你的代码...
        return new int[]{};
    }
    
    public static void main(String[] args) {
        Solution s = new Solution();
        int[] result = s.twoSum(new int[]{2,7,11,15}, 9);
        System.out.println(Arrays.toString(result)); // 预期: [0, 1]
    }
}
```

**C++ 调试模板：**
```cpp
// 1_two-sum_debug.cpp
#include <vector>
#include <iostream>
using namespace std;

class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // 你的代码...
        return {};
    }
};

int main() {
    Solution s;
    vector<int> nums = {2,7,11,15};
    auto result = s.twoSum(nums, 9);
    // 输出结果...
    return 0;
}
```

#### 环境要求

确保你的系统已安装对应语言的编译器/解释器：

| 语言 | 所需工具 | 安装命令 |
|------|----------|----------|
| Python | Python 3.x | `python --version` 验证 |
| Java | JDK 8+ | `javac --version` 验证 |
| C++ | g++ / clang++ | `g++ --version` 验证 |
| JavaScript | Node.js | `node --version` 验证 |
| Go | Go 1.16+ | `go version` 验证 |
| Rust | rustc | `rustc --version` 验证 |

#### 常见问题

**Q: 调试文件在哪里？**
A: 在题目文件所在目录的 `debug/` 子目录下，文件名格式为 `{题号}_{题名}_debug.扩展名`（Java 为 `{题名驼峰}Debug.java`）

**Q: 如何修改测试用例？**
A: 直接编辑调试文件中的测试用例部分，保存后重新运行即可

**Q: 运行报错怎么办？**
A: 检查是否安装了对应语言的运行环境，确保环境变量配置正确

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

| 语言 | 扩展名 | 本地调试驱动 | 编译运行 |
|------|--------|---------|----------|
| Python3 | .py | ✅ 原生调试会话 | `python` |
| Java | .java | ✅ | `javac` + `java` |
| C++ | .cpp | ✅ | `g++` |
| JavaScript | .js | ✅ | `node` |
| TypeScript | .ts | ✅ | `ts-node` |
| Go | .go | ✅ | `go run` |
| Rust | .rs | ✅ | `rustc` + 运行 |
| C / C# / Kotlin / Swift / Ruby / Scala / PHP | .c/.cs/.kt/... | — 正常刷题，暂未提供调试模板 | 需自备工具链 |

## 🔧 开发

```bash
pnpm install      # 安装依赖
pnpm run compile  # 编译
pnpm run watch    # 监听模式
pnpm run lint     # 代码检查
pnpm run test     # 运行测试
```

## 📊 项目统计

- **代码行数**：~5000 行 TypeScript
- **API 封装**：8+ 个（题面/测试/提交/判题轮询/官方题解/社区题解列表与详情/登录校验）
- **支持语言**：14 种编程语言（其中 7 种提供本地调试驱动）
- **功能命令**：登录、退出、刷新、打开题目、运行测试、提交、本地调试、快速运行、查看题解

## 📝 更新日志

查看 [CHANGELOG.md](CHANGELOG.md)

## 📄 许可证

MIT License

## 🙏 致谢

- [LeetCode](https://leetcode.cn) - 算法练习平台
- [VS Code](https://code.visualstudio.com) - 代码编辑器
- [highlight.js](https://highlightjs.org) - 题解代码语法高亮
- [KaTeX](https://katex.org) - LaTeX 渲染
