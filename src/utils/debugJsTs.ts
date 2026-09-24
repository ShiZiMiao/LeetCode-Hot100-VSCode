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

/** 数据结构定义：无类型（JS）与带类型（TS）两个变体 */
const NODE_DEFS_UNTYPED = `class ListNode {
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
}`;

const NODE_DEFS_TYPED = `class ListNode {
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
}`;

export function jsTsDebugDriver(
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    isSpecial: boolean,
    typed: boolean
): string {
    const funcName = jsTsFuncName(codeSnippet);
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
