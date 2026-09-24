/**
 * similarQuestions 相似题目解析纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { parseSimilarQuestions, difficultyZhOf } from '../utils/similarQuestions';

test('parseSimilarQuestions：JSON 字符串数组（真实接口形态）', () => {
    const raw = '[{"title": "3Sum", "titleSlug": "3sum", "difficulty": "Medium", "translatedTitle": "三数之和", "isPaidOnly": false}, {"title": "4Sum", "titleSlug": "4sum", "difficulty": "Medium", "translatedTitle": "四数之和", "isPaidOnly": true}]';
    const list = parseSimilarQuestions(raw);
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list[0], { titleSlug: '3sum', title: '3Sum', translatedTitle: '三数之和', difficulty: 'Medium', paidOnly: false });
    assert.strictEqual(list[1].paidOnly, true);
});

test('parseSimilarQuestions：非法 JSON/非数组/无 slug 条目被过滤', () => {
    assert.deepStrictEqual(parseSimilarQuestions('{broken'), []);
    assert.deepStrictEqual(parseSimilarQuestions('"just a string"'), []);
    assert.deepStrictEqual(parseSimilarQuestions(undefined), []);
    assert.deepStrictEqual(parseSimilarQuestions(null), []);
    assert.deepStrictEqual(parseSimilarQuestions(JSON.stringify([{ title: '无 slug' }, { titleSlug: 'ok', title: 't' }])).map(x => x.titleSlug), ['ok']);
    // 兼容已是数组的形态
    assert.strictEqual(parseSimilarQuestions([{ titleSlug: 'a' }]).length, 1);
});

test('difficultyZhOf：详情接口大小写 → 中文，未知原样', () => {
    assert.strictEqual(difficultyZhOf('Easy'), '简单');
    assert.strictEqual(difficultyZhOf('Medium'), '中等');
    assert.strictEqual(difficultyZhOf('Hard'), '困难');
    assert.strictEqual(difficultyZhOf('EASY'), '简单');
    assert.strictEqual(difficultyZhOf(''), '');
    assert.strictEqual(difficultyZhOf('X'), 'X');
});