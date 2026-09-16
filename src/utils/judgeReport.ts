/**
 * 判题结果报告的纯逻辑（无 vscode 依赖，可直接单测）。
 * 从 extension.ts 抽出：状态中文映射、判题值格式化、逐用例分组、报告组装。
 */

export const STATUS_ZH: Record<string, string> = {
    'Accepted': '通过',
    'Wrong Answer': '解答错误',
    'Time Limit Exceeded': '超出时间限制',
    'Memory Limit Exceeded': '超出内存限制',
    'Output Limit Exceeded': '输出超出限制',
    'Runtime Error': '运行时错误',
    'Compile Error': '编译错误'
};

export function formatJudgeValue(value: any): string {
    if (value === undefined || value === null) { return ''; }
    // runCode 的 code_answer/expected_code_answer 每项自带结尾换行、数组还常以空串收尾，
    // 逐项去尾后拼接仍可能带结尾 \n（join 在空串前插入的分隔符），必须整串再去一次尾，
    // 否则 Output 段间出现双空行
    const trimEnd = (s: string) => s.replace(/\s+$/, '');
    if (Array.isArray(value)) {
        return trimEnd(value.map(item => trimEnd(typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item))).join('\n'));
    }
    if (typeof value === 'object') { return JSON.stringify(value); }
    return trimEnd(String(value));
}

/**
 * 判题数组（code_answer/expected_code_answer）与 total_testcases 对齐：
 * 判题数组常在末尾多一个空串，长度为 用例数+1 时去掉再对齐。
 */
function alignCaseArrays(outputs: any[], expects: any[], n: number): { outArr: any[]; expArr: any[] } | undefined {
    const align = (arr: any[]) => arr.length === n
        ? arr
        : (arr.length === n + 1 && String(arr[arr.length - 1]).trim() === '' ? arr.slice(0, n) : undefined);
    const outArr = align(outputs);
    const expArr = align(expects);
    return outArr && expArr ? { outArr, expArr } : undefined;
}

/**
 * 逐用例输入按行数均分（多参数题每个参数占一行，每用例 = 参数个数行）；
 * 不能整除时返回 undefined（无法还原逐用例输入）。
 */
function splitCaseInputs(inputText: string, n: number): string[][] | undefined {
    if (!inputText) {
        return undefined;
    }
    const lines = inputText.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') { lines.pop(); }
    if (lines.length === 0 || lines.length % n !== 0) {
        return undefined;
    }
    const per = lines.length / n;
    const inputLines: string[][] = [];
    for (let i = 0; i < n; i++) { inputLines.push(lines.slice(i * per, (i + 1) * per)); }
    return inputLines;
}

/**
 * 尝试按用例分组输出判题结果。runCode 判题的 code_answer / expected_code_answer
 * 是与用例一一对齐的数组，compare_result 为逐用例 0/1 串，total_testcases 为用例数；
 * 输入原始串的行数若能被用例数整除即按此分组（多参数题每个参数占一行，每用例 = 参数个数行）。
 * 任一前提不满足（如提交判题只有拼接后的 total_output 字符串）返回 undefined，调用方回退汇总格式。
 */
export function buildCaseSections(check: any, inputText: string): string[] | undefined {
    const outputs = check.code_answer ?? check.coded_answer;
    const expects = Array.isArray(check.expected_code_answer) ? check.expected_code_answer : check.expected_output;
    const n = Number(check.total_testcases) || 0;
    if (!Array.isArray(outputs) || !Array.isArray(expects) || outputs.length === 0 || n <= 0) {
        return undefined;
    }
    const aligned = alignCaseArrays(outputs, expects, n);
    if (!aligned) {
        return undefined;
    }
    const { outArr, expArr } = aligned;
    const inputLines = splitCaseInputs(inputText, n);
    // compare_result 仅由 0/1 组成时才可信；混有其他字符（如未跑用例的 null 串）不显示逐用例状态
    const compare = typeof check.compare_result === 'string' && /^[01]*$/.test(check.compare_result) ? check.compare_result : '';
    const sections: string[] = [];
    for (let i = 0; i < n; i++) {
        const verdict = i < compare.length ? (compare[i] === '1' ? '✅ 通过' : '❌ 未通过') : '';
        const parts = [`\n📋【用例 ${i + 1}】${verdict}`];
        if (inputLines) { parts.push(`输入：\n${inputLines[i].join('\n')}`); }
        const out = formatJudgeValue(outArr[i]);
        if (out) { parts.push(`输出：\n${out}`); }
        const exp = formatJudgeValue(expArr[i]);
        if (exp) { parts.push(`预期结果：\n${exp}`); }
        sections.push(parts.join('\n'));
    }
    return sections;
}

/**
 * 单个用例的判题信息（"用失败用例本地调试"/自定义用例入口用）。
 * input 为该用例的原始输入行（\n 连接）；无法按用例拆分时为空串（判为不可调试）。
 */
export interface JudgeCaseInfo {
    /** 1-based 用例序号 */
    index: number;
    /** 该用例原始输入行（\n 连接）；无法还原时为空串 */
    input: string;
    /** formatJudgeValue 格式化后的实际输出 */
    output: string;
    /** formatJudgeValue 格式化后的预期结果 */
    expected: string;
    /** 是否通过（compare_result 可信时按位判定） */
    passed: boolean;
    /** 通过/失败判定是否可信（compare_result 非纯 0/1 串时为 false，避免误把通过用例当失败） */
    known: boolean;
}

/**
 * 从判题响应提取逐用例结构化信息：
 * - runCode 测试：按 code_answer/expected_code_answer 数组 + compare_result + 行数均分还原；
 * - 提交等无逐用例数组的场景：Accepted 无失败用例返回 []；未通过时回退单条（input/output/expected）。
 */
