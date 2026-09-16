/**
 * wrongQueue 错题队列纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { addWrongEntry, removeWrongEntry, formatFailedAt, WrongEntry } from '../utils/wrongQueue';

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