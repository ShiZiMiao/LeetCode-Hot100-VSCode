/**
 * 题目元数据展示格式化纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 *
 * 注：频次（freqBar）经实测列表接口恒返回 0、详情接口返回 null（GraphQL 无此数据），
 * 已从展示剔除，此处不再提供格式化函数；数据事实见记忆库与 AGENTS.md。
 */

/**
 * 通过率显示：leetcode.cn 列表/详情接口的 acRate 是 **0~1 的小数**（如 0.552 → 55.2%），
 * 防御性兼容部分数据源直接给百分数（0~100）；保留一位小数省略尾零；非法值返回 undefined
 */
export function formatAcRate(value: number | undefined | null): string | undefined {
    if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 100) {
        return undefined;
    }
    const percent = value <= 1 ? value * 100 : value;
    const rounded = Math.round(percent * 10) / 10;
    return String(rounded) + '%';
}