/**
 * 特殊判题题自适应识别 + 驱动行为单测
 * （detectSpecialProblem 结构识别 / Python 设计类题驱动运行期不崩溃并提示 / 操作序列运行期检测）
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectSpecialProblem, generateDebugFile } from '../utils/debugUtils';

test('detectSpecialProblem：设计类（无 Solution 入口）按结构识别，常规题不误判', () => {
    assert.equal(detectSpecialProblem('python3', 'class Solution:\n    def f(self):\n        pass\n', 'sample'), false);
    assert.equal(detectSpecialProblem('python3', 'class MyHashMap:\n    def __init__(self):\n        self.m = {}\n', 'design-hashmap'), true);
    assert.equal(detectSpecialProblem('java', 'class Solution {\n    public int f() { return 0; }\n}', 'sample'), false);
    assert.equal(detectSpecialProblem('java', 'class MyHashMap {\n    public MyHashMap() {}\n}', 'design-hashmap'), true);
    assert.equal(detectSpecialProblem('cpp', 'class Solution {\npublic:\n    int f() { return 0; }\n};', 'sample'), false);
    assert.equal(detectSpecialProblem('cpp', 'class MinStack {\npublic:\n    MinStack() {}\n};', 'min-stack'), true);
    assert.equal(detectSpecialProblem('rust', 'impl Solution {\n    pub fn f() {}\n}', 'sample'), false);
    assert.equal(
        detectSpecialProblem(
            'rust',
            'struct MyHashMap {\n    m: std::collections::HashMap<i32, i32>,\n}\nimpl MyHashMap {\n    pub fn new() -> Self { MyHashMap { m: std::collections::HashMap::new() } }\n}',
            'design-hashmap'
        ),
        true
    );
});

test('detectSpecialProblem：138（Node 带 random）与 160（校验参数）仍识别为特殊题', () => {
    const code138 = 'class Node:\n    def __init__(self, val, next=None, random=None):\n        self.val = val\n        self.next = next\n        self.random = random\n\nclass Solution:\n    def copyRandomList(self, head):\n        return head\n';
    assert.equal(detectSpecialProblem('python3', code138, 'copy-list-with-random-pointer'), true);
    assert.equal(detectSpecialProblem('python3', 'class Solution:\n    def f(self):\n        pass\n', 'intersection-of-two-linked-lists'), true);
});

test('detectSpecialProblem：JS/TS/Go 函数式入口不按结构误判为设计类；160 slug 兜底仍生效', () => {
    assert.equal(detectSpecialProblem('javascript', 'var twoSum = function(nums, target) {\n    return [];\n};', 'two-sum'), false);
    assert.equal(detectSpecialProblem('typescript', 'function twoSum(nums: number[], target: number): number[] {\n    return [];\n}', 'two-sum'), false);
    assert.equal(detectSpecialProblem('golang', 'func twoSum(nums []int, target int) []int {\n    return nil\n}', 'two-sum'), false);
    assert.equal(detectSpecialProblem('javascript', 'var getIntersectionNode = function(headA, headB) { return null; };', 'intersection-of-two-linked-lists'), true);
});

test('Python 设计类题驱动：生成时标记特殊 + 加载期不断言 Solution', () => {
    const snippet = 'class MyHashMap:\n    def __init__(self):\n        self.m = {}\n';
    const gen = generateDebugFile('python3', '497', 'design-hashmap', '["MyHashMap","put"]\n[[],[1]]', snippet, '/tmp/497_design-hashmap.py', ['[null]']);
    assert.ok(gen);
    assert.ok(gen!.content.includes('Solution = getattr(module, "Solution", None)'), '加载期不应断言 Solution 存在');
    assert.ok(gen!.content.includes('gen_special = True'), '设计类题应生成时标记特殊');
});

test('Python 驱动运行期：设计类题提示手动构造且不崩溃', (t) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 python，跳过驱动级验证');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-special-test-'));
    try {
        const snippet = 'class MyHashMap:\n    def __init__(self):\n        self.m = {}\n';
        const sol = path.join(dir, '497_design-hashmap.py');
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, '497_design-hashmap_debug.py');
        const gen = generateDebugFile('python3', '497', 'design-hashmap', '["MyHashMap","put"]\n[[],[1]]', snippet, sol.replace(/\\/g, '/'), ['[null]']);
        assert.ok(gen, 'generateDebugFile 应返回 python 驱动');
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(res.stdout.includes('⚠️'), `应提示特殊题: stdout=${res.stdout}\nstderr=${res.stderr}`);
        assert.ok(res.stdout.includes('手动构造用例'), `应引导手动构造: ${res.stdout}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Python 驱动运行期：class Solution 但用例为操作序列 → 兜底识别提示', (t) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 python，跳过驱动级验证');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-opseq-test-'));
    try {
        const snippet = 'class Solution:\n    def f(self, x):\n        return x\n';
        const sol = path.join(dir, '999_sample.py');
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, '999_sample_debug.py');
        // 操作序列的真实形态：首项为类名（含大写）、后续为合法方法名，次行为等长参数数组
        const gen = generateDebugFile('python3', '999', 'sample', '["MyStack","push","pop"]\n[[],[1],[]]', snippet, sol.replace(/\\/g, '/'), ['[1]']);
        assert.ok(gen);
        assert.ok(gen!.content.includes('gen_special = False'), '常规结构不应生成时标记');
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(res.stdout.includes('⚠️'), `应运行期识别操作序列: stdout=${res.stdout}\nstderr=${res.stderr}`);
        assert.ok(res.stdout.includes('手动构造用例'), `应引导手动构造: ${res.stdout}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Python 驱动运行期：普通字符串数组用例不误判为操作序列', (t) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 python，跳过驱动级验证');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-opseq-fp-test-'));
    try {
        // 两例恰好都是等长小写字符串数组（异位词分组形态）：首项非类名形态，不得触发特殊题提示
        const snippet = 'class Solution:\n    def group(self, strs):\n        return [strs]\n';
        const sol = path.join(dir, '49_group-anagrams.py');
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, '49_group-anagrams_debug.py');
        const gen = generateDebugFile('python3', '49', 'group-anagrams', '["ab","ba"]\n["cd","dc"]', snippet, sol.replace(/\\/g, '/'), []);
        assert.ok(gen);
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(!res.stdout.includes('手动构造用例'), `普通字符串数组用例不得误判为操作序列: ${res.stdout}`);
        assert.ok(!res.stdout.includes('无法通用运行官方示例'), `不得走特殊题跳过分支: ${res.stdout}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Python 驱动运行期：常规题仍走通用比对（重构回归）', (t) => {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 python，跳过驱动级验证');
        return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-normal-test-'));
    try {
        const snippet = 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n';
        const sol = path.join(dir, '1_two-sum.py');
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, '1_two-sum_debug.py');
        const gen = generateDebugFile('python3', '1', 'two-sum', '[1, 2]\n3', snippet, sol.replace(/\\/g, '/'), ['[0, 1]']);
        assert.ok(gen);
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(res.stdout.includes('✅ 通过'), `常规题应正常比对输出: stdout=${res.stdout}\nstderr=${res.stderr}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Java/C++ 设计类题模板：不实例化带参入口类（防编译失败），常规题类名自适应', () => {
    // 设计类（LRUCache 构造带 capacity）：模板应为注释引导而非硬编码 Solution 实例化
    const designJava = generateDebugFile('java', '146', 'lru-cache', '', 'class LRUCache {\n    public LRUCache(int capacity) {\n    }\n}', '/tmp/146_lru-cache.java', []);
    assert.ok(designJava);
    assert.ok(!designJava!.content.includes('Solution solution = new Solution();'), '设计类不应实例化 Solution');
    assert.ok(designJava!.content.includes('特殊判题题'), '设计类应有注释引导');
    const designCpp = generateDebugFile('cpp', '146', 'lru-cache', '', 'class LRUCache {\npublic:\n    LRUCache(int capacity) {\n    }\n};', '/tmp/146_lru-cache.cpp', []);
    assert.ok(designCpp);
    assert.ok(!designCpp!.content.includes('Solution solution;'), '设计类不应实例化 Solution');
    assert.ok(designCpp!.content.includes('特殊判题题'), '设计类应有注释引导');
    // 常规题：仍按 Solution 实例化
    const normalJava = generateDebugFile('java', '1', 'two-sum', '', 'class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[0];\n    }\n}', '/tmp/1_two-sum.java', []);
    assert.ok(normalJava);
    assert.ok(normalJava!.content.includes('Solution solution = new Solution();'), '常规题应实例化 Solution');
});

test('JS/TS 模板：内嵌操作序列运行期检测且语法合法', () => {
    const snippetJs = 'var isValid = function(s) { return true; };\n';
    const genJs = generateDebugFile('javascript', '20', 'valid-parentheses', '"()"\n"()[]{}"', snippetJs, '/tmp/20_valid-parentheses.js', ['true']);
    assert.ok(genJs);
    assert.ok(genJs!.content.includes('let opSeq'), 'JS 模板应含操作序列检测');
    assert.doesNotThrow(() => new Function(genJs!.content), 'JS 驱动编译失败');
    const snippetTs = 'function isValid(s: string): boolean {\n    return true;\n}\n';
    const genTs = generateDebugFile('typescript', '20', 'valid-parentheses', '"()"\n"()[]{}"', snippetTs, '/tmp/20_valid-parentheses.ts', ['true']);
    assert.ok(genTs);
    assert.ok(genTs!.content.includes('let opSeq'), 'TS 模板应含操作序列检测');
});