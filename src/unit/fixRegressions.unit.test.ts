/**
 * 0.1.16 修复回归单测：补审计暴露的测试盲区。
 * 覆盖：登录 Cookie 混合粘贴 / 文件名身份（_restored、_debug）/ 示例提取（伪示例段、
 * 混合引号）/ compare_result 变短 / 复习错题只挑到期 / 今日目标按题数计 /
 * retryTransient(0) / Java 数字开头类名 / Python 驱动吞用例与浮点容差 /
 * JS 驱动节点转换与多参数 / webview 无内联事件属性断言。
 * 端到端用例依赖本机 python/node（缺失时跳过，不阻塞 CI 平台差异）。
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLeetCodeCookie } from '../utils/loginCookie';
import { parseProblemFileName, extractExamples, extractExampleInputs } from '../utils/problemText';
import { collectJudgeCaseInfos, buildJudgeReport } from '../utils/judgeReport';
import { pickReviewCandidate, WrongEntry } from '../utils/wrongQueue';
import { computeStudyStats } from '../utils/studyStats';
import { retryTransient } from '../utils/networkRetry';
import { isDisposedError } from '../utils/htmlUtil';
import { langSlugOfExtension } from '../utils/languageUtils';
import { javaClassNameOf } from '../utils/debugManual';
import { generateDebugFile } from '../utils/debugUtils';

// ==================== 登录 Cookie ====================

test('loginCookie：一侧 KEY=VALUE、另一侧裸值的混合粘贴不产出双前缀', () => {
    assert.strictEqual(
        buildLeetCodeCookie('LEETCODE_SESSION=eyJabc', 'tok123'),
        'LEETCODE_SESSION=eyJabc; csrftoken=tok123'
    );
    assert.strictEqual(
        buildLeetCodeCookie('eyJabc', 'csrftoken=tok123'),
        'LEETCODE_SESSION=eyJabc; csrftoken=tok123'
    );
    assert.strictEqual(
        buildLeetCodeCookie('LEETCODE_SESSION=eyJabc; other=1', 'tok123'),
        'LEETCODE_SESSION=eyJabc; csrftoken=tok123'
    );
});

// ==================== 文件名身份 ====================

test('problemText：文件名解析识别 _debug 与 _restored（副本仍可运行/提交）', () => {
    assert.deepStrictEqual(parseProblemFileName('1_two-sum_debug.py'), { questionId: '1', titleSlug: 'two-sum', isDebug: true });
    assert.deepStrictEqual(parseProblemFileName('1_two-sum_restored.py'), { questionId: '1', titleSlug: 'two-sum', isDebug: false });
    assert.deepStrictEqual(parseProblemFileName('1_two-sum.py'), { questionId: '1', titleSlug: 'two-sum', isDebug: false });
    assert.strictEqual(parseProblemFileName('TwoSumDebug.java'), null);
});

// ==================== 示例提取 ====================

test('problemText：示例 1 之前的题面正文不再产出伪示例条目', () => {
    const html = '<p>说明：输入：nums = [1]，输出：1 是示意排版。</p><p>示例 1：</p><pre>输入：nums = [2]\n输出：2</pre>';
    const entries = extractExamples(html);
    assert.strictEqual(entries.length, 1, `应只解析出示例 1: ${JSON.stringify(entries)}`);
    assert.strictEqual(entries[0].output, '2');
});

test('problemText：混合引号/带撇号示例输入仍可按值解析（不整体降级）', () => {
    const html = '<p>示例 1：</p><pre>输入：strs = ["it\'s", \'x\']\n输出：0</pre>';
    const inputs = extractExampleInputs(html);
    assert.strictEqual(inputs.length, 1);
    assert.deepStrictEqual(inputs[0], [["it's", 'x']]);
});

// ==================== 判题报告 ====================

test('judgeReport：compare_result 变短时未跑用例不标"确定失败"', () => {
    const check: any = {
        run_success: true,
        compare_result: '1',
        code_answer: ['a', 'b', 'c'],
        expected_code_answer: ['a', 'x', 'y'],
        total_testcases: 3
    };
    const infos = collectJudgeCaseInfos(check, 'i1\ni2\ni3');
    assert.strictEqual(infos.length, 3);
    assert.strictEqual(infos[0].known, true);
    assert.strictEqual(infos[0].passed, true);
    assert.strictEqual(infos[1].known, false, '第 2 例从未判定，不得 known');
    assert.strictEqual(infos[2].known, false);
});

test('judgeReport：混字符 compare_result 不采信"首个未通过用例"', () => {
    const mixed = buildJudgeReport({ status_msg: 'Wrong Answer', compare_result: '10null' } as any, undefined, false);
    assert.ok(!mixed.detail.includes('首个未通过用例'), mixed.detail);
    const clean = buildJudgeReport({ status_msg: 'Wrong Answer', compare_result: '10' } as any, undefined, false);
    assert.ok(clean.detail.includes('首个未通过用例: 第 2 个'), clean.detail);
});

// ==================== 复习错题 ====================

test('wrongQueue：未到期错题不作为复习候选（不得被标"今日已复习"）', () => {
    const now = Date.now();
    const due: WrongEntry = { titleSlug: 'a', title: 'A', failedAt: now - 2 * 24 * 3600 * 1000, reason: 'r', failCount: 1 } as WrongEntry;
    const fresh: WrongEntry = { titleSlug: 'b', title: 'B', failedAt: now, reason: 'r', failCount: 1 } as WrongEntry;
    // 到期的 a 今日已复习 → 不应顺手把未到期的 b 当候选
    const res = pickReviewCandidate([due, fresh], ['a'], now);
    assert.strictEqual(res.entry, undefined, `未到期的 b 不应成为候选: ${JSON.stringify(res.entry)}`);
    assert.strictEqual(res.dueRemaining, 0);
    // a 未复习时优先挑 a
    const res2 = pickReviewCandidate([due, fresh], [], now);
    assert.strictEqual(res2.entry?.titleSlug, 'a');
});

// ==================== 今日目标计数 ====================

test('studyStats：今日通过数按去重题数计（可 >1），旧数据回退按打卡计 1', () => {
    const today = '2026-10-12';
    const stats = computeStudyStats([], () => undefined, [today], today, { [today]: ['1', '2', '3'] });
    assert.strictEqual(stats.todaySolved, 3, '同日通过 3 题应计 3（目标 3/3 可达成）');
    const legacy = computeStudyStats([], () => undefined, [today], today, {});
    assert.strictEqual(legacy.todaySolved, 1);
    const none = computeStudyStats([], () => undefined, ['2026-10-11'], today, {});
    assert.strictEqual(none.todaySolved, 0);
});

// ==================== 网络重试边界 ====================

test('networkRetry：retryTransient(0) 抛可读 Error 而非 undefined', async () => {
    await assert.rejects(
        () => retryTransient(async () => 1, 0),
        (e: unknown) => e instanceof Error && /maxAttempts/.test(e.message)
    );
});

test('htmlUtil：Webview is disposed 识别为可降噪噪音', () => {
    assert.strictEqual(isDisposedError(new Error('Webview is disposed')), true);
    assert.strictEqual(isDisposedError('Webview is disposed'), true);
    assert.strictEqual(isDisposedError(new Error('网络超时')), false);
});

test('languageUtils：扩展名反查语言（跨语言提交语言归一用）', () => {
    assert.strictEqual(langSlugOfExtension('c'), 'c');
    assert.strictEqual(langSlugOfExtension('py'), 'python3');
    assert.strictEqual(langSlugOfExtension('CPP'), 'cpp');
    assert.strictEqual(langSlugOfExtension('txt'), undefined);
});

// ==================== Java 调试类名 ====================

test('debugManual：数字开头 slug 生成合法 Java 标识符', () => {
    assert.strictEqual(javaClassNameOf('3sum'), '_3sumDebug');
    assert.strictEqual(javaClassNameOf('two-sum'), 'TwoSumDebug');
    assert.ok(/^\d/.test('_3sumDebug') === false, '_3sumDebug 必须是合法标识符');
});

// ==================== Python 驱动（端到端） ====================

function runDriver(
    t: { skip: (msg: string) => void },
    questionId: string,
    titleSlug: string,
    snippet: string,
    cases: string,
    expected: string[],
    exampleInputs: unknown[][] = []
): string | null {
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 python，跳过驱动级验证');
        return null;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fix-reg-test-'));
    try {
        const sol = path.join(dir, `${questionId}_${titleSlug}.py`);
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, `${questionId}_${titleSlug}_debug.py`);
        const gen = generateDebugFile('python3', questionId, titleSlug, cases, snippet, sol.replace(/\\/g, '/'), expected, exampleInputs);
        assert.ok(gen);
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(!res.stdout.includes('运行出错'), `驱动不应运行出错: ${res.stdout}\n${res.stderr}`);
        return res.stdout;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('Python 驱动运行期：无注解官方解入参转换 + 隐藏用例不被吞（第 104 题形态）', (t) => {
    // 官方文章的 Python 风格代码常省略类型注解（冒烟实测回归：'list' object has no attribute 'left'）
    const snippet =
        'class Solution:\n' +
        '    def maxDepth(self, root):\n' +
        '        if root is None:\n' +
        '            return 0\n' +
        '        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))\n';
    const stdout = runDriver(
        t,
        '104',
        'maximum-depth-of-binary-tree',
        snippet,
        '[3,9,20,null,null,15,7]\n[]\n[1,null,2]\n[0]',
        ['3', '0'],
        [[[3, 9, 20, null, null, 15, 7]], [[]]]
    );
    if (stdout === null) {
        return;
    }
    // 旧启发式只跑 2 个用例（"通过 1/2"）；修复后 4 个用例全部执行，2 个隐藏用例未校验
    assert.ok(stdout.includes('通过 2/4'), `应执行 4 个用例: ${stdout}`);
    assert.ok(stdout.includes('2 个未校验'), `隐藏用例应标未校验: ${stdout}`);
});

test('Python 驱动运行期：浮点结果按 1e-5 容差比对（第 4 题中位数形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def findMedianSortedArrays(self, nums1: List[int], nums2: List[int]) -> float:\n' +
        '        return 2.0\n';
    const stdout = runDriver(
        t,
        '4',
        'median-of-two-sorted-arrays',
        snippet,
        '[1,3]\n[2]',
        ['2.000005']
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `浮点容差内应判定通过: ${stdout}`);
});

test('Python 驱动生成：helper 写在入口前时仍取入口函数', () => {
    const snippet =
        'class Solution:\n' +
        '    def helper(self, x):\n' +
        '        return x\n' +
        '    def twoSum(self, nums: List[int], target: int) -> List[int]:\n' +
        '        return self.helper([0, 1])\n';
    const gen = generateDebugFile('python3', '1', 'two-sum', '[2,7,11,15]\n9', snippet, '/tmp/1_two-sum.py', []);
    assert.ok(gen);
    assert.ok(gen!.content.includes('func = solution.twoSum'), `应取入口 twoSum: ${gen!.content.match(/func = solution\.\w+/)?.[0]}`);
});

test('Python 驱动生成：死函数在入口前时取最后一个候选', () => {
    const snippet =
        'class Solution:\n' +
        '    def deadHelper(self, x):\n' +
        '        return x\n' +
        '    def twoSum(self, nums: List[int], target: int) -> List[int]:\n' +
        '        return [0, 1]\n';
    const gen = generateDebugFile('python3', '1', 'two-sum', '[2,7,11,15]\n9', snippet, '/tmp/1_two-sum_dead.py', []);
    assert.ok(gen);
    assert.ok(gen!.content.includes('func = solution.twoSum'), `应取入口 twoSum（不得取未被调用的 deadHelper）`);
});

test('Python 驱动运行期：无锚点 + 标量入参整数倍形态不吞用例（countBits 形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def countBits(self, n: int) -> int:\n' +
        '        return n\n';
    const stdout = runDriver(
        t,
        '338',
        'counting-bits',
        snippet,
        '1\n2\n3\n4',
        ['1', '2'],
        []
    );
    if (stdout === null) {
        return;
    }
    // 旧兜底把 4 值 ÷ 2 示例分成 2 组（吞掉一半）；修复后按 n=1 分 4 组，2 个附加用例标未校验
    assert.ok(stdout.includes('通过 2/4'), `应执行 4 个用例: ${stdout}`);
});

// ==================== JS 驱动 ====================

test('JS 驱动生成：全参数解析 + 节点转换接入（第 206/236 题形态）', () => {
    const lru = 'var reverseList = function(head) { return head; };\n';
    const gen206 = generateDebugFile('javascript', '206', 'reverse-linked-list', '[1,2,3]\n[]', lru, '/tmp/206.js', [], [[[1, 2, 3]], [[]]]);
    assert.ok(gen206);
    assert.ok(gen206!.content.includes('"name":"head"'), '应解析出 head 参数');
    assert.ok(gen206!.content.includes('convertArg'), '入参转换必须接入调用链');

    const lca = 'function lowestCommonAncestor(root, p, q) { return root; };\n';
    const gen236 = generateDebugFile('javascript', '236', 'lowest-common-ancestor-of-a-binary-tree', '[3,5,1]\n5\n1', lca, '/tmp/236.js', []);
    assert.ok(gen236);
    assert.ok(gen236!.content.includes('"name":"p"') && gen236!.content.includes('"name":"q"'), '≥3 参数不得丢弃（236 的 p/q）');
});

test('JS 驱动运行期：链表入参自动转换（第 206 题形态）', (t) => {
    const probe = spawnSync(process.platform === 'win32' ? 'node' : 'node', ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
        t.skip('本机无 node，跳过 JS 驱动级验证');
        return;
    }
    const snippet =
        'var reverseList = function(head) {\n' +
        '    var prev = null;\n' +
        '    while (head) { var next = head.next; head.next = prev; prev = head; head = next; }\n' +
        '    return prev;\n' +
        '};\n';
    const gen = generateDebugFile('javascript', '206', 'reverse-linked-list', '[1,2,3]\n[]', snippet, '/tmp/206_rev.js', [], [[[1, 2, 3]], [[]]]);
    assert.ok(gen);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-fix-reg-js-'));
    try {
        const driver = path.join(dir, '206_reverse-linked-list_debug.js');
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync('node', [driver], { encoding: 'utf8' });
        assert.ok(!res.stdout.includes('运行出错'), `JS 驱动不应运行出错: ${res.stdout}\n${res.stderr}`);
        assert.ok(res.stdout.includes('[ 3, 2, 1 ]'), `链表应被转换并序列化为 [3,2,1]: ${res.stdout}`);
        assert.ok(res.stdout.includes('输出: []'), `空链表应输出 []: ${res.stdout}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// ==================== webview 生成物卫生 ====================

test('webview 卫生：题面/题解面板模板无内联事件属性（CSP nonce 会拦截）', () => {
    const srcDir = path.join(__dirname, '..', '..', 'src');
    const panelSrc = fs.readFileSync(path.join(srcDir, 'views', 'problemPanel.ts'), 'utf8');
    assert.ok(!/on(?:click|error|load|mouseover)=/.test(panelSrc), 'problemPanel.ts 不得含内联事件属性');
    const extSrc = fs.readFileSync(path.join(srcDir, 'extension.ts'), 'utf8');
    for (const line of extSrc.split('\n')) {
        if (/on(?:click|error|load|mouseover)=/.test(line)) {
            // 仅登录 webview 允许内联事件（该页 CSP 为 script-src 'unsafe-inline'）
            assert.ok(/autoBtn|openLeetCode|submitCookie|setAutoStatus/.test(line),
                `非登录 webview 的内联事件属性（被 CSP 拦截后点击无反应）: ${line.trim()}`);
        }
    }
});
