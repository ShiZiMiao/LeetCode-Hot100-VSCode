/**
 * 题面/文件名解析的纯逻辑（无 vscode 依赖，可直接单测）。
 * 从 extension.ts 抽出：示例期望输出提取、题解文件名身份解析。
 */

/**
 * 从题目 HTML（translatedContent/content）中按顺序提取各示例的期望输出。
 * 示例格式：<pre>… 输入：… \n 输出：value \n 解释：… </pre>
 */
export function extractExpectedOutputs(html: string): string[] {
    if (!html) {
        return [];
    }
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
    const outputs: string[] = [];
    // 题面示例有两种排版：<pre> 块或 <div class="example-block"> + 段落；
    // 剥离标签后按「示例 N / Example N」切段，段内取第一个「输出」的值，
    // 值以 解释/输入/提示/Constraints 等为边界（有些示例没有解释，末尾会跟提示/进阶）
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
    const valueRe = /(?:输出|Output)\s*[：:]\s*([\s\S]*?)(?=\s*(?:解释|Explanation|输入|Input|示例|Example|提示|Constraints|进阶|Follow-up|说明)\s*[：:]?|$)/i;
    for (const segment of segments) {
        const m = valueRe.exec(segment);
        if (m && m[1].trim()) {
            outputs.push(m[1].trim());
        }
    }
    return outputs;
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
