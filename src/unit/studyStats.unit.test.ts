/**
 * studyStats 刷题统计纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { computeStudyStats, computeStreak, localDateStr } from '../utils/studyStats';
import { Hot100Question, CATEGORIES } from '../data/hot100Data';

function q(id: string, category: string, difficulty: string): Hot100Question {
    return { category, frontendQuestionId: id, difficulty, titleSlug: 'q-' + id, titleCn: '题' + id, titleEn: 'Q' + id };
}

test('localDateStr：YYYY-MM-DD 本地时区格式', () => {
    assert.match(localDateStr(new Date(2026, 8, 18, 12, 0)), /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(localDateStr(new Date(2026, 0, 5, 12, 0)), '2026-01-05');
});

test('computeStreak：空/今日/昨日链/断档/去重', () => {
    assert.strictEqual(computeStreak([], '2026-09-18'), 0);
    // 今天 + 昨天 + 前天 = 3 天
    assert.strictEqual(computeStreak(['2026-09-18', '2026-09-17', '2026-09-16'], '2026-09-18'), 3);
    // 今天没通过，昨天到今天往前连续：仍算 2 天
    assert.strictEqual(computeStreak(['2026-09-17', '2026-09-16'], '2026-09-18'), 2);
    // 中间断档（缺 09-16）：只算连续部分
    assert.strictEqual(computeStreak(['2026-09-18', '2026-09-17', '2026-09-15'], '2026-09-18'), 2);
    // 重复日期不重复计数
    assert.strictEqual(computeStreak(['2026-09-18', '2026-09-18', '2026-09-17'], '2026-09-18'), 2);
    // 跨月（9 月 1 日接 8 月 31 日）
    assert.strictEqual(computeStreak(['2026-09-01', '2026-08-31'], '2026-09-01'), 2);
});

test('computeStudyStats：总/难度/分类分布 + 今日进度 + 打卡', () => {
    const cat1 = CATEGORIES[0]; // 哈希 (Hash)
    const cat2 = CATEGORIES[1]; // 双指针 (Two Pointers)
    const list = [
        q('1', cat1, 'EASY'),
        q('2', cat1, 'EASY'),
        q('3', cat1, 'MEDIUM'),
        q('4', cat2, 'MEDIUM'),
        q('5', cat2, 'HARD')
    ];
    const statuses: Record<string, 'ac' | 'notac' | null> = { '1': 'ac', '2': 'ac', '3': 'notac', '4': null, '5': 'ac' };
    const stats = computeStudyStats(
        list,
        x => statuses[x.frontendQuestionId] ?? null,
        ['2026-09-18', '2026-09-17'],
        '2026-09-18'
    );
    assert.deepStrictEqual(stats.total, { total: 5, solved: 3, attempted: 1, notStarted: 1 });
    // 难度行顺序：简单 2/2、中等 0/2（3 号尝试过、4 号未做）、困难 1/1
    assert.deepStrictEqual(stats.difficultyRows.map(r => [r.level, r.solved, r.total]), [
        ['EASY', 2, 2], ['MEDIUM', 0, 2], ['HARD', 1, 1]
    ]);
    // 分类行按 CATEGORIES 顺序，只算有题的分类（保持全序数组，其余 total=0）
    const catRowMap = new Map(stats.categoryRows.map(r => [r.category, r]));
    assert.deepStrictEqual(catRowMap.get(cat1), { category: cat1, solved: 2, total: 3 });
    assert.deepStrictEqual(catRowMap.get(cat2), { category: cat2, solved: 1, total: 2 });
    assert.strictEqual(stats.streakDays, 2);
    assert.strictEqual(stats.todaySolved, 1);
});