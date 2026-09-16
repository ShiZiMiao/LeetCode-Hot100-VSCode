/**
 * progressStats 纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { computeProgressStats, progressPercent, matchesStatusFilter, StatusFilter } from '../utils/progressStats';

test('computeProgressStats：全空与混合状态', () => {
    assert.deepStrictEqual(computeProgressStats([]), { total: 0, solved: 0, attempted: 0, notStarted: 0 });
    const stats = computeProgressStats(['ac', 'notac', null, 'ac', undefined]);
    assert.deepStrictEqual(stats, { total: 5, solved: 2, attempted: 1, notStarted: 2 });
    assert.strictEqual(progressPercent(stats), 40);
});

test('progressPercent：0 总数不除零', () => {
    assert.strictEqual(progressPercent({ total: 0, solved: 0, attempted: 0, notStarted: 0 }), 0);
    assert.strictEqual(progressPercent({ total: 3, solved: 1, attempted: 1, notStarted: 1 }), 33);
});

test('matchesStatusFilter：all 恒通过', () => {
    for (const s of ['ac', 'notac', null, undefined]) {
        assert.strictEqual(matchesStatusFilter(s, 'all'), true);
    }
});

test('matchesStatusFilter：solved/attempted/not_started 边界', () => {
    assert.strictEqual(matchesStatusFilter('ac', 'solved'), true);
    assert.strictEqual(matchesStatusFilter('notac', 'solved'), false);
    assert.strictEqual(matchesStatusFilter(null, 'solved'), false);

    assert.strictEqual(matchesStatusFilter('notac', 'attempted'), true);
    assert.strictEqual(matchesStatusFilter('ac', 'attempted'), false);

    assert.strictEqual(matchesStatusFilter(null, 'not_started'), true);
    assert.strictEqual(matchesStatusFilter(undefined, 'not_started'), true);
    assert.strictEqual(matchesStatusFilter('ac', 'not_started'), false);
    assert.strictEqual(matchesStatusFilter('notac', 'not_started'), false);
});

test('matchesStatusFilter：未知状态串按未做处理', () => {
    const f: StatusFilter = 'not_started';
    assert.strictEqual(matchesStatusFilter('', f), true);
});