export function collectJudgeCaseInfos(check: any, inputFallback?: string): JudgeCaseInfo[] {
    const inputText = formatJudgeValue(pickFirst(check.input, check.last_testcase, check.test_case)) || formatJudgeValue(inputFallback);
    const outputs = check.code_answer ?? check.coded_answer;
    const expects = Array.isArray(check.expected_code_answer) ? check.expected_code_answer : check.expected_output;
    const n = Number(check.total_testcases) || 0;
    if (Array.isArray(outputs) && Array.isArray(expects) && outputs.length > 0 && n > 0) {
        const aligned = alignCaseArrays(outputs, expects, n);
        if (!aligned) {
            return [];
        }
        const { outArr, expArr } = aligned;
        const inputLines = splitCaseInputs(inputText, n);
        // compare_result 仅由 0/1 组成时才可信
        const compareValid = typeof check.compare_result === 'string' && /^[01]*$/.test(check.compare_result);
        const compare = compareValid ? check.compare_result : '';
        const infos: JudgeCaseInfo[] = [];
        for (let i = 0; i < n; i++) {
            infos.push({
                index: i + 1,
                input: inputLines ? inputLines[i].join('\n') : '',
                output: formatJudgeValue(outArr[i]),
                expected: formatJudgeValue(expArr[i]),
                passed: compare[i] === '1',
                known: compareValid
            });
        }
        return infos;
    }
    // 无逐用例数组（提交判题等）：Accepted 无失败用例；未通过时把响应字段回退成单条用例
    if (String(check.status_msg) === 'Accepted') {
        return [];
    }
    const output = formatJudgeValue(pickFirst(check.code_answer, check.coded_answer, check.code_output, check.total_output));
    const expected = formatJudgeValue(pickFirst(check.expected_output, check.expected_code_answer));
    if (!inputText && !output && !expected) {
        return [];
    }
    return [{ index: 1, input: inputText, output, expected, passed: false, known: true }];
}

/** 依序取第一个非空值（?? 不跳过空串——提交判题 code_output 常为 ""，真输出在 total_output） */
function pickFirst(...vals: any[]): any {
    return vals.find(v => v !== undefined && v !== null && v !== '');
}

export function buildJudgeReport(check: any, inputFallback?: string, ok?: boolean): { summary: string; detail: string } {
    const status = String(check.status_msg || '');
    const statusLabel = STATUS_ZH[status] ? `${STATUS_ZH[status]} (${status})` : (status || '未知状态');
    const passed = (check.total_correct !== undefined && check.total_testcases !== undefined)
        ? `，${check.total_correct}/${check.total_testcases} 个用例通过`
        : '';
    const summary = statusLabel + passed;

    const lines: string[] = [`${ok ? '✅' : '❌'}【判题结果】${summary}`];
    if (check.status_runtime && check.status_runtime !== 'N/A') { lines.push(`🕐 运行时间: ${check.status_runtime}`); }
    if (check.status_memory && check.status_memory !== 'N/A') { lines.push(`💾 内存消耗: ${check.status_memory}`); }
    else if (typeof check.memory === 'number' && check.memory > 0) {
        // 判题响应里 memory 为字节数，按 KB/MB 自适应展示
        lines.push(`💾 内存消耗: ${check.memory >= 1024 * 1024 ? (check.memory / 1024 / 1024).toFixed(1) + ' MB' : (check.memory / 1024).toFixed(1) + ' KB'}`);
    }
    // compare_result 为逐用例 0/1 串，第一个 0 即最先未通过的用例
    if (typeof check.compare_result === 'string' && check.compare_result.length > 0) {
        const firstFail = check.compare_result.indexOf('0');
        if (firstFail >= 0) { lines.push(`🔍 首个未通过用例: 第 ${firstFail + 1} 个`); }
    }
    const compileError = String(check.full_compile_error || check.compile_error || '').trim();
    const runtimeError = String(check.full_runtime_error || check.error || '').trim();
    // Output 面板是纯文本、不支持折叠，因此原始响应不写进通道；
    // 缓存在 lastRawJudgeResponse，经 toast 按钮或命令在 JSON 编辑器中按需打开（自带折叠）
    const inputText = formatJudgeValue(pickFirst(check.input, check.last_testcase, check.test_case)) || formatJudgeValue(inputFallback);
    // 优先逐用例展示（输入/输出/预期成组）；拿不到对齐数组的场景（如提交）回退汇总三段
    const caseSections = buildCaseSections(check, inputText);
    if (caseSections) {
        lines.push(...caseSections);
    } else {
        if (inputText) { lines.push(`\n📥【输入】\n${inputText}`); }
        // 提交判题的输出字段是 code_output（runCode 用 code_answer/coded_answer；空串继续回退 total_output）
        const output = formatJudgeValue(pickFirst(check.code_answer, check.coded_answer, check.code_output, check.total_output));
        if (output) { lines.push(`\n📤【输出】\n${output}`); }
        const expected = formatJudgeValue(pickFirst(check.expected_output, check.expected_code_answer));
        if (expected) { lines.push(`\n🎯【预期结果】\n${expected}`); }
    }
    if (compileError) { lines.push(`\n⚠️【编译错误】\n${compileError}`); }
    if (runtimeError) { lines.push(`\n💥【运行时错误】\n${runtimeError}`); }
    lines.push(`\n💡（原始判题响应：运行命令 "LeetCode: 查看最近一次原始判题响应"，在 JSON 编辑器内可折叠查看）`);
    return { summary, detail: lines.join('\n') };
}
