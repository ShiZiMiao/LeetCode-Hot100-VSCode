/**
 * Python 驱动 ListNode/TreeNode 入参转换单测。
 * 回归背景：convert() 曾是死代码（func(*args) 直接传裸 list），链表/树题本地调试
 * 全部报 'list' object has no attribute 'val'；且空链表返回 None 未按判题序列化为 []。
 * 覆盖：链表入参转换（第 21 题形态）/ 树入参+空结果 / 环形链表 pos 接环（141 形态）/
 * List[ListNode] 序列（第 23 题形态）。python3 缺失时跳过（不阻塞 CI 平台差异）。
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateDebugFile } from '../utils/debugUtils';

/** 生成驱动写入临时目录并用 python 运行，返回 stdout；无 python 时 skip 并返回 null */
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-node-convert-test-'));
    try {
        const sol = path.join(dir, `${questionId}_${titleSlug}.py`);
        fs.writeFileSync(sol, snippet);
        const driver = path.join(dir, `${questionId}_${titleSlug}_debug.py`);
        const gen = generateDebugFile('python3', questionId, titleSlug, cases, snippet, sol.replace(/\\/g, '/'), expected, exampleInputs);
        assert.ok(gen, 'generateDebugFile 应返回 python 驱动');
        fs.writeFileSync(driver, gen!.content);
        const res = spawnSync(py, [driver], { encoding: 'utf8' });
        assert.ok(!res.stdout.includes('运行出错'), `驱动不应运行出错: stdout=${res.stdout}\nstderr=${res.stderr}`);
        return res.stdout;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('Python 驱动生成：入参转换已接入调用点（死代码回归防护）', () => {
    const snippet = 'class Solution:\n    def mergeTwoLists(self, l1: ListNode, l2: ListNode) -> ListNode:\n        return l1\n';
    const gen = generateDebugFile('python3', '21', 'merge-two-sorted-lists', '[1]\n[]', snippet, '/tmp/21_merge.py', ['[1]']);
    assert.ok(gen);
    assert.ok(gen!.content.includes('call_args = [convert('), 'convert 必须作用于入参');
    assert.ok(gen!.content.includes('result = func(*call_args)'), '调用点应传转换后的参数');
    assert.ok(gen!.content.includes('ann = str(annotation)'), '注解需字符串化后判定（类对象直接 in 会 TypeError）');
    assert.ok(gen!.content.includes('ret_ann'), '需按返回注解处理空链表/空树结果');
});

test('Python 驱动运行期：链表入参转换 + 空链表返回 None 按 [] 校验（第 21 题形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def mergeTwoLists(self, l1: ListNode, l2: ListNode) -> ListNode:\n' +
        '        if not l1 or not l2:\n' +
        '            return l1 or l2\n' +
        '        if l1.val < l2.val:\n' +
        '            l1.next = self.mergeTwoLists(l1.next, l2)\n' +
        '            return l1\n' +
        '        l2.next = self.mergeTwoLists(l1, l2.next)\n' +
        '        return l2\n';
    const stdout = runDriver(
        t,
        '21',
        'merge-two-sorted-lists',
        snippet,
        '[1,2,4]\n[1,3,4]\n[]\n[]\n[]\n[0]',
        ['[1,1,2,3,4,4]', '[]', '[0]']
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `3 个示例应全部通过: ${stdout}`);
    assert.ok(stdout.includes('通过 3/3'), `应通过 3/3: ${stdout}`);
});

test('Python 驱动运行期：树入参转换 + 空树结果按 [] 校验（第 226 题形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def invertTree(self, root: TreeNode) -> TreeNode:\n' +
        '        if root is None:\n' +
        '            return None\n' +
        '        root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n' +
        '        return root\n';
    const stdout = runDriver(
        t,
        '226',
        'invert-binary-tree',
        snippet,
        '[4,2,7,1,3,6,9]\n[]',
        ['[4,7,2,9,6,3,1]', '[]']
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `应全部通过: ${stdout}`);
    assert.ok(stdout.includes('通过 2/2'), `应通过 2/2: ${stdout}`);
});

