/**
 * 生成产物级验证：
 * ① webview 页面脚本以模板字符串拼接，tsc 不校验其语法——必须真实调用
 *    generatePanelHtml 并对产物内联脚本做语法编译，才能拦住"页面脚本写坏"类回归；
 *    同时断言产物无内联事件属性（CSP nonce 策略下内联 onclick 点击无反应）。
 * ② 各语言调试驱动产物做语法扫描（Python py_compile / JS node --check /
 *    TS typescript 转换诊断），模板改动导致的语法破坏在此拦下。
 * 依赖本机 python/node（缺失时对应子项跳过）。
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateDebugFile } from '../utils/debugUtils';

// vscode 桩件：generatePanelHtml 只用到 Uri 与面板 webview 的少量表面
const fakeVscode: any = {
    Uri: {
        file: (p: string) => ({ fsPath: p, toString: () => 'vscode-file:///' + String(p).replace(/\\/g, '/') }),
        joinPath: (base: any, ...parts: string[]) => ({
            fsPath: path.join(base?.fsPath ?? String(base), ...parts),
            toString: () => 'vscode-file:///' + path.join(base?.fsPath ?? String(base), ...parts).replace(/\\/g, '/')
        }),
        parse: (s: string) => ({ fsPath: s, toString: () => s })
    },
    TreeItem: class { },
    ThemeIcon: class { constructor(public id: string) { } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter: class {
        event = () => ({ dispose() { } });
        fire() { }
    }
};

function loadProblemPanel(): any {
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (request: string, ...rest: unknown[]) {
        if (request === 'vscode') {
            return fakeVscode;
        }
        return origLoad.call(this, request, ...rest);
    };
    try {
        return require('../views/problemPanel');
    } finally {
        Module._load = origLoad;
    }
}

function fakeEnv() {
    const repoRoot = path.join(__dirname, '..', '..');
    const panel: any = {
        webview: {
            cspSource: 'https://test.vscode-cdn.net',
            asWebviewUri: (u: any) => ({ toString: () => 'https://test/' + path.basename(String(u?.fsPath || u)) }),
            postMessage: async () => true
        }
    };
    const context: any = {
        extensionPath: repoRoot,
        globalStorageUri: { fsPath: path.join(os.tmpdir(), 'lc-gen-artifact-test') }
    };
    return { repoRoot, panel, context };
}

test('webview 产物：generatePanelHtml 可生成、页面脚本语法正确、无内联事件属性', () => {
    const { generatePanelHtml } = loadProblemPanel();
    const { panel, context } = fakeEnv();
    const q: any = {
        titleSlug: 'two-sum',
        questionFrontendId: '1',
        translatedTitle: '两数之和',
        title: 'Two Sum',
        difficulty: 'EASY',
        likes: 1,
        dislikes: 0,
        topicTags: [],
        similarQuestions: '[]',
        stats: '{}',
        hints: []
    };
    for (const activeTab of ['problem', 'solution'] as const) {
        const html = generatePanelHtml(
            q,
            '两数之和',
            '简单',
            '<p>题面：<code>nums</code></p>',
            context,
            panel,
            activeTab,
            activeTab === 'solution' ? '<div class="solution-section"><p>题解内容</p></div>' : ''
        );
        assert.ok(html.includes('Content-Security-Policy'), '页面必须带 CSP');
        assert.ok(/script nonce="/.test(html), '内联脚本必须走 nonce（CSP script-src 无 unsafe-inline）');
        // ① 页面脚本语法：模板字符串拼接产物，tsc 不校验，这里用 Function 编译拦语法错误
        for (const m of html.matchAll(/<script nonce="[^"]*">([\s\S]*?)<\/script>/g)) {
            assert.doesNotThrow(() => new Function(m[1]), `页面脚本语法错误（${activeTab} 页）`);
        }
        // ② 内联事件属性（script 正文除外）在 CSP nonce 页会点击无反应
        const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/g, '');
        assert.ok(!/\son[a-z]+\s*=/i.test(withoutScripts), `产物不得含内联事件属性（${activeTab} 页）`);
    }
});

test('webview 产物：文章页返回按钮走 data 属性委托（非内联 onclick）', () => {
    const { generatePanelHtml } = loadProblemPanel();
    const { panel, context } = fakeEnv();
    const q: any = { titleSlug: 'two-sum', questionFrontendId: '1', difficulty: 'EASY', likes: 1, dislikes: 0, topicTags: [] };
    const articleHtml = '<div class="solution-section"><button data-back-list="1">← 返回列表</button><p>文章</p></div>';
    const html = generatePanelHtml(q, '两数之和', '简单', '', context, panel, 'solution', articleHtml);
    assert.ok(html.includes('data-back-list'), '返回按钮应为 data 属性 + click 委托');
    assert.ok(!html.includes('onclick='), '不得回退为内联 onclick');
});

function syntaxCheckDriver(t: { skip: (msg: string) => void }, lang: string, gen: { fileName: string; content: string } | null): void {
    assert.ok(gen, `${lang} 应生成调试驱动`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-gen-artifact-'));
    try {
        const file = path.join(dir, gen!.fileName);
        fs.writeFileSync(file, gen!.content);
        if (gen!.fileName.endsWith('.py')) {
            const py = process.platform === 'win32' ? 'python' : 'python3';
            if (spawnSync(py, ['--version'], { encoding: 'utf8' }).status !== 0) {
                t.skip('本机无 python，跳过 Python 驱动语法校验');
                return;
            }
            const res = spawnSync(py, ['-m', 'py_compile', file], { encoding: 'utf8' });
            assert.strictEqual(res.status, 0, `Python 驱动语法错误: ${res.stderr}`);
        } else if (gen!.fileName.endsWith('.js')) {
            const res = spawnSync('node', ['--check', file], { encoding: 'utf8' });
            assert.strictEqual(res.status, 0, `JS 驱动语法错误: ${res.stderr}`);
        } else if (gen!.fileName.endsWith('.ts')) {
            const tsMod = require('typescript');
            const out = tsMod.transpileModule(gen!.content, {
                reportDiagnostics: true,
                compilerOptions: { target: tsMod.ScriptTarget.ES2022 }
            });
            const diags: any[] = out.diagnostics || [];
            assert.strictEqual(diags.length, 0, `TS 驱动语法错误: ${diags.map(d => d.messageText).join('; ')}`);
        }
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('调试驱动产物：Python/JS/TS 模板生成的驱动语法有效（常规题 + 设计类 + 多参数）', (t) => {
    const nodeSnippet = 'class Solution:\n    def reverseList(self, head: ListNode) -> ListNode:\n        return head\n';
    syntaxCheckDriver(t, 'python3', generateDebugFile('python3', '206', 'reverse-linked-list', '[1,2,3]', nodeSnippet, '/tmp/206.py', [], [[[1, 2, 3]]]));
    const lcaPy = 'class Solution:\n    def lowestCommonAncestor(self, root: TreeNode, p: TreeNode, q: TreeNode) -> TreeNode:\n        return root\n';
    syntaxCheckDriver(t, 'python3', generateDebugFile('python3', '236', 'lowest-common-ancestor-of-a-binary-tree', '[3,5,1]\n5\n1', lcaPy, '/tmp/236.py', []));
    const specialPy = 'class MinStack:\n    def push(self, val: int) -> None:\n        pass\n';
    syntaxCheckDriver(t, 'python3', generateDebugFile('python3', '155', 'min-stack', '["MinStack"]', specialPy, '/tmp/155.py', [], []));

    const jsSnippet = 'var reverseList = function(head) { return head; };\n';
    syntaxCheckDriver(t, 'javascript', generateDebugFile('javascript', '206', 'reverse-linked-list', '[1,2,3]', jsSnippet, '/tmp/206.js', [], [[[1, 2, 3]]]));
    const lcaJs = 'function lowestCommonAncestor(root, p, q) { return root; }\n';
    syntaxCheckDriver(t, 'javascript', generateDebugFile('javascript', '236', 'lowest-common-ancestor-of-a-binary-tree', '[3,5,1]\n5\n1', lcaJs, '/tmp/236.js', []));

    const tsSnippet = 'function reverseList(head: ListNode): ListNode | null { return head; }\n';
    syntaxCheckDriver(t, 'typescript', generateDebugFile('typescript', '206', 'reverse-linked-list', '[1,2,3]', tsSnippet, '/tmp/206.ts', [], [[[1, 2, 3]]]));
});

test('调试驱动产物：Java 类名与文件名一致（含数字开头 slug）', () => {
    const javaSnippet = 'class Solution {\n    public List<List<Integer>> threeSum(int[] nums) { return null; }\n}\n';
    const gen = generateDebugFile('java', '15', '3sum', '[0,0,0]', javaSnippet, '/tmp/15_3sum.java', []);
    assert.ok(gen);
    assert.strictEqual(gen!.fileName, '_3sumDebug.java');
    assert.ok(gen!.content.includes('public class _3sumDebug'), 'public 类名必须与文件名一致且为合法标识符');
    const base = gen!.fileName.replace(/\.java$/, '');
    assert.ok(gen!.content.includes(`class ${base}`), `类名应与文件名一致: ${base}`);
});
