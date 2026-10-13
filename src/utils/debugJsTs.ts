/**
 * JavaScript / TypeScript 本地调试模板（纯函数，无 vscode 依赖）。
 * 两语言仅类型标注与数据结构定义不同，其余骨架共享（typed 开关）；
 * 设计类题（JS/TS 为函数式入口，结构无法分辨）由模板运行期按用例形状识别。
 */

/** 提取入口函数名（兼容 var f = function / function f 两种写法） */
function jsTsFuncName(codeSnippet: string): string {
    const funcMatch = codeSnippet.match(/var\s+(\w+)\s*=\s*function\s*\(/) ||
        codeSnippet.match(/function\s+(\w+)\s*\(/);
    return funcMatch ? funcMatch[1] : 'solution';
}

/**
 * 提取入口函数参数（名称 + TS 类型注解），生成期解析后嵌入驱动。
 * 无法解析时返回空数组，运行期按参数名 + 值形状兜底识别。
 */
function jsTsParams(codeSnippet: string): { name: string; ann: string }[] {
    const header = codeSnippet.match(/function\s+\w+\s*\(([^)]*)\)/) ||
        codeSnippet.match(/=\s*(?:async\s+)?function\s*\(([^)]*)\)/) ||
        codeSnippet.match(/=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]*)?=>/) ||
        codeSnippet.match(/=\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>/);
    const raw = header ? (header[1] ?? '') : '';
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of raw) {
        if ('([{<'.includes(ch)) { depth++; }
        else if (')]}>' .includes(ch)) { depth--; }
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) { parts.push(cur); }
    return parts.map((part) => {
        const noDefault = part.split('=')[0];
        const colon = noDefault.indexOf(':');
        const name = (colon === -1 ? noDefault : noDefault.slice(0, colon)).trim();
        const ann = (colon === -1 ? '' : noDefault.slice(colon + 1)).trim();
        return { name, ann };
    }).filter((p) => !!p.name);
}

/** 数据结构定义：无类型（JS）与带类型（TS）两个变体 */
const NODE_DEFS_UNTYPED = `class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }

    static fromArray(arr, pos = -1) {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        const nodes = [head];
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
            nodes.push(curr);
        }
        if (Number.isInteger(pos) && pos >= 0 && pos < nodes.length) {
            curr.next = nodes[pos];
        }
        return head;
    }

    toArray() {
        const result = [];
        const seen = new Set();
        let curr = this;
        while (curr && !seen.has(curr)) {
            seen.add(curr);
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

    toArray() {
        const result = [];
        const queue = [this];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node === null) { result.push(null); continue; }
            result.push(node.val);
            queue.push(node.left);
            queue.push(node.right);
        }
        while (result.length > 0 && result[result.length - 1] === null) {
            result.pop();
        }
        return result;
    }
}`;

const NODE_DEFS_TYPED = `class ListNode {
    val: number;
    next: ListNode | null;
    constructor(val: number = 0, next: ListNode | null = null) {
        this.val = val;
        this.next = next;
    }

    static fromArray(arr: number[], pos: number = -1): ListNode | null {
        if (!arr || arr.length === 0) return null;
        const head = new ListNode(arr[0]);
        const nodes: ListNode[] = [head];
        let curr = head;
        for (let i = 1; i < arr.length; i++) {
            curr.next = new ListNode(arr[i]);
            curr = curr.next;
            nodes.push(curr);
        }
        if (Number.isInteger(pos) && pos >= 0 && pos < nodes.length) {
            curr.next = nodes[pos];
        }
        return head;
    }

    toArray(): number[] {
        const result: number[] = [];
        const seen = new Set<ListNode>();
        let curr: ListNode | null = this;
        while (curr && !seen.has(curr)) {
            seen.add(curr);
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

    toArray(): (number | null)[] {
        const result: (number | null)[] = [];
        const queue: (TreeNode | null)[] = [this];
        while (queue.length > 0) {
            const node = queue.shift();
            if (node === null) { result.push(null); continue; }
            result.push(node.val);
            queue.push(node.left);
            queue.push(node.right);
        }
        while (result.length > 0 && result[result.length - 1] === null) {
            result.pop();
        }
        return result;
    }
}`;