test('Python 驱动运行期：环形链表按 pos 接环后判定（第 141 题形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def hasCycle(self, head: ListNode) -> bool:\n' +
        '        slow = fast = head\n' +
        '        while fast is not None and fast.next is not None:\n' +
        '            slow = slow.next\n' +
        '            fast = fast.next.next\n' +
        '            if slow is fast:\n' +
        '                return True\n' +
        '        return False\n';
    const stdout = runDriver(
        t,
        '141',
        'linked-list-cycle',
        snippet,
        '[3,2,0,-4]\n1\n[1,2]\n0\n[1]\n-1',
        ['true', 'true', 'false']
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `pos 接环后应全部通过: ${stdout}`);
    assert.ok(stdout.includes('通过 3/3'), `应通过 3/3: ${stdout}`);
});

test('Python 驱动运行期：List[ListNode] 序列入参转换 + 空列表（第 23 题形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def mergeKLists(self, lists: List[ListNode]) -> ListNode:\n' +
        '        dummy = ListNode()\n' +
        '        curr = dummy\n' +
        '        heap = [(node.val, i, node) for i, node in enumerate(lists) if node]\n' +
        '        heapq.heapify(heap)\n' +
        '        while heap:\n' +
        '            _, i, node = heapq.heappop(heap)\n' +
        '            curr.next = node\n' +
        '            curr = node\n' +
        '            if node.next:\n' +
        '                heapq.heappush(heap, (node.next.val, i, node.next))\n' +
        '        return dummy.next\n';
    const stdout = runDriver(
        t,
        '23',
        'merge-k-sorted-lists',
        snippet,
        '[[1,4,5],[1,3,4],[2,6]]\n[]',
        ['[1,1,2,3,4,4,5,6]', '[]']
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `应全部通过: ${stdout}`);
    assert.ok(stdout.includes('通过 2/2'), `应通过 2/2: ${stdout}`);
});

test('Python 驱动运行期：附加用例按值配对不误判（第 94 题形态：隐藏用例插在中间）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def inorderTraversal(self, root: TreeNode) -> List[int]:\n' +
        '        res = []\n' +
        '        def walk(node):\n' +
        '            if node is None:\n' +
        '                return\n' +
        '            walk(node.left)\n' +
        '            res.append(node.val)\n' +
        '            walk(node.right)\n' +
        '        walk(root)\n' +
        '        return res\n';
    // 官方 exampleTestcases 含展示示例之外的隐藏用例（位置 2）：按位置配对会把期望错位、误报不通过
    const cases = '[1,null,2,3]\n[1,2,3,4,5,null,8,null,null,6,7,9]\n[]\n[1]';
    const stdout = runDriver(
        t,
        '94',
        'binary-tree-inorder-traversal',
        snippet,
        cases,
        ['[1,3,2]', '[]', '[1]'],
        [[[1, null, 2, 3]], [[]], [[1]]]
    );
    if (stdout === null) {
        return;
    }
    assert.ok(!stdout.includes('❌ 不通过'), `隐藏用例不得误判、配对不得错位: ${stdout}`);
    assert.ok(stdout.includes('通过 3/4'), `3 个示例应通过、1 个附加用例未校验: ${stdout}`);
    assert.ok(stdout.includes('附加测试用例'), `附加用例应注明未校验原因: ${stdout}`);
});

test('Python 驱动运行期：空树原地修改比对 []（第 114 题形态）', (t) => {
    const snippet =
        'class Solution:\n' +
        '    def flatten(self, root: TreeNode) -> None:\n' +
        '        def walk(node):\n' +
        '            if not node:\n' +
        '                return None, None\n' +
        '            l, lr = walk(node.left)\n' +
        '            r, rr = walk(node.right)\n' +
        '            node.left = None\n' +
        '            if l:\n' +
        '                node.right = l\n' +
        '                lr.right = r\n' +
        '            else:\n' +
        '                node.right = r\n' +
        '            return node, rr or lr or node\n' +
        '        walk(root)\n';
    const stdout = runDriver(
        t,
        '114',
        'flatten-binary-tree-to-linked-list',
        snippet,
        '[1,2,5,3,4,null,6]\n[]\n[0]',
        ['[1,null,2,null,3,null,4,null,5,null,6]', '[]', '[0]'],
        [[[1, 2, 5, 3, 4, null, 6]], [[]], [[0]]]
    );
    if (stdout === null) {
        return;
    }
    assert.ok(stdout.includes('✅ 全部通过'), `应全部通过（含空树示例）: ${stdout}`);
});
