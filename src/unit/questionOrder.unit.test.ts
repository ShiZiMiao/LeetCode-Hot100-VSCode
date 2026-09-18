/**
 * questionOrder 题目视图顺序纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { orderedQuestions, nextQuestion } from '../utils/questionOrder';
import { Hot100Question, CATEGORIES } from '../data/hot100Data';

const cat1 = CATEGORIES[0]; // 哈希 (Hash)
const cat2 = CATEGORIES[1]; // 双指针 (Two Pointers)

function q(id: string, category: string, difficulty: string): Hot100Question {
    return { category, frontendQuestionId: id, difficulty, titleSlug: 'q-' + id, titleCn: '题' + id, titleEn: 'Q' + id };
}

test('orderedQuestions：按分类 = CATEGORIES 顺序 + 组内 CSV 顺序', () => {
    const list = [q('3', cat2, 'MEDIUM'), q('1', cat1, 'EASY'), q('2', cat2, 'MEDIUM')];
    const ordered = orderedQuestions(list, 'category');
    assert.deepStrictEqual(ordered.map(x => x.frontendQuestionId), ['1', '3', '2']);
});

test('orderedQuestions：按难度 = 简单→中等→困难，组内题号升序', () => {
    const list = [q('3', cat1, 'MEDIUM'), q('1', cat1, 'EASY'), q('283', cat2, 'EASY'), q('11', cat2, 'EASY'), q('51', cat1, 'HARD')];
    const ordered = orderedQuestions(list, 'difficulty');
    assert.deepStrictEqual(ordered.map(x => x.frontendQuestionId), ['1', '11', '283', '3', '51']);
});

test('orderedQuestions：难度非法（未知值）不进入任何组', () => {
    const list = [q('1', cat1, 'EASY'), q('99', cat1, 'UNKNOWN')];
    assert.deepStrictEqual(orderedQuestions(list, 'difficulty').map(x => x.frontendQuestionId), ['1']);
});

test('nextQuestion：中间/首位/末位/未知', () => {
    const list = [q('1', cat1, 'EASY'), q('2', cat1, 'MEDIUM'), q('3', cat1, 'HARD')];
    assert.strictEqual(nextQuestion(list, '1')?.frontendQuestionId, '2');
    assert.strictEqual(nextQuestion(list, '2')?.frontendQuestionId, '3');
    assert.strictEqual(nextQuestion(list, '3'), undefined); // 末题
    assert.strictEqual(nextQuestion(list, '999')?.frontendQuestionId, '1'); // 不在列表：从头开始
    assert.strictEqual(nextQuestion([], '1'), undefined); // 空列表
});