/**
 * wrongQueue 错题队列纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import {
    addWrongEntry, removeWrongEntry, formatFailedAt, WrongEntry,
    failureCountOf, nextReviewAt, isReviewDue, sortWrongByReview, REVIEW_INTERVALS_DAYS,
    pickReviewCandidate
} from '../utils/wrongQueue';

const entry = (slug: string, failedAt: number, reason = 'Wrong Answer'): WrongEntry => ({ titleSlug: slug, title: slug, failedAt, reason });

test('addWrongEntry：按时间倒序且同 slug 去重', () => {
    let list: WrongEntry[] = [];
    list = addWrongEntry(list, entry('a', 100));
    list = addWrongEntry(list, entry('b', 200));
    list = addWrongEntry(list, entry('c', 150));
    assert.deepStrictEqual(list.map(e => e.titleSlug), ['b', 'c', 'a']);
    // 同 slug 再次失败：刷新时间与原因，不产生重复条目
    list = addWrongEntry(list, entry('a', 300, 'Time Limit Exceeded'));
    assert.deepStrictEqual(list.map(e => e.titleSlug), ['a', 'b', 'c']);
    assert.strictEqual(list[0].reason, 'Time Limit Exceeded');
    assert.strictEqual(list.length, 3);
});

test('addWrongEntry：超出上限截断（保留最新）', () => {
    let list: WrongEntry[] = [];
    for (let i = 0; i < 105; i++) {
        list = addWrongEntry(list, entry('p' + i, i));
    }
    assert.strictEqual(list.length, 100);
    assert.strictEqual(list[0].titleSlug, 'p104');
    assert.strictEqual(list[99].titleSlug, 'p5');
});

test('removeWrongEntry：按 slug 移除', () => {
    const list = [entry('a', 3), entry('b', 2), entry('c', 1)];
    const rest = removeWrongEntry(list, 'b');
    assert.deepStrictEqual(rest.map(e => e.titleSlug), ['a', 'c']);
    assert.strictEqual(removeWrongEntry(rest, 'x').length, 2);
});

test('formatFailedAt：格式化与无效时间', () => {
    assert.match(formatFailedAt(Date.UTC(2026, 8, 16, 3, 5)), /^\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.strictEqual(formatFailedAt(NaN), '');
});

test('failureCountOf：旧格式条目（无 failCount）按 1 计', () => {
    assert.strictEqual(failureCountOf(entry('a', 1)), 1);
    assert.strictEqual(failureCountOf({ titleSlug: 'a', title: 'a', failedAt: 1, reason: 'r', failCount: 5 }), 5);
    assert.strictEqual(failureCountOf({ titleSlug: 'a', title: 'a', failedAt: 1, reason: 'r', failCount: 0 }), 1);
});

test('addWrongEntry：同 slug 再次失败累计次数、刷新时间原因', () => {
    let list: WrongEntry[] = [];
    list = addWrongEntry(list, entry('a', 100));
    assert.strictEqual(list[0].failCount, 1);
    list = addWrongEntry(list, entry('a', 300, 'Time Limit Exceeded'));
    assert.strictEqual(list[0].failCount, 2);
    assert.strictEqual(list[0].reason, 'Time Limit Exceeded');
    assert.strictEqual(list[0].failedAt, 300);
    assert.strictEqual(list.length, 1);
    list = addWrongEntry(list, entry('a', 400));
    assert.strictEqual(list[0].failCount, 3);
});

test('nextReviewAt/isReviewDue：间隔递增（1/3/7/14/30 天，封顶 30 天）', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const e1 = { titleSlug: 'a', title: 'a', failedAt: 1000, reason: 'r', failCount: 1 };
    assert.strictEqual(nextReviewAt(e1), 1000 + REVIEW_INTERVALS_DAYS[0] * DAY);
    const e3 = { ...e1, failCount: 3 };
    assert.strictEqual(nextReviewAt(e3), 1000 + REVIEW_INTERVALS_DAYS[2] * DAY);
    const e99 = { ...e1, failCount: 99 };
    assert.strictEqual(nextReviewAt(e99), 1000 + REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1] * DAY);
    // 到期判断：早于/晚于到期时间
    assert.strictEqual(isReviewDue(e1, 1000 + DAY - 1), false);
    assert.strictEqual(isReviewDue(e1, 1000 + DAY), true);
});

test('sortWrongByReview：到期时间升序（已到期的排最前）', () => {
    const DAY = 24 * 60 * 60 * 1000;
    // A：失败时间 1000（1 天后到期），B：失败时间 2000（1 天后到期，比 A 晚），
    // C：失败时间很久以前（已到期）
    const a: WrongEntry = { titleSlug: 'a', title: 'a', failedAt: 1000, reason: 'r', failCount: 1 };
    const b: WrongEntry = { titleSlug: 'b', title: 'b', failedAt: 2000, reason: 'r', failCount: 1 };
    const c: WrongEntry = { titleSlug: 'c', title: 'c', failedAt: 1000 - 10 * DAY, reason: 'r', failCount: 1 };
    assert.deepStrictEqual(sortWrongByReview([a, b, c]).map(e => e.titleSlug), ['c', 'a', 'b']);
});

test('pickReviewCandidate：到期优先、跳过已复习、全部复习完返回空', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 10000000;
    // a：已到期；b：未到期（1000ms 前失败 + 1 天间隔 → 未到期…… 用 far past 使其到期）
    const a: WrongEntry = { titleSlug: 'a', title: 'a', failedAt: now - 2 * DAY, reason: 'r', failCount: 1 };
    const b: WrongEntry = { titleSlug: 'b', title: 'b', failedAt: now - 2 * DAY, reason: 'r', failCount: 1 };
    const c: WrongEntry = { titleSlug: 'c', title: 'c', failedAt: now - 1000, reason: 'r', failCount: 1 };
    // 未复习：取到期最早的（a/b 同 failedAt，稳定序取 a）
    const r1 = pickReviewCandidate([c, a, b], [], now);
    assert.strictEqual(r1.entry?.titleSlug, 'a');
    assert.strictEqual(r1.total, 3);
    assert.strictEqual(r1.dueRemaining, 2);
    // 今日已复习 a：跳到下一个到期（b）
    const r2 = pickReviewCandidate([c, a, b], ['a'], now);
    assert.strictEqual(r2.entry?.titleSlug, 'b');
    assert.strictEqual(r2.reviewedCount, 1);
    // 全部复习完：entry 为空
    const r3 = pickReviewCandidate([c, a, b], ['a', 'b', 'c'], now);
    assert.strictEqual(r3.entry, undefined);
    assert.strictEqual(r3.reviewedCount, 3);
    // 空队列
    const r4 = pickReviewCandidate([], [], now);
    assert.strictEqual(r4.entry, undefined);
    assert.strictEqual(r4.total, 0);
});