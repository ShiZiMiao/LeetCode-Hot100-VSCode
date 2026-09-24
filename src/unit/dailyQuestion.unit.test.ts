/**
 * dailyQuestion 每日一题纯逻辑单测
 * 黄金值断言钉死「同日固定」承诺：dateSeed 算法或 HOT_100_LIST 顺序变化会让本文件报警。
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { dateSeed, pickDailyQuestion } from '../utils/dailyQuestion';
import { HOT_100_LIST } from '../data/hot100Data';

test('dateSeed：稳定种子（黄金值）且相邻日期不同', () => {
    assert.strictEqual(dateSeed('2026-09-21'), 2480044605);
    assert.strictEqual(dateSeed('2026-09-22'), 2429711748);
    assert.notStrictEqual(dateSeed('2026-09-21'), dateSeed('2026-09-22'));
    const seeds = new Set(['2026-09-21', '2026-10-01', '2027-01-01'].map(dateSeed));
    assert.ok(seeds.size > 1, '不同日期应产生不同种子');
});

test('pickDailyQuestion：同日固定、跨天轮换（黄金值）', () => {
    // 同日固定
    assert.strictEqual(pickDailyQuestion('2026-09-21').titleSlug, '3sum');
    assert.strictEqual(pickDailyQuestion('2026-09-21').frontendQuestionId, '15');
    // 跨天轮换（相邻日期抽到不同题）
    assert.strictEqual(pickDailyQuestion('2026-09-22').titleSlug, 'lowest-common-ancestor-of-a-binary-tree');
    assert.strictEqual(pickDailyQuestion('2026-01-01').titleSlug, 'perfect-squares');
});

test('pickDailyQuestion：返回 Hot 100 列表成员且整月不越界', () => {
    for (let d = 1; d <= 30; d++) {
        const date = `2026-09-${String(d).padStart(2, '0')}`;
        const q = pickDailyQuestion(date);
        assert.ok(HOT_100_LIST.some(x => x.titleSlug === q.titleSlug), `${date} 抽到的题目应在 Hot 100 内`);
    }
});