export function jsTsDebugDriver(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    isSpecial: boolean,
    typed: boolean,
    exampleInputs: unknown[][] = []
): string {
    const funcName = jsTsFuncName(codeSnippet);
    const paramMeta = jsTsParams(codeSnippet);
    const retAnnMatch = codeSnippet.match(/\)\s*:\s*([\w<>\[\]| ]+?)\s*\{/);
    const retAnn = typed && retAnnMatch ? retAnnMatch[1].trim() : '';
    const runHint = typed
        ? `npx ts-node ${questionId}_${titleSlug}_debug.ts`
        : `node ${questionId}_${titleSlug}_debug.js`;

    return `// ============================================
// LeetCode ${questionId}. ${titleSlug} - 本地调试文件
// 运行方式: ${runHint}
// ============================================

// ============================================
// 常用数据结构定义
// ============================================

${typed ? NODE_DEFS_TYPED : NODE_DEFS_UNTYPED}

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
const testCases = ${JSON.stringify(testCases)};
// 题面示例入参（按值分组用例；附加/隐藏用例与示例同构）
const exampleInputs = ${JSON.stringify(exampleInputs)};
const params = ${JSON.stringify(paramMeta)};
const retAnn = ${JSON.stringify(retAnn)};

const lines = testCases.trim().split('\\n').filter(line => line.trim());

// 特殊判题题：设计类题用例为操作序列（首行 ["op",...] + 次行等长参数数组），
// 无法按普通函数签名运行；160 等自定义校验题由生成时标记，一并提示手动构造。
// 判定收紧：字符串须为合法标识符且首项含大写（类名形态），避免普通题恰好
// 前两例都是等长字符串数组时误判（如异位词分组）
let opSeq = false;
if (lines.length >= 2) {
    try {
        const first = JSON.parse(lines[0]);
        const second = JSON.parse(lines[1]);
        opSeq = Array.isArray(first) && first.length > 0
            && first.every(x => typeof x === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(x))
            && /^[A-Z]/.test(first[0])
            && Array.isArray(second) && second.length === first.length;
    } catch (e) { opSeq = false; }
}
if (${isSpecial ? 'true' : 'false'} || opSeq) {
    console.log("⚠️ 该题为特殊判题题（设计类操作序列或自定义校验参数），无法按通用签名运行官方示例");
    console.log("   请在文件末尾的自定义调用区手动构造用例（实例化题解类后逐操作调用）");
} else if (lines.length >= 1) {
    try {
        const values = lines.map(line => {
            if (line.indexOf("=") > 0 && !/^[\\[\\{\\"']/.test(line.trim())) {
                line = line.split("=")[1].trim();
            }
            return JSON.parse(line);
        });
        const n = params.length || Math.min(values.length, 1);

        const isNodeObj = (a) => !!a && typeof a === 'object' && typeof a.toArray === 'function';
        // 入参类型判定：TS 按类型注解；JS 无注解时按参数名 + 值形状
        const kindOf = (p, v) => {
            const ann = (p && p.ann) || '';
            if (ann) {
                if (/List\\s*<\\s*ListNode|ListNode\\s*\\[\\]|Array\\s*<\\s*ListNode/.test(ann)) return 'ListNodeList';
                if (/List\\s*<\\s*TreeNode|TreeNode\\s*\\[\\]|Array\\s*<\\s*TreeNode/.test(ann)) return 'TreeNodeList';
                if (/ListNode/.test(ann)) return 'ListNode';
                if (/TreeNode/.test(ann)) return 'TreeNode';
                return '';
            }
            const name = (p && p.name) || '';
            if (/^lists/i.test(name)) {
                return (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) ? 'ListNodeList' : '';
            }
            if (/^(head|l1|l2|list1|list2|list)/i.test(name)) return 'ListNode';
            if (/^(root|tree)/i.test(name)) return 'TreeNode';
            if (/^(p|q|node)$/i.test(name)) return 'nodeRef';
            return '';
        };
        const convertArg = (v, kind) => {
            if (!kind) return v;
            if (kind === 'ListNodeList' || kind === 'TreeNodeList') {
                const cls = kind === 'ListNodeList' ? ListNode : TreeNode;
                return (v || []).map(item => (item == null ? null : cls.fromArray(item)));
            }
            if (v === null || v === undefined) return null;
            if (kind === 'nodeRef') return v;
            const cls = kind === 'TreeNode' ? TreeNode : ListNode;
            return cls.fromArray(Array.isArray(v) ? v : [v]);
        };
        // 节点引用以值给出（236 LCA 的 p/q 是树内节点）：按值在首个节点结构里查找
        const findNode = (struct, val) => {
            const queue = [struct];
            const seen = new Set();
            while (queue.length > 0) {
                const node = queue.shift();
                if (!node || seen.has(node)) continue;
                seen.add(node);
                if (node.val === val) return node;
                if (node.next !== undefined && node.next !== null) queue.push(node.next);
                if (node.left !== undefined && node.left !== null) queue.push(node.left);
                if (node.right !== undefined && node.right !== null) queue.push(node.right);
            }
            return null;
        };

        // 空链表/空树结果判题序列化为 []（返回 None 且入参/返回注解为节点类型时）
        var nodeReturn = /ListNode|TreeNode/.test(retAnn) || params.some(function(p) {
            var k = kindOf(p, [1]);
            return k === 'ListNode' || k === 'TreeNode' || k === 'nodeRef'
                || kindOf(p, [[]]) === 'ListNodeList' || kindOf(p, [[]]) === 'TreeNodeList';
        });

        // 按题面示例的入参个数分组（示例同构，附加/隐藏用例只是增加组数；
        // 带校验参数的题如环形链表 pos 与 head 同组）；无示例锚点时按签名参数个数
        let k = n;
        if (Array.isArray(exampleInputs) && exampleInputs.length > 0
            && exampleInputs.every(ei => Array.isArray(ei) && ei.length === exampleInputs[0].length)) {
            k = Math.max(exampleInputs[0].length, n);
        }
        const groups = [];
        const extras = [];
        if (k > 0 && values.length % k === 0) {
            for (let i = 0; i < values.length; i += k) {
                groups.push(values.slice(i, i + k).slice(0, n));
                extras.push(values.slice(i, i + k).slice(n));
            }
        } else {
            groups.push(values.slice(0, n));
            extras.push(values.slice(n));
        }

        for (let idx = 0; idx < groups.length; idx++) {
            const args = groups[idx];
            const ex = extras[idx];
            const callArgs = args.map((v, i) => convertArg(v, kindOf(params[i] || {}, v)));
            const struct = callArgs.find(isNodeObj);
            if (struct) {
                callArgs.forEach((a, i) => {
                    const kind = kindOf(params[i] || {}, args[i]);
                    if ((kind === 'nodeRef' || kind === 'ListNode' || kind === 'TreeNode')
                        && typeof args[i] === 'number' && !isNodeObj(a)) {
                        const ref = findNode(struct, args[i]);
                        if (ref) { callArgs[i] = ref; }
                    }
                });
            }
            // 环形链表题（141/142）：单链表参数且每例多带一个 pos 整数 → 按 pos 尾接成环
            if (n === 1 && args.length === 1 && ex.length === 1
                && typeof ex[0] === 'number' && Array.isArray(args[0]) && isNodeObj(callArgs[0])) {
                callArgs[0] = ListNode.fromArray(args[0], ex[0]);
            }
            console.log("示例" + (idx + 1) + " 输入:", args);
            const result = ${funcName}(...callArgs);
            let out = result;
            if (isNodeObj(result)) {
                out = result.toArray();
            } else if ((result === null || result === undefined) && nodeReturn) {
                out = [];
            }
            console.log("示例" + (idx + 1) + " 输出:", out);
        }
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
