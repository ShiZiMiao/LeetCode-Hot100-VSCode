/**
 * difficultyGroups 纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { buildDifficultyGroups, DIFFICULTY_ORDER, DIFFICULTY_LABELS, isDifficultyLevel, byFrontendQuestionIdAsc } from '../utils/difficultyGroups';
import { HOT_100_LIST, Hot100Question, CATEGORIES, categoryLabel } from '../data/hot100Data';

function q(id: string, difficulty: string): Hot100Question {
    return { category: '测试', frontendQuestionId: id, difficulty, titleSlug: 'q-' + id, titleCn: '题' + id, titleEn: 'Q' + id };
}

test('DIFFICULTY_ORDER 固定为 简单 → 中等 → 困难', () => {
    assert.deepStrictEqual(DIFFICULTY_ORDER, ['EASY', 'MEDIUM', 'HARD']);
    assert.strictEqual(DIFFICULTY_LABELS.EASY, '简单 (Easy)');
    assert.strictEqual(DIFFICULTY_LABELS.MEDIUM, '中等 (Medium)');
    assert.strictEqual(DIFFICULTY_LABELS.HARD, '困难 (Hard)');
});

test('isDifficultyLevel 只认大写枚举', () => {
    assert.strictEqual(isDifficultyLevel('EASY'), true);
    assert.strictEqual(isDifficultyLevel('Medium'), false);
    assert.strictEqual(isDifficultyLevel(''), false);
    assert.strictEqual(isDifficultyLevel(undefined), false);
});

test('buildDifficultyGroups：难度顺序与输入顺序无关，组内按题号数值升序', () => {
    // 打乱输入顺序；'11' 与 '3' 验证数值比较而非字符串比较
    const list = [q('283', 'EASY'), q('42', 'HARD'), q('11', 'EASY'), q('3', 'EASY'), q('51', 'HARD'), q('2', 'MEDIUM')];
    const groups = buildDifficultyGroups(list, x => isDifficultyLevel(x.difficulty) ? x.difficulty : undefined, () => null, 'all');
    assert.deepStrictEqual(groups.map(g => g.level), ['EASY', 'MEDIUM', 'HARD']);
    assert.deepStrictEqual(groups[0].questions.map(x => x.frontendQuestionId), ['3', '11', '283']);
    assert.deepStrictEqual(groups[1].questions.map(x => x.frontendQuestionId), ['2']);
    assert.deepStrictEqual(groups[2].questions.map(x => x.frontendQuestionId), ['42', '51']);
});

test('buildDifficultyGroups：未知难度不落入任何分组', () => {
    const list = [q('1', 'EASY'), q('99', 'UNKNOWN')];
    const groups = buildDifficultyGroups(list, x => x.difficulty === 'UNKNOWN' ? undefined : x.difficulty as 'EASY', () => null, 'all');
    assert.deepStrictEqual(groups[0].questions.map(x => x.frontendQuestionId), ['1']);
    assert.strictEqual(groups[1].questions.length, 0);
    assert.strictEqual(groups[2].questions.length, 0);
});

test('buildDifficultyGroups：状态筛选与按分类模式一致', () => {
    const list = [q('1', 'EASY'), q('2', 'EASY'), q('3', 'EASY')];
    const statuses: Record<string, string> = { '1': 'ac', '2': 'notac' };
    const groups = buildDifficultyGroups(
        list,
        x => x.difficulty as 'EASY',
        x => (statuses[x.frontendQuestionId] === 'ac' ? 'ac' : statuses[x.frontendQuestionId] === 'notac' ? 'notac' : null),
        'solved'
    );
    assert.deepStrictEqual(groups[0].questions.map(x => x.frontendQuestionId), ['1']);
    const notStarted = buildDifficultyGroups(
        list,
        x => x.difficulty as 'EASY',
        x => (statuses[x.frontendQuestionId] === 'ac' ? 'ac' : statuses[x.frontendQuestionId] === 'notac' ? 'notac' : null),
        'not_started'
    );
    assert.deepStrictEqual(notStarted[0].questions.map(x => x.frontendQuestionId), ['3']);
});

test('buildDifficultyGroups：空输入三组皆空', () => {
    const groups = buildDifficultyGroups([], x => x.difficulty as 'EASY', () => null, 'all');
    assert.deepStrictEqual(groups.map(g => g.questions.length), [0, 0, 0]);
});

test('静态数据：分类名可提取中文标签（难度分组的题目标签）', () => {
    for (const c of CATEGORIES) {
        const label = categoryLabel(c);
        assert.ok(label.length > 0 && !label.includes('('), `${c} 提取异常: ${label}`);
    }
    assert.strictEqual(categoryLabel('哈希 (Hash)'), '哈希');
    assert.strictEqual(categoryLabel('多维动态规划 (Multi-dimensional DP)'), '多维动态规划');
});

test('静态数据：100 题难度齐全且分组总数守恒（20 简单 / 68 中等 / 12 困难）', () => {
    assert.strictEqual(HOT_100_LIST.length, 100);
    for (const item of HOT_100_LIST) {
        assert.ok(isDifficultyLevel(item.difficulty), `${item.frontendQuestionId} 难度非法: ${item.difficulty}`);
    }
    const groups = buildDifficultyGroups(HOT_100_LIST, x => x.difficulty as 'EASY', () => null, 'all');
    const counts = groups.map(g => g.questions.length);
    assert.deepStrictEqual(counts, [20, 68, 12]);
    assert.strictEqual(counts.reduce((a, b) => a + b, 0), 100);
    // 组内题号升序（遍历检查相邻项）
    for (const g of groups) {
        for (let i = 1; i < g.questions.length; i++) {
            assert.ok(byFrontendQuestionIdAsc(g.questions[i - 1], g.questions[i]) < 0, `${g.level} 组内题号未升序`);
        }
    }
});