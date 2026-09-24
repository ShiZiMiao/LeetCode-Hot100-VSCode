/**
 * 题面/文件名解析的纯逻辑（无 vscode 依赖，可直接单测）。
 * 从 extension.ts 抽出：示例输入/期望输出提取、题解文件名身份解析。
 */

const entityMap: Record<string, string> = {
    '&quot;': '"',
    '&#34;': '"',
    '&gt;': '>',
    '&lt;': '<',
    '&amp;': '&',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&thinsp;': ' ',
    '&#160;': ' '
};

/**
 * 题面示例有两种排版：<pre> 块或 <div class="example-block"> + 段落；
 * 剥离标签后按「示例 N / Example N」切段，段内取第一个「输入」原文段与第一个「输出」值。
 * 值以 解释/输入/输出/提示/Constraints 等为边界（有些示例没有解释，末尾会跟提示/进阶）。
 * 只保留能取到输出的段（与历史 extractExpectedOutputs 的口径一致）。
 */
export function extractExamples(html: string): { input: string; output: string }[] {
    if (!html) {
        return [];
    }
    const text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&quot;|&#34;|&gt;|&lt;|&amp;|&#39;|&nbsp;|&thinsp;|&#160;/g, (m) => entityMap[m] ?? m);
    const exampleRe = /(?:示例|Example)\s*\d/gi;
    const segments: string[] = [];
    let cursor = 0;
    let exampleMatch: RegExpExecArray | null;
    while ((exampleMatch = exampleRe.exec(text)) !== null) {
        segments.push(text.slice(cursor, exampleMatch.index));
        cursor = exampleRe.lastIndex;
    }
    segments.push(text.slice(cursor));
    const outputRe = /(?:输出|Output)\s*[：:]\s*([\s\S]*?)(?=\s*(?:解释|Explanation|输入|Input|示例|Example|提示|Constraints|进阶|Follow-up|说明)\s*[：:]?|$)/i;
    const inputRe = /(?:输入|Input)\s*[：:]\s*([\s\S]*?)(?=\s*(?:输出|Output|解释|Explanation|示例|Example|提示|Constraints|进阶|Follow-up|说明)\s*[：:]?|$)/i;
    const entries: { input: string; output: string }[] = [];
    for (const segment of segments) {
        const out = outputRe.exec(segment);
        if (out && out[1].trim()) {
            const inp = inputRe.exec(segment);
            entries.push({ input: inp ? inp[1].trim() : '', output: out[1].trim() });
        }
    }
    return entries;
}

/**
 * 从题目 HTML（translatedContent/content）中按顺序提取各示例的期望输出。
 * 示例格式：<pre>… 输入：… \n 输出：value \n 解释：… </pre>
 */
export function extractExpectedOutputs(html: string): string[] {
    return extractExamples(html).map((e) => e.output);
}

/**
 * 从「名字 = 值, 名字 = 值 / 裸值」的示例输入原文解析出各参数的 JSON 值（原文形式）。
 * 任何一个值解析失败整体返回 null（调用方退回位置配对，避免错位误判）。
 */
function parseInputValues(inputText: string): string[] | null {
    const out: string[] = [];
    let i = 0;
    const s = inputText;
    while (i < s.length) {
        while (i < s.length && /[\s,，;；]/.test(s[i])) {
            i++;
        }
        if (i >= s.length) {
            break;
        }
        const nameM = /^[A-Za-z_][A-Za-z0-9_]*\s*=\s*/.exec(s.slice(i));
        if (nameM) {
            i += nameM[0].length;
        }
        const start = i;
        const c = s[i];
        if (c === '[' || c === '{') {
            let depth = 0;
            let inStr = false;
            let esc = false;
            for (; i < s.length; i++) {
                const ch = s[i];
                if (inStr) {
                    if (esc) {
                        esc = false;
                    } else if (ch === '\\') {
                        esc = true;
                    } else if (ch === '"') {
                        inStr = false;
                    }
                    continue;
                }
                if (ch === '"') {
                    inStr = true;
                } else if (ch === '[' || ch === '{') {
                    depth++;
                } else if (ch === ']' || ch === '}') {
                    depth--;
                    if (depth === 0) {
                        i++;
                        break;
                    }
                }
            }
        } else if (c === '"') {
            i++;
            while (i < s.length) {
                if (s[i] === '\\') {
                    i += 2;
                } else if (s[i] === '"') {
                    i++;
                    break;
                } else {
                    i++;
                }
            }
        } else {
            while (i < s.length && !/[\s,，;；]/.test(s[i])) {
                i++;
            }
        }
        const raw = s.slice(start, i).trim();
        if (!raw) {
            return null;
        }
        // 中文题面示例输入常用 Python 风格单引号（如 [['A','B']]），归一为双引号再解析
        const normalized = raw.replace(/'([^']*)'/g, '"$1"');
        try {
            JSON.parse(normalized);
        } catch {
            return null;
        }
        out.push(normalized);
    }
    return out.length ? out : null;
}

/**
 * 按顺序提取各示例的输入值列表（每示例一个数组，元素为解析后的 JSON 值）。
 * 官方 exampleTestcases 可能含展示示例之外的附加用例（位置不定），驱动按值把
 * 用例与示例期望配对时用它做锚点。任一示例输入解析失败时整体返回 []（退回位置配对）。
 */
export function extractExampleInputs(html: string): unknown[][] {
    const entries = extractExamples(html);
    if (!entries.length) {
        return [];
    }
    const result: unknown[][] = [];
    for (const e of entries) {
        const raws = e.input ? parseInputValues(e.input) : null;
        if (!raws) {
            return [];
        }
        try {
            result.push(raws.map((r) => JSON.parse(r)));
        } catch {
            return [];
        }
    }
    return result;
}

/**
 * 从题解/调试文件名解析题目身份：扩展生成的文件名为 {题号}_{slug}.{ext}，
 * 调试驱动为 {题号}_{slug}_debug.{ext}。解析失败返回 null。
 */
export function parseProblemFileName(fileName: string): { questionId: string; titleSlug: string; isDebug: boolean } | null {
    const m = fileName.match(/^(\d+)_([a-z0-9-]+?)(?:_debug)?\./i);
    if (!m) {
        return null;
    }
    return { questionId: m[1], titleSlug: m[2], isDebug: /_debug\.[a-z0-9]+$/i.test(fileName) };
}
