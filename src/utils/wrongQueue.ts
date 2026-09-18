/**
 * 错题回顾队列纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 记录失败的提交（按时间倒序、同题去重、限量截断、失败次数累计），提交通过后移除；
 * 支持间隔复习排期（失败后依次 1/3/7/14/30 天到期待复习，封顶 30 天）
 */

export interface WrongEntry {
    titleSlug: string;
    title: string;
    failedAt: number;
    reason: string;
    /** 累计提交失败次数（旧格式数据缺失时按 1 计，首次失败为 1） */
    failCount?: number;
}

export const WRONG_QUEUE_MAX = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 间隔复习天数：第 n 次失败后 1/3/7/14/30 天到期待复习，封顶 30 天 */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30];

/** 失败次数（旧格式条目缺 failCount 时按 1 计） */
export function failureCountOf(entry: WrongEntry): number {
    return entry.failCount && entry.failCount > 0 ? entry.failCount : 1;
}

/** 下次复习到期时间（失败时间 + 对应间隔天数；失败次数越多间隔越长） */
export function nextReviewAt(entry: WrongEntry): number {
    const idx = Math.min(failureCountOf(entry) - 1, REVIEW_INTERVALS_DAYS.length - 1);
    return entry.failedAt + REVIEW_INTERVALS_DAYS[idx] * DAY_MS;
}

/** 是否到期待复习（now 已过下次到期时间） */
export function isReviewDue(entry: WrongEntry, now: number = Date.now()): boolean {
    return now >= nextReviewAt(entry);
}

/**
 * 追加/更新失败记录（同 slug 再次失败：刷新时间与原因、失败次数累加并排序，最新失败在前），
 * 超出上限截断
 */
export function addWrongEntry(list: WrongEntry[], entry: WrongEntry, max: number = WRONG_QUEUE_MAX): WrongEntry[] {
    const prev = list.find(e => e.titleSlug === entry.titleSlug);
    const merged: WrongEntry = {
        ...entry,
        failCount: (prev ? failureCountOf(prev) : 0) + 1
    };
    const rest = list.filter(e => e.titleSlug !== entry.titleSlug);
    return [merged, ...rest].sort((a, b) => b.failedAt - a.failedAt).slice(0, max);
}

/** 按 slug 移除（提交通过 / 清空单条） */
export function removeWrongEntry(list: WrongEntry[], titleSlug: string): WrongEntry[] {
    return list.filter(e => e.titleSlug !== titleSlug);
}

/**
 * 展示排序：按下次复习到期时间升序（到期的自然排最前），同到期时最近失败靠前。
 * 供错题分组展开时使用，原队列存储顺序仍按失败时间倒序（去重/截断语义不变）
 */
export function sortWrongByReview(list: WrongEntry[]): WrongEntry[] {
    return [...list].sort((a, b) => {
        const da = nextReviewAt(a);
        const db = nextReviewAt(b);
        if (da !== db) {
            return da - db;
        }
        return b.failedAt - a.failedAt;
    });
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