# LeetCode Hot 100 刷题助手

<p align="center">
  <img src="resources/leetcode.svg" width="128" height="128" alt="LeetCode Logo">
</p>

<p align="center">
  一款专为 LeetCode Hot 100 题目设计的 VS Code 刷题插件
</p>

## ✨ 功能特性

- 🔐 **Cookie 登录** - 支持使用 LeetCode 账号的 Cookie 进行登录认证
- 📋 **Hot 100 题目列表** - 在侧边栏展示完整的 LeetCode Hot 100 题目
- 📝 **题目详情查看** - 点击题目即可查看完整题目描述
- 📖 **官方/社区题解** - 支持查看官方题解和热门社区题解
- 🧮 **LaTeX 公式渲染** - 完美支持题解中的数学公式显示
- 💻 **多语言代码标签页** - 自动识别并以标签页形式展示多语言解法
- ✅ **在线测试** - 直接在 VS Code 中运行测试用例
- 🚀 **代码提交** - 一键提交代码到 LeetCode
- 🐛 **本地调试** - 生成本地调试文件，方便调试代码

## 📦 安装

### 从源码安装

1. 克隆仓库
```bash
git clone https://github.com/lao-mu-ji/Hot100-for-VSCode.git
cd Hot100-for-VSCode
```

2. 安装依赖
```bash
pnpm install
```

3. 编译项目
```bash
pnpm run compile
```

4. 在 VS Code 中按 `F5` 启动扩展开发主机

### 打包安装

```bash
# 安装 vsce
npm install -g @vscode/vsce

# 打包扩展
vsce package

# 安装生成的 .vsix 文件
# 在 VS Code 中：扩展 -> ... -> 从 VSIX 安装
```

## 🚀 使用方法

### 1. 登录 LeetCode

1. 点击侧边栏的 LeetCode 图标
2. 点击状态栏的 "LeetCode: 未登录"
3. 在弹出的登录面板中输入：
   - **LEETCODE_SESSION**: 从浏览器获取的 session cookie
   - **csrftoken**: 从浏览器获取的 csrf token

> 💡 **获取 Cookie 方法**：
> 1. 在浏览器中登录 [leetcode.cn](https://leetcode.cn)
> 2. 按 F12 打开开发者工具
> 3. 切换到 Application/存储 -> Cookies
> 4. 复制 `LEETCODE_SESSION` 和 `csrftoken` 的值

### 2. 刷题流程

1. **选择题目** - 在侧边栏点击任意题目
2. **查看题目** - 自动打开题目描述和代码编辑器
3. **编写代码** - 在编辑器中完成解题代码
4. **测试代码** - 点击编辑器右上角的 "测试" 按钮
5. **提交代码** - 点击 "提交" 按钮提交到 LeetCode

### 3. 查看题解

1. 打开任意题目
2. 点击题目面板中的 "📖 题解" 标签
3. 查看官方题解或点击社区题解查看详情

### 4. 本地调试

1. 打开题目代码文件
2. 点击编辑器右上角的 "调试" 按钮
3. 自动生成包含测试用例的调试文件
4. 点击 "运行调试" 在终端中执行代码

## 📁 项目结构

```
leetcode/
├── src/
│   ├── extension.ts          # 扩展入口文件
│   ├── core/
│   │   ├── authManager.ts    # 登录认证管理
│   │   └── leetcodeApi.ts    # LeetCode API 封装
│   ├── views/
│   │   └── hot100Provider.ts # Hot 100 树视图
│   ├── data/
│   │   └── hot100Data.ts     # Hot 100 题目数据
│   ├── utils/
│   │   ├── debugUtils.ts     # 调试工具
│   │   ├── languageUtils.ts  # 语言工具
│   │   └── webviewUtils.ts   # Webview 渲染工具
│   └── commands/
│       └── solutionCommands.ts # 题解命令处理
├── resources/
│   └── leetcode.svg          # 图标资源
├── package.json              # 扩展配置
└── tsconfig.json             # TypeScript 配置
```

## ⚙️ 支持的编程语言

| 语言 | 文件扩展名 | 本地调试 |
|------|----------|---------|
| Python3 | .py | ✅ |
| Java | .java | ✅ |
| C++ | .cpp | ✅ |
| JavaScript | .js | ✅ |
| TypeScript | .ts | ✅ |
| Go | .go | ✅ |
| Rust | .rs | ✅ |
| C | .c | ✅ |

## 🔧 开发

### 环境要求

- Node.js >= 16
- pnpm >= 8
- VS Code >= 1.96.0

### 开发命令

```bash
# 安装依赖
pnpm install

# 编译
pnpm run compile

# 监听模式
pnpm run watch

# 代码检查
pnpm run lint

# 运行测试
pnpm run test
```

## 📝 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本更新历史。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [LeetCode](https://leetcode.cn) - 提供优质的算法练习平台
- [VS Code](https://code.visualstudio.com) - 优秀的代码编辑器
