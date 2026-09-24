/**
 * Python 本地调试驱动模板（纯函数，无 vscode 依赖）。
 * 生成的驱动通过 importlib 加载题解代码文件（不复制代码，断点可直接打在题解文件上）：
 * - 注入判题环境依赖与 ListNode/TreeNode（含环形链表 pos 接环、防环序列化）
 * - 按签名注解转换入参（ListNode/TreeNode/List[ListNode]；节点引用以值给出时按值查找）
 * - 用例 ↔ 示例期望按值配对（官方用例可含展示示例之外的附加用例，位置不定）
 * - 空链表/空树结果按判题序列化 []；原地修改无返回值题取被修改入参比对
 */

/** 从 python3 代码片段提取入口函数名（跳过注释、优先 class Solution 后第一个 def） */
function pythonFuncName(codeSnippet: string): string {
    const codeNoComments = codeSnippet.replace(/^\s*#.*$/gm, '');
    const classIdx = codeNoComments.indexOf('class Solution');
    const funcBody = classIdx !== -1 ? codeNoComments.slice(classIdx) : codeNoComments;
    const funcMatch = funcBody.match(/def\s+(\w+)\s*\(/);
    return funcMatch ? funcMatch[1] : 'solution';
}

export function pythonDebugDriver(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    sourceFilePath: string,
    expectedOutputs: string[],
    exampleInputs: unknown[][],
    isSpecialProblem: boolean
): string {
    const funcName = pythonFuncName(codeSnippet);
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
    // 题面示例输入（与期望同序）：官方 exampleTestcases 可含展示示例之外的附加用例（位置不定），
    // 驱动按值把用例与示例期望配对；提取不全（空数组）时退回位置配对
    const inputsB64 = Buffer.from(JSON.stringify(exampleInputs), 'utf8').toString('base64');
    // 用例文本同样以 base64 内嵌：样例为带引号字符串（如第 20 题括号题，行尾是 " ），
    // 直接拼进 """...""" 会与闭合定界符连成 4 连引号产生 SyntaxError
    const testCasesB64 = Buffer.from(testCases, 'utf8').toString('base64');

    return `# ============================================
# LeetCode ${questionId}. ${titleSlug} - 本地调试驱动
# 通过 importlib 加载题解代码文件（不复制代码，断点可直接打在题解文件上）
# 自动注入判题环境依赖（按 2026-09 判题机 globals() 实测对齐）与 ListNode/TreeNode
# 按解法签名自动解析参数；注解为 ListNode/TreeNode 时自动转换（含 List[ListNode] 与环形链表 pos 接环）
# 用例与题面示例期望按值配对；空链表/空树返回值按判题序列化为 []
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
# 调试自保护：把驱动自身从 pydevd 的 trace 中排除——驱动里的断点不触发、
# 单步/步出直接穿过、调用栈隐藏，停止点只出现在题解代码文件里。
# 主通道是扩展启动调试时注入的 PYDEVD_FILTERS 环境变量（对第 1 行代码即生效）；
# 这里是运行期向已连上的 pydevd 直接注册排除规则的兜底通道（环境变量丢失时生效）。
# 终端直接运行（非调试会话）时 get_global_debugger 为 None，自动跳过、零影响。
# ============================================
def _lc_exclude_debug_self():
    try:
        # 调试会话里 debugpy 引导时必然已 import pydevd；终端直跑则没有——
        # 只查 sys.modules 不主动 import，避免裸环境报"未生效"噪声
        _pydevd = sys.modules.get("pydevd")
        if _pydevd is None:
            return "not-debugging"
        dbg = _pydevd.get_global_debugger()
        if dbg is None:
            return "not-debugging"
        from _pydevd_bundle.pydevd_filtering import ExcludeFilter
        me = os.path.abspath(__file__)
        ff = dbg._files_filtering
        if ff.exclude_by_filter(me, None) is True:
            return "enabled"
        ff.set_exclude_filters(list(ff._exclude_filters) + [ExcludeFilter(me, True, True)])
        dbg._clear_caches()
        return "enabled"
    except Exception as ex:
        return "failed: %r" % (ex,)

_LC_DEBUG_FILTER = _lc_exclude_debug_self()

# ============================================
# 常用数据结构定义（LeetCode 判题环境默认提供，本地等价还原）
# ============================================

class ListNode:
    """链表节点"""
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

    @staticmethod
    def from_list(arr, pos=-1):
        if not arr:
            return None
        head = ListNode(arr[0])
        curr = head
        nodes = [head]
        for val in arr[1:]:
            curr.next = ListNode(val)
            curr = curr.next
            nodes.append(curr)
        # pos >= 0 时尾节点接回 pos 处节点成环（环形链表题）；-1/越界不接
        if pos is not None and 0 <= pos < len(nodes):
            curr.next = nodes[pos]
        return head

    def to_list(self):
        result = []
        curr = self
        # 环形链表结果不终止，按已访问节点去重截断
        seen = set()
        while curr and id(curr) not in seen:
            seen.add(id(curr))
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
        return heapq._heapify_max(heap)
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

# 设计类题（无 class Solution 入口，如 MyHashMap/Trie）不在加载期断言，
# __main__ 里识别后提示并跳过通用运行
Solution = getattr(module, "Solution", None)

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


def _find_node(root, val):
    """在链表/树结构中按值查找节点（236 等题 p/q 以节点值给出引用；题面约束节点值互不相同）"""
    seen = set()
    stack = [root]
    while stack:
        node = stack.pop()
        if node is None or id(node) in seen:
            continue
        seen.add(id(node))
        if node.val == val:
            return node
        stack.append(getattr(node, "next", None))
        stack.append(getattr(node, "left", None))
        stack.append(getattr(node, "right", None))
    return None


if __name__ == "__main__":
    # 设计类题（Solution 缺失）不在入口实例化：下方特殊题分支提示后跳过

    # LeetCode 测试用例（每行一个 JSON 值；带 "名称 = " 前缀时自动剥离）
    test_cases = base64.b64decode("${testCasesB64}").decode('utf-8')

    print("=" * 50)
    print("开始本地调试")
    print("=" * 50)
    # 调试过滤状态（仅调试会话下有意义）
    if _LC_DEBUG_FILTER == "enabled":
        print("ℹ️ 调试过滤已生效：断点与单步只作用于题解代码文件，驱动对调试器不可见")
    elif _LC_DEBUG_FILTER == "not-debugging":
        pass
    else:
        print("⚠️ 调试过滤未生效（" + _LC_DEBUG_FILTER + "），单步可能仍会停进驱动文件；"
              "若在扩展开发主机里看到此提示，请 Ctrl+R 重载后重试")

    lines = [line.strip() for line in test_cases.strip().split('\\n') if line.strip()]

    try:
        # 期望输出（来自题面示例，逐示例比对）；base64 内嵌避免引号/换行破坏驱动
        expected_meta = json.loads(base64.b64decode("${expectedB64}"))

        # 题面示例输入（与 expected_meta 同序）：官方用例可含展示示例之外的附加用例（位置不定），
        # 按值把用例与示例期望配对；提取不全（空）时退回位置配对
        example_inputs = json.loads(base64.b64decode("${inputsB64}"))

        # 特殊判题题识别：生成时已按代码结构标记；运行期再兜两道信号——
        # Solution 缺失 = 设计类；用例首行为类名开头的操作序列 + 次行等长参数数组 = 设计类数据形状
        gen_special = ${isSpecialProblem ? 'True' : 'False'}
        ops_seq = False
        if not gen_special and lines:
            try:
                first_val = json.loads(lines[0])
                second_val = json.loads(lines[1]) if len(lines) >= 2 else None
                # 判定收紧：字符串须为合法标识符且首项含大写（类名形态，如 MyHashMap/MinStack），
                # 避免普通题恰好前两例都是等长字符串数组时误判为操作序列（如异位词分组）
                ops_seq = (isinstance(first_val, list) and len(first_val) > 0
                           and all(isinstance(x, str) and x.isidentifier() for x in first_val)
                           and first_val[0][:1].isupper()
                           and isinstance(second_val, list) and len(second_val) == len(first_val))
            except Exception:
                ops_seq = False
        if gen_special or Solution is None or ops_seq:
            if Solution is None:
                print("⚠️ 未识别到 class Solution 入口（设计类题按操作序列调用），无法通用运行官方示例")
            else:
                print("⚠️ 该题为特殊判题题（操作序列或自定义校验参数），无法通用运行官方示例")
            print("   请在文件末尾的自定义调用区手动构造用例")
        elif lines:
            values = []
            for line in lines:
                if "=" in line and not line.lstrip().startswith(("[", "{", '"', "'")):
                    line = line.split("=", 1)[1].strip()
                values.append(json.loads(line))

            solution = Solution()
            func = solution.${funcName}

            # 派生量先行计算（签名/分组），供下方 run_and_compare 直接引用（避免晚绑定时序坑）
            func_sig = inspect.signature(func)
            sig_params = list(func_sig.parameters.values())
            ret_ann = str(func_sig.return_annotation)
            n = len(sig_params)
            ex_count = len(expected_meta)
            groups = None
            group_extras = None
            if n > 0 and ex_count > 0 and len(values) % ex_count == 0:
                per = len(values) // ex_count
                if per >= n:
                    # 按题面示例数分组：每组前 n 个值作为入参（兼容带校验参数的题，如环形链表的 pos）
                    groups = [[v for v in values[i * per:(i + 1) * per][:n]] for i in range(ex_count)]
                    group_extras = [values[i * per:(i + 1) * per][n:] for i in range(ex_count)]
            if groups is None and n > 0 and len(values) % n == 0:
                groups = [values[i:i + n] for i in range(0, len(values), n)]
            if groups is None:
                groups = [values]
            if group_extras is None:
                group_extras = [[] for _ in groups]

            def convert(value, annotation):
                """按注解把普通列表转换为 ListNode/TreeNode（判题环境默认类型）"""
                ann = str(annotation)
                for name, node_cls in (("ListNode", ListNode), ("TreeNode", TreeNode)):
                    if name not in ann:
                        continue
                    if value is None:
                        return None
                    # List[ListNode] 序列形态（合并 K 个链表）或值本身是嵌套列表 → 逐个转换
                    if ("List[" in ann or "list[" in ann or "Sequence[" in ann
                            or (isinstance(value, list) and value and isinstance(value[0], list))):
                        return [node_cls.from_list(v) for v in (value or [])]
                    if not isinstance(value, (list, tuple)):
                        # 节点引用以标量值给出（如 LCA 题 p = 5）：降级为单节点防迭代崩溃
                        return node_cls.from_list([value])
                    return node_cls.from_list(value)
                return value

            def run_and_compare(args, idx):
                """运行一个示例并比对期望输出；返回 (是否通过, 是否已校验)"""
                try:
                    # 用例↔示例期望按值配对（附加用例不比对）；无输入提取时退回位置配对
                    ei = idx
                    if example_inputs:
                        key = list(args) + (list(group_extras[idx]) if idx < len(group_extras) else [])
                        ei = -1
                        for cand, ins in enumerate(example_inputs):
                            if len(ins) == len(key) and all(_normalize(a) == _normalize(b) for a, b in zip(ins, key)):
                                ei = cand
                                break
                        if ei == -1:
                            # 题面未展示的附加参数会拼长 key：退一步按展示参数与候选前缀配对
                            for cand, ins in enumerate(example_inputs):
                                if len(ins) >= len(args) and all(_normalize(a) == _normalize(b) for a, b in zip(ins, args)):
                                    ei = cand
                                    break
                    print(f"示例{idx + 1} 输入: {args}")
                    # 按签名注解转换入参（ListNode/TreeNode 是判题环境的默认参数类型）
                    call_args = [convert(v, sig_params[i].annotation) if i < len(sig_params) else v
                                 for i, v in enumerate(args)]
                    # 节点引用以值给出（236 LCA 的 p/q 是树内节点）：按值在首个节点结构里查找
                    struct = next((a for a in call_args if hasattr(a, "to_list")), None)
                    if struct is not None:
                        for i2, v2 in enumerate(args):
                            if (i2 < len(sig_params) and isinstance(v2, (int, float)) and not isinstance(v2, bool)
                                    and ("ListNode" in str(sig_params[i2].annotation)
                                         or "TreeNode" in str(sig_params[i2].annotation))):
                                ref = _find_node(struct, v2)
                                if ref is not None:
                                    call_args[i2] = ref
                    # 环形链表题（141/142）：单链表参数且每例多带一个 pos 整数 → 按 pos 尾接成环
                    ex = group_extras[idx] if idx < len(group_extras) else []
                    if (n == 1 and len(call_args) == 1 and len(ex) == 1
                            and isinstance(ex[0], int) and not isinstance(ex[0], bool)
                            and isinstance(args[0], list) and hasattr(call_args[0], "to_list")):
                        call_args[0] = ListNode.from_list(args[0], ex[0])
                    result = func(*call_args)
                    type_name = type(result).__name__
                    exp_now = expected_meta[ei][1] if 0 <= ei < len(expected_meta) and expected_meta[ei][0] else None
                    # 节点引用型输出（236 LCA）题面给节点值标量，其余节点输出给序列化列表
                    scalar_ref = isinstance(exp_now, (int, float)) and not isinstance(exp_now, bool)
                    if "ListNode" in type_name and hasattr(result, "to_list"):
                        result = result.val if scalar_ref else result.to_list()
                    elif "TreeNode" in type_name and hasattr(result, "to_list"):
                        result = result.val if scalar_ref else result.to_list()
                    elif result is None and ("ListNode" in ret_ann or "TreeNode" in ret_ann):
                        # 判题机把空链表/空树结果序列化为 []（如合并两空链表返回 None）
                        result = []
                    # 原地修改无返回值题（移动零/旋转图像/合并有序数组等）：LeetCode 判题
                    # 比对的是函数执行后**被修改的入参**而非返回值。返回 None 且题面期望值
                    # 非 null 时，取第一个可变参数（list/dict/ListNode/TreeNode）作为实际结果。
                    # 两个可变参数时取第一个（如 merge 的 nums1 是被修改方且排前）。
                    if result is None:
                        if exp_now is not None:
                            for a in call_args:
                                if isinstance(a, (list, dict)) or hasattr(a, "to_list"):
                                    result = a.to_list() if hasattr(a, "to_list") else a
                                    break
                            if result is None and exp_now == []:
                                # 原地修改题的空结构入参（None，如空树）判题序列化即 []
                                result = []
                    print(f"示例{idx + 1} 输出: {result}")
                    if 0 <= ei < len(expected_meta):
                        meta_ok, exp = expected_meta[ei]
                        if not meta_ok:
                            print(f"示例{idx + 1} ⚠️ 未校验（题面输出为非标准文本）")
                            return False, False
                        if same_value(result, exp):
                            note = "（顺序无关，仅顺序不同）" if result != exp else ""
                            print(f"示例{idx + 1} ✅ 通过{note}")
                            return True, True
                        print(f"示例{idx + 1} ❌ 不通过（期望: {exp}）")
                        return False, True
                    if ei == -1:
                        print(f"示例{idx + 1} ⚠️ 未校验（附加测试用例，题面无对应示例）")
                    else:
                        print(f"示例{idx + 1} ⚠️ 未校验（无期望输出）")
                    return False, False
                except Exception as ex:
                    print(f"示例{idx + 1} 运行出错: {ex}")
                    return False, False

            total = passed = unchecked = 0
            for idx, args in enumerate(groups):
                total += 1
                ok_p, ok_c = run_and_compare(args, idx)
                passed += 1 if ok_p else 0
                unchecked += 1 if not ok_c else 0

            if expected_meta:
                # 未校验 ≠ 失败：只在真有比对失败时才显示 ❌
                failed = total - passed - unchecked
                if failed > 0:
                    sign = "❌ 有失败"
                elif unchecked > 0:
                    sign = "⚠️ 含未校验"
                else:
                    sign = "✅ 全部通过"
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
