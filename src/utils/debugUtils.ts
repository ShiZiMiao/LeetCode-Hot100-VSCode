/**
 * 调试工具
 * 为不同语言生成本地调试代码
 */

/**
 * 生成 Python 本地调试驱动：不复制用户代码，通过 importlib 加载题解代码文件，
 * 断点可直接打在题解代码文件上（帧指向真实文件路径）。
 */
/**
 * 生成 Python 本地调试驱动：
 * - 不复制用户代码，通过 importlib 加载题解代码文件（断点可直接打在题解文件上）
 * - 自动注入 LeetCode 判题环境的常用依赖（typing/collections 等）与 ListNode/TreeNode
 * - 按解法函数签名自动解析测试用例（任意参数个数），注解含 ListNode/TreeNode 时自动转换
 */
export function generatePythonDebugDriver(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    sourceFilePath: string,
    expectedOutputs: string[] = []
): string {
    // 提取函数名：跳过注释（snippet 里 ListNode/TreeNode 定义是注释掉的防引入），
    // 并优先取 class Solution 之后的第一个 def（用户文件里可能写了辅助函数）
    const codeNoComments = codeSnippet.replace(/^\s*#.*$/gm, '');
    const classIdx = codeNoComments.indexOf('class Solution');
    const funcBody = classIdx !== -1 ? codeNoComments.slice(classIdx) : codeNoComments;
    const funcMatch = funcBody.match(/def\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';
    // 统一正斜杠并转义双引号，保证 Windows 路径安全写入字符串字面量
    const sourcePath = sourceFilePath.replace(/\\/g, '/').replace(/"/g, '\\"');

    // 期望输出以 base64 内嵌，每项为 [是否可解析, 值]：
    // 题面输出为非标准文本（如链表示例的 "Intersected at '8'"）时标为不可解析，驱动侧显示"未校验"
    const expectedMeta = expectedOutputs.map((v) => {
        try {
            return [1, JSON.parse(v)];
        } catch {
            return [0, v];
        }
    });
    const expectedB64 = Buffer.from(JSON.stringify(expectedMeta), 'utf8').toString('base64');

    // 特殊判题题：设计类（操作序列格式）、160（校验参数 intersectVal 在最前）、
    // 138（Node 带 random 指针，本地 ListNode 无法等价还原），无法通用运行官方示例
    const isSpecialProblem = [
        'lru-cache',
        'min-stack',
        'implement-trie-prefix-tree',
        'find-median-from-data-stream',
        'intersection-of-two-linked-lists',
        'copy-list-with-random-pointer'
    ].includes(titleSlug);

    return `# ============================================
# LeetCode ${questionId}. ${titleSlug} - 本地调试驱动
# 通过 importlib 加载题解代码文件（不复制代码，断点可直接打在题解文件上）
# 自动注入判题环境依赖（按 2026-09 判题机 globals() 实测对齐）与 ListNode/TreeNode
# 按解法签名自动解析参数；注解为 ListNode/TreeNode 时自动转换
# 源码文件: ${sourcePath}
# ============================================

import json
import base64
import importlib.util
import inspect
import sys
import os
import io
import collections
import heapq
import itertools
import functools
import math
import bisect
import string
import re
import copy
import time
import random
import statistics
import operator
import datetime
import typing
from collections import deque

# ============================================
# 常用数据结构定义（LeetCode 判题环境默认提供，本地等价还原）
# ============================================

class ListNode:
    """链表节点"""
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    @staticmethod
    def from_list(arr):
        if not arr:
            return None
        head = ListNode(arr[0])
        curr = head
        for val in arr[1:]:
            curr.next = ListNode(val)
            curr = curr.next
        return head

    def to_list(self):
        result = []
        curr = self
        while curr:
            result.append(curr.val)
            curr = curr.next
        return result

class TreeNode:
    """二叉树节点"""
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

    @staticmethod
    def from_list(arr):
        if not arr or arr[0] is None:
            return None
        root = TreeNode(arr[0])
        queue = deque([root])
        i = 1
        while queue and i < len(arr):
            node = queue.popleft()
            if i < len(arr) and arr[i] is not None:
                node.left = TreeNode(arr[i])
                queue.append(node.left)
            i += 1
            if i < len(arr) and arr[i] is not None:
                node.right = TreeNode(arr[i])
                queue.append(node.right)
            i += 1
        return root

    def to_list(self):
        if self is None:
            return []
        result = []
        queue = deque([self])
        while queue:
            node = queue.popleft()
            if node is None:
                result.append(None)
                continue
            result.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        while result and result[-1] is None:
            result.pop()
        return result

# ============================================
# 加载题解代码文件中的 Solution（注入判题环境依赖）
# ============================================

spec = importlib.util.spec_from_file_location("lc_solution", "${sourcePath}")
module = importlib.util.module_from_spec(spec)
sys.modules["lc_solution"] = module
# 与 LeetCode 判题环境一致的全局预导入（2026-09 实测判题机 globals() 对齐）。
# 复测探针：题面编辑器粘贴 class Solution 内 print(sorted(globals())) 运行即可。
def _lc_star(mod):
    names = getattr(mod, '__all__', None)
    if names is None:
        names = [n for n in dir(mod) if not n.startswith('_')]
    d = {}
    for n in names:
        try:
            d[n] = getattr(mod, n)
        except Exception:
            pass
    return d

_PRELUDE = {}
# 星导入模块（模块名 + 全部公开成员都在判题全局）
for _m in [string, re, collections, heapq, bisect, copy, math, random, statistics, itertools, functools, operator, io, sys, json]:
    _PRELUDE.update(_lc_star(_m))
    _PRELUDE[_m.__name__] = _m
# 仅模块名：time/os；datetime 另显式导入常用类（判题机 datetime 名字本身是模块）
_PRELUDE['time'] = time
_PRELUDE['os'] = os
_PRELUDE['datetime'] = datetime
for _n in ('date', 'timedelta', 'timezone', 'tzinfo', 'MINYEAR', 'MAXYEAR', 'UTC'):
    _PRELUDE[_n] = getattr(datetime, _n, None)
# sortedcontainers：判题机预装；本地未安装时用 bisect 兜底实现常见接口（调试够用）
try:
    import sortedcontainers
    _PRELUDE.update(_lc_star(sortedcontainers))
    _PRELUDE['sortedcontainers'] = sortedcontainers
except ImportError:
    class SortedList:
        def __init__(self, iterable=None):
            self._items = sorted(iterable) if iterable else []
        def add(self, value):
            bisect.insort_right(self._items, value)
        def update(self, iterable):
            for value in iterable:
                self.add(value)
        def discard(self, value):
            try:
                self.remove(value)
            except ValueError:
                pass
        def remove(self, value):
            i = bisect.bisect_left(self._items, value)
            if i == len(self._items) or self._items[i] != value:
                raise ValueError('%r not found in SortedList' % (value,))
            self._items.pop(i)
        def pop(self, index=-1):
            return self._items.pop(index)
        def count(self, value):
            return self._items.count(value)
        def index(self, value, start=0, stop=None):
            return self._items.index(value, start, len(self._items) if stop is None else stop)
        def irange(self, minimum=None, maximum=None, inclusive=(True, True)):
            lo = -math.inf if minimum is None else minimum
            hi = math.inf if maximum is None else maximum
            left, right = inclusive
            return iter([x for x in self._items
                         if (x >= lo if left else x > lo) and (x <= hi if right else x < hi)])
        def islice(self, start=0, end=None):
            return iter(self._items[start:end])
        def __len__(self):
            return len(self._items)
        def __iter__(self):
            return iter(self._items)
        def __contains__(self, value):
            return value in self._items
        def __getitem__(self, index):
            if isinstance(index, slice):
                return SortedList(self._items[index])
            return self._items[index]
        def __repr__(self):
            return 'SortedList(%r)' % (self._items,)
    _PRELUDE['SortedList'] = SortedList
# typing 星导入放最后：与判题机一致（typing 的 Pattern/Match 会覆盖 re 的同名符号）
_PRELUDE.update(_lc_star(typing))
# LeetCode 在 stdlib heapq 上补充的 max-heap 变体，用 CPython 私有函数等价还原
try:
    heapq._siftdown_max, heapq._heappop_max, heapq._heapify_max, heapq._heapreplace_max, heapq._siftup_max
    def heappush_max(heap, item):
        heap.append(item)
        heapq._siftdown_max(heap, 0, len(heap) - 1)
    def heappop_max(heap):
        return heapq._heappop_max(heap)
    def heapify_max(heap):
        heapq._heapify_max(heap)
    def heapreplace_max(heap, item):
        return heapq._heapreplace_max(heap, item)
    def heappushpop_max(heap, item):
        # 大顶堆：item 比当前最大值大则 item 直接作为结果弹出
        if not heap or heap[0] < item:
            return item
        ret = heap[0]
        heap[0] = item
        heapq._siftup_max(heap, 0)
        return ret
    _PRELUDE.update({
        'heappush_max': heappush_max, 'heappop_max': heappop_max, 'heapify_max': heapify_max,
        'heapreplace_max': heapreplace_max, 'heappushpop_max': heappushpop_max,
    })
except AttributeError:
    pass
# 本地版 ListNode/TreeNode 最后覆盖（带 from_list/to_list，供入参转换与结果比对）
module.__dict__.update(_PRELUDE)
module.__dict__.update({"ListNode": ListNode, "TreeNode": TreeNode})
spec.loader.exec_module(module)

Solution = module.Solution

# ============================================
# 测试运行
# ============================================

def _canonical(v):
    """嵌套列表排序规范化（比较时忽略顺序），叶子用 repr 排序避免类型不可比"""
    if isinstance(v, (list, tuple)):
        return tuple(sorted((_canonical(x) for x in v), key=repr))
    return v


def _normalize(v):
    """递归归一化：tuple→list（LC 判题按 JSON 序列化比较，tuple 与 list 等价，
    如 twoSum 返回 (0, 1) 同样判定通过；对于 int/float 数值相等也可直接比较）"""
    if isinstance(v, bool):
        return v
    if isinstance(v, (list, tuple)):
        return [_normalize(x) for x in v]
    if isinstance(v, dict):
        return {k: _normalize(val) for k, val in v.items()}
    return v


def same_value(actual, expected):
    """结果与期望比对：先按 LC 判题语义（tuple/list 等价、int/float 数值相等）比较；
    再对顺序无关的输出（嵌套列表或纯字符串列表，如字母异位词分组/全排列/子集/
    括号生成等，LC 本体也按顺序无关判定）做排序规范化比对"""
    # bool 与 int/float 不可互换：Python 中 True == 1，但判题语义区分（期望 true 与 1 不同）
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if _normalize(actual) == _normalize(expected):
        return True
    if isinstance(actual, (list, tuple)) and isinstance(expected, (list, tuple)):
        nested = (bool(actual) and all(isinstance(x, (list, tuple)) for x in actual)
                  and bool(expected) and all(isinstance(x, (list, tuple)) for x in expected))
        flat_strings = all(isinstance(x, str) for x in actual) and all(isinstance(x, str) for x in expected)
        if nested or flat_strings:
            return _canonical(actual) == _canonical(expected)
    return False


if __name__ == "__main__":
    solution = Solution()

    # LeetCode 测试用例（每行一个 JSON 值；带 "名称 = " 前缀时自动剥离）
    test_cases = """${testCases}"""

    print("=" * 50)
    print("开始本地调试")
    print("=" * 50)

    lines = [line.strip() for line in test_cases.strip().split('\\n') if line.strip()]

    try:
        # 期望输出（来自题面示例，逐示例比对）；base64 内嵌避免引号/换行破坏驱动
        expected_meta = json.loads(base64.b64decode("${expectedB64}"))

        # 特殊判题题（设计类操作序列 / 校验参数在最前排布）无法通用运行官方示例
        if ${isSpecialProblem ? 'True' : 'False'}:
            print("⚠️ 该题为特殊判题题（设计类操作序列或自定义校验参数），无法通用运行官方示例")
            print("   请在文件末尾的自定义调用区手动构造用例")
        elif lines:
            values = []
            for line in lines:
                if "=" in line and not line.lstrip().startswith(("[", "{", '"', "'")):
                    line = line.split("=", 1)[1].strip()
                values.append(json.loads(line))

            func = solution.${funcName}

            def convert(value, annotation):
                """按注解把普通列表转换为 ListNode/TreeNode（判题环境默认类型）"""
                if "ListNode" in annotation:
                    if isinstance(value, list) and value and isinstance(value[0], list):
                        return [ListNode.from_list(v) for v in value]
                    return ListNode.from_list(value)
                if "TreeNode" in annotation:
                    return TreeNode.from_list(value)
                return value

            def run_and_compare(args, idx):
                """运行一个示例并比对期望输出；返回 (是否通过, 是否已校验)"""
                try:
                    print(f"示例{idx + 1} 输入: {args}")
                    result = func(*args)
                    type_name = type(result).__name__
                    if "ListNode" in type_name and hasattr(result, "to_list"):
                        result = result.to_list()
                    elif "TreeNode" in type_name and hasattr(result, "to_list"):
                        result = result.to_list()
                    print(f"示例{idx + 1} 输出: {result}")
                    if idx < len(expected_meta):
                        meta_ok, exp = expected_meta[idx]
                        if not meta_ok:
                            print(f"示例{idx + 1} ⚠️ 未校验（题面输出为非标准文本）")
                            return False, False
                        if same_value(result, exp):
                            note = "（顺序无关，仅顺序不同）" if result != exp else ""
                            print(f"示例{idx + 1} ✅ 通过{note}")
                            return True, True
                        print(f"示例{idx + 1} ❌ 不通过（期望: {exp}）")
                        return False, True
                    print(f"示例{idx + 1} ⚠️ 未校验（无期望输出）")
                    return False, False
                except Exception as ex:
                    print(f"示例{idx + 1} 运行出错: {ex}")
                    return False, False

            sig_params = list(inspect.signature(func).parameters.values())
            n = len(sig_params)
            ex_count = len(expected_meta)
            groups = None
            if n > 0 and ex_count > 0 and len(values) % ex_count == 0:
                per = len(values) // ex_count
                if per >= n:
                    # 按题面示例数分组：每组前 n 个值作为入参（兼容带校验参数的题，如环形链表的 pos）
                    groups = [[v for v in values[i * per:(i + 1) * per][:n]] for i in range(ex_count)]
            if groups is None and n > 0 and len(values) % n == 0:
                groups = [values[i:i + n] for i in range(0, len(values), n)]
            if groups is None:
                groups = [values]

            total = passed = unchecked = 0
            for idx, args in enumerate(groups):
                total += 1
                ok_p, ok_c = run_and_compare(args, idx)
                passed += 1 if ok_p else 0
                unchecked += 1 if not ok_c else 0

            if expected_meta:
                sign = "✅ 全部通过" if passed == total else "❌ 有失败"
                extra = f"，{unchecked} 个未校验" if unchecked else ""
                print(f"===== {sign}：通过 {passed}/{total}{extra} =====")
            else:
                print(f"===== 共运行 {total} 个示例（未获取到期望输出，无比对） =====")
        else:
            print("未读取到测试用例，请在驱动文件里自定义调用")
    except Exception as e:
        print(f"运行出错: {e}")
        import traceback
        traceback.print_exc()
`;
}
/**
 * 生成Java调试模板
 */
export function generateJavaDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取方法名
    const funcMatch = codeSnippet.match(/public\s+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    // 生成类名
    const className = titleSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Debug';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 编译: javac ${className}.java
// 运行: java ${className}
// ============================================

import java.util.*;

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
    
    static ListNode fromArray(int[] arr) {
        if (arr == null || arr.length == 0) return null;
        ListNode head = new ListNode(arr[0]);
        ListNode curr = head;
        for (int i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        ListNode curr = this;
        while (curr != null) {
            sb.append(curr.val);
            if (curr.next != null) sb.append(", ");
            curr = curr.next;
        }
        sb.append("]");
        return sb.toString();
    }
}

class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static TreeNode fromArray(Integer[] arr) {
        if (arr == null || arr.length == 0 || arr[0] == null) return null;
        TreeNode root = new TreeNode(arr[0]);
        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);
        int i = 1;
        while (!queue.isEmpty() && i < arr.length) {
            TreeNode node = queue.poll();
            if (i < arr.length && arr[i] != null) {
                node.left = new TreeNode(arr[i]);
                queue.offer(node.left);
            }
            i++;
            if (i < arr.length && arr[i] != null) {
                node.right = new TreeNode(arr[i]);
                queue.offer(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

public class ${className} {
    public static void main(String[] args) {
        Solution solution = new Solution();
        
        System.out.println("==================================================");
        System.out.println("开始本地调试");
        System.out.println("==================================================");
        
        // TODO: 根据题目修改测试参数
        // 示例: 两数之和
        // int[] nums = {2, 7, 11, 15};
        // int target = 9;
        // int[] result = solution.${funcName}(nums, target);
        // System.out.println("结果: " + Arrays.toString(result));
        
        // ============================================
        // 在这里添加你的测试代码
        // ============================================
        
    }
}
`;
}

/**
 * 生成C++调试模板
 */
export function generateCppDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/\s+(\w+)\s*\([^)]*\)\s*{/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 编译: g++ -std=c++17 -o debug ${questionId}_${titleSlug}_debug.cpp
// 运行: ./debug
// ============================================

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <stack>
#include <algorithm>
using namespace std;

// ============================================
// 常用数据结构定义
// ============================================

struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
    
    static ListNode* fromVector(vector<int>& arr) {
        if (arr.empty()) return nullptr;
        ListNode* head = new ListNode(arr[0]);
        ListNode* curr = head;
        for (int i = 1; i < arr.size(); i++) {
            curr->next = new ListNode(arr[i]);
            curr = curr->next;
        }
        return head;
    }
    
    void print() {
        cout << "[";
        ListNode* curr = this;
        while (curr) {
            cout << curr->val;
            if (curr->next) cout << ", ";
            curr = curr->next;
        }
        cout << "]" << endl;
    }
};

struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

// 打印vector
template<typename T>
void printVector(vector<T>& v) {
    cout << "[";
    for (int i = 0; i < v.size(); i++) {
        cout << v[i];
        if (i < v.size() - 1) cout << ", ";
    }
    cout << "]" << endl;
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

int main() {
    Solution solution;
    
    cout << "==================================================" << endl;
    cout << "开始本地调试" << endl;
    cout << "==================================================" << endl;
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // vector<int> nums = {2, 7, 11, 15};
    // int target = 9;
    // vector<int> result = solution.${funcName}(nums, target);
    // printVector(result);
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
    return 0;
}
`;
}

/**
 * 生成JavaScript调试模板
 */
export function generateJavaScriptDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/var\s+(\w+)\s*=\s*function/) ||
        codeSnippet.match(/function\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: node ${questionId}_${titleSlug}_debug.js
// ============================================

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }
    
    static fromArray(arr) {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    toArray() {
        const result = [];
        let curr = this;
        while (curr) {
            result.push(curr.val);
            curr = curr.next;
        }
        return result;
    }
}

class TreeNode {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static fromArray(arr) {
        if (!arr || arr.length === 0 || arr[0] === null) return null;
        const root = new TreeNode(arr[0]);
        const queue = [root];
        let i = 1;
        while (queue.length > 0 && i < arr.length) {
            const node = queue.shift();
            if (i < arr.length && arr[i] !== null) {
                node.left = new TreeNode(arr[i]);
                queue.push(node.left);
            }
            i++;
            if (i < arr.length && arr[i] !== null) {
                node.right = new TreeNode(arr[i]);
                queue.push(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

console.log("==================================================");
console.log("开始本地调试");
console.log("==================================================");

// LeetCode 测试用例
const testCases = \`${testCases}\`;

const lines = testCases.trim().split('\\n').filter(line => line.trim());

if (lines.length >= 1) {
    try {
        const param1 = JSON.parse(lines[0]);
        const param2 = lines.length > 1 ? JSON.parse(lines[1]) : undefined;
        
        console.log("输入参数1:", param1);
        if (param2 !== undefined) {
            console.log("输入参数2:", param2);
        }
        
        // 调用解法
        const result = param2 !== undefined 
            ? ${funcName}(param1, param2)
            : ${funcName}(param1);
        
        console.log("输出结果:", result);
        
    } catch (e) {
        console.error("运行出错:", e);
    }
}

// ============================================
// 自定义测试用例
// ============================================
// const result = ${funcName}([2, 7, 11, 15], 9);
// console.log("自定义测试:", result);
`;
}

/**
 * 生成TypeScript调试模板
 */
export function generateTypeScriptDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/function\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: npx ts-node ${questionId}_${titleSlug}_debug.ts
// ============================================

// ============================================
// 常用数据结构定义
// ============================================

class ListNode {
    val: number;
    next: ListNode | null;
    constructor(val: number = 0, next: ListNode | null = null) {
        this.val = val;
        this.next = next;
    }
    
    static fromArray(arr: number[]): ListNode | null {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
        }
        return head;
    }
    
    toArray(): number[] {
        const result: number[] = [];
        let curr: ListNode | null = this;
        while (curr) {
            result.push(curr.val);
            curr = curr.next;
        }
        return result;
    }
}

class TreeNode {
    val: number;
    left: TreeNode | null;
    right: TreeNode | null;
    constructor(val: number = 0, left: TreeNode | null = null, right: TreeNode | null = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
    
    static fromArray(arr: (number | null)[]): TreeNode | null {
        if (!arr || arr.length === 0 || arr[0] === null) return null;
        const root = new TreeNode(arr[0]);
        const queue: TreeNode[] = [root];
        let i = 1;
        while (queue.length > 0 && i < arr.length) {
            const node = queue.shift()!;
            if (i < arr.length && arr[i] !== null) {
                node.left = new TreeNode(arr[i] as number);
                queue.push(node.left);
            }
            i++;
            if (i < arr.length && arr[i] !== null) {
                node.right = new TreeNode(arr[i] as number);
                queue.push(node.right);
            }
            i++;
        }
        return root;
    }
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

console.log("==================================================");
console.log("开始本地调试");
console.log("==================================================");

// LeetCode 测试用例
const testCases = \`${testCases}\`;

const lines = testCases.trim().split('\\n').filter(line => line.trim());

if (lines.length >= 1) {
    try {
        const param1 = JSON.parse(lines[0]);
        const param2 = lines.length > 1 ? JSON.parse(lines[1]) : undefined;
        
        console.log("输入参数1:", param1);
        if (param2 !== undefined) {
            console.log("输入参数2:", param2);
        }
        
        // 调用解法
        const result = param2 !== undefined 
            ? ${funcName}(param1, param2)
            : ${funcName}(param1);
        
        console.log("输出结果:", result);
        
    } catch (e) {
        console.error("运行出错:", e);
    }
}

// ============================================
// 自定义测试用例
// ============================================
// const result = ${funcName}([2, 7, 11, 15], 9);
// console.log("自定义测试:", result);
`;
}

/**
 * 生成Go调试模板
 */
export function generateGoDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/func\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: go run ${questionId}_${titleSlug}_debug.go
// ============================================

package main

import (
    "fmt"
)

// ============================================
// 常用数据结构定义
// ============================================

type ListNode struct {
    Val  int
    Next *ListNode
}

func NewListNode(arr []int) *ListNode {
    if len(arr) == 0 {
        return nil
    }
    head := &ListNode{Val: arr[0]}
    curr := head
    for i := 1; i < len(arr); i++ {
        curr.Next = &ListNode{Val: arr[i]}
        curr = curr.Next
    }
    return head
}

func (l *ListNode) ToSlice() []int {
    result := []int{}
    curr := l
    for curr != nil {
        result = append(result, curr.Val)
        curr = curr.Next
    }
    return result
}

type TreeNode struct {
    Val   int
    Left  *TreeNode
    Right *TreeNode
}

// ============================================
// 你的解题代码
// ============================================

${codeSnippet}

// ============================================
// 测试运行
// ============================================

func main() {
    fmt.Println("==================================================")
    fmt.Println("开始本地调试")
    fmt.Println("==================================================")
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // nums := []int{2, 7, 11, 15}
    // target := 9
    // result := ${funcName}(nums, target)
    // fmt.Println("结果:", result)
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
}
`;
}

/**
 * 生成Rust调试模板
 */
export function generateRustDebugTemplate(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string
): string {
    // 提取函数名
    const funcMatch = codeSnippet.match(/pub\s+fn\s+(\w+)\s*\(/);
    const funcName = funcMatch ? funcMatch[1] : 'solution';

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: rustc ${questionId}_${titleSlug}_debug.rs && ./${questionId}_${titleSlug}_debug
// 或者: cargo run
// ============================================

use std::collections::{HashMap, HashSet, VecDeque};

// ============================================
// 常用数据结构定义
// ============================================

#[derive(PartialEq, Eq, Clone, Debug)]
pub struct ListNode {
    pub val: i32,
    pub next: Option<Box<ListNode>>,
}

impl ListNode {
    #[inline]
    fn new(val: i32) -> Self {
        ListNode { next: None, val }
    }
    
    fn from_vec(arr: Vec<i32>) -> Option<Box<ListNode>> {
        let mut head: Option<Box<ListNode>> = None;
        for &val in arr.iter().rev() {
            let mut node = ListNode::new(val);
            node.next = head;
            head = Some(Box::new(node));
        }
        head
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct TreeNode {
    pub val: i32,
    pub left: Option<Rc<RefCell<TreeNode>>>,
    pub right: Option<Rc<RefCell<TreeNode>>>,
}

use std::rc::Rc;
use std::cell::RefCell;

impl TreeNode {
    #[inline]
    pub fn new(val: i32) -> Self {
        TreeNode {
            val,
            left: None,
            right: None,
        }
    }
}

// ============================================
// 你的解题代码
// ============================================

struct Solution;

${codeSnippet}

// ============================================
// 测试运行
// ============================================

fn main() {
    println!("==================================================");
    println!("开始本地调试");
    println!("==================================================");
    
    // TODO: 根据题目修改测试参数
    // 示例: 两数之和
    // let nums = vec![2, 7, 11, 15];
    // let target = 9;
    // let result = Solution::${funcName}(nums, target);
    // println!("结果: {:?}", result);
    
    // ============================================
    // 在这里添加你的测试代码
    // ============================================
    
}
`;
}

/**
 * 生成调试文件的内容
 */
export function generateDebugFile(
    lang: string,
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    sourceFilePath: string,
    expectedOutputs: string[] = []
): { fileName: string; content: string } | null {
    switch (lang) {
        case 'python3':
        case 'python':
            return {
                fileName: `${questionId}_${titleSlug}_debug.py`,
                content: generatePythonDebugDriver(questionId, titleSlug, testCases, codeSnippet, sourceFilePath, expectedOutputs)
            };

        case 'java':
            const javaClassName = titleSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Debug';
            return {
                fileName: `${javaClassName}.java`,
                content: generateJavaDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'cpp':
        case 'c++':
            return {
                fileName: `${questionId}_${titleSlug}_debug.cpp`,
                content: generateCppDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'javascript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.js`,
                content: generateJavaScriptDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'typescript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.ts`,
                content: generateTypeScriptDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'golang':
        case 'go':
            return {
                fileName: `${questionId}_${titleSlug}_debug.go`,
                content: generateGoDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'rust':
            return {
                fileName: `${questionId}_${titleSlug}_debug.rs`,
                content: generateRustDebugTemplate(questionId, titleSlug, testCases, codeSnippet)
            };

        default:
            return null;
    }
}
