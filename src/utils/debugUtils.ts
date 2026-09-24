/**
 * 本地调试文件生成（纯逻辑，无 vscode 依赖）。
 * 为不同语言生成本地调试代码：
 * - Python：自动运行驱动（debugPython.ts，importlib 加载题解、按注解转换入参、
 *   用例↔示例期望按值配对、原地入参比对、pydevd 自排除注册）
 * - JavaScript/TypeScript：共享骨架模板（debugJsTs.ts，typed 开关区分类型标注）
 * - Java/C++/Go/Rust：自包含手动模板（debugManual.ts，main 中 TODO 手动构造用例）
 * 特殊判题题按代码结构自适应识别（detectSpecialProblem），不再依赖逐题 slug 名单。
 */
import { pythonDebugDriver } from './debugPython';
import { jsTsDebugDriver } from './debugJsTs';
import { cppDebugDriver, goDebugDriver, javaDebugDriver, javaClassNameOf, rustDebugDriver } from './debugManual';

/**
 * 特殊判题题自适应识别（替代逐题 slug 名单，避免新题/非 Hot 100 题漏判）：
 * - 设计类：无 class/struct/impl Solution 入口（MyHashMap/Trie/MedianFinder…），按操作序列调用，
 *   无法通用运行官方示例。仅对常规题以 Solution 类组织的语言可结构识别（Python/Java/C++/Rust）；
 *   JS/TS/Go/C 为函数式/结构式入口，设计类判题由驱动运行期按用例形状（首行 ["op",…]）识别。
 * - 自定义校验题：138（Node 带 random 指针，本地 ListNode 无法等价还原）、
 *   160（用例含校验参数 intersectVal/skipA/skipB，与签名错位，结构无法分辨，保留 slug 兜底）。
 */
export function detectSpecialProblem(lang: string, codeSnippet: string, titleSlug: string): boolean {
    if (lang === 'python3' || lang === 'python' || lang === 'java' || lang === 'cpp' || lang === 'c++' || lang === 'rust') {
        if (!/(?:class|struct)\s+Solution\b|\bimpl\s+Solution\b/.test(codeSnippet)) {
            return true;
        }
    }
    if (/class\s+Node\b[\s\S]*?\brandom\b/.test(codeSnippet)) {
        return true;
    }
    return titleSlug === 'intersection-of-two-linked-lists';
}

/**
 * 生成调试文件的内容。
 * expectedOutputs/exampleInputs/sourceFilePath 仅 Python 驱动消费（其余语言为手动模板），
 * 驱动需要题面示例期望与输入做按值配对；示例输入提取不全时传 [] 退回位置配对。
 */
export function generateDebugFile(
    lang: string,
    questionId: string,
    titleSlug: string,
    testCases: string,
    codeSnippet: string,
    sourceFilePath: string,
    expectedOutputs: string[] = [],
    exampleInputs: unknown[][] = []
): { fileName: string; content: string } | null {
    const isSpecial = detectSpecialProblem(lang, codeSnippet, titleSlug);
    switch (lang) {
        case 'python3':
        case 'python':
            return {
                fileName: `${questionId}_${titleSlug}_debug.py`,
                content: pythonDebugDriver(questionId, titleSlug, testCases, codeSnippet, sourceFilePath, expectedOutputs, exampleInputs, isSpecial)
            };

        case 'java': {
            // Java 文件名必须与 public 类名一致（编译要求），类名推导收口在 javaClassNameOf
            const className = javaClassNameOf(titleSlug);
            return {
                fileName: `${className}.java`,
                content: javaDebugDriver(questionId, titleSlug, testCases, codeSnippet, isSpecial)
            };
        }

        case 'cpp':
        case 'c++':
            return {
                fileName: `${questionId}_${titleSlug}_debug.cpp`,
                content: cppDebugDriver(questionId, titleSlug, testCases, codeSnippet, isSpecial)
            };

        case 'javascript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.js`,
                content: jsTsDebugDriver(questionId, titleSlug, testCases, codeSnippet, isSpecial, false)
            };

        case 'typescript':
            return {
                fileName: `${questionId}_${titleSlug}_debug.ts`,
                content: jsTsDebugDriver(questionId, titleSlug, testCases, codeSnippet, isSpecial, true)
            };

        case 'golang':
        case 'go':
            return {
                fileName: `${questionId}_${titleSlug}_debug.go`,
                content: goDebugDriver(questionId, titleSlug, testCases, codeSnippet)
            };

        case 'rust':
            return {
                fileName: `${questionId}_${titleSlug}_debug.rs`,
                content: rustDebugDriver(questionId, titleSlug, testCases, codeSnippet)
            };

        default:
            return null;
    }
}
