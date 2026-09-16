/**
 * 错题回顾队列纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 记录失败的提交（按时间倒序、同题去重、限量截断），提交通过后移除
 */

export interface WrongEntry {
    titleSlug: string;
    title: string;
    failedAt: number;
    reason: string;
}

export const WRONG_QUEUE_MAX = 100;

/** 追加/更新失败记录（同 slug 刷新时间与原因）并排序（最新失败在前），超出上限截断 */
export function addWrongEntry(list: WrongEntry[], entry: WrongEntry, max: number = WRONG_QUEUE_MAX): WrongEntry[] {
    const rest = list.filter(e => e.titleSlug !== entry.titleSlug);
    return [entry, ...rest].sort((a, b) => b.failedAt - a.failedAt).slice(0, max);
}

/** 按 slug 移除（提交通过 / 清空单条） */
export function removeWrongEntry(list: WrongEntry[], titleSlug: string): WrongEntry[] {
    return list.filter(e => e.titleSlug !== titleSlug);
}

/** 短时间格式：MM-DD HH:mm（无效时间返回空串） */
export function formatFailedAt(ts: number): string {
    const d = new Date(ts);
    if (isNaN(d.getTime())) {
        return '';
    }
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
}