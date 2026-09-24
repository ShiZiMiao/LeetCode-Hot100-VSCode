/**
 * 题目视图顺序纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * "下一题"按当前分组方式在完整列表顺序中前进（不受状态筛选影响，筛选下仍可达所有题）。
 */

import { Hot100Question, CATEGORIES } from '../data/hot100Data';
import { DIFFICULTY_ORDER, byFrontendQuestionIdAsc, isDifficultyLevel } from './difficultyGroups';

/** 侧栏分组方式：按分类（官网默认）/ 按难度（简单→中等→困难，组内按题号升序） */
export type GroupByMode = 'category' | 'difficulty';

/**
 * 当前分组方式下的题目顺序：
 * 按难度 = 简单 → 中等 → 困难，组内按题号升序；按分类 = CATEGORIES 顺序 + 组内 CSV 顺序。
 * 与 provider 展示顺序保持一致（不含状态筛选）。
 */
export function orderedQuestions(questions: Hot100Question[], mode: GroupByMode): Hot100Question[] {
    if (mode === 'difficulty') {
        // 与 buildDifficultyGroups 同一排序语义（难度非法不入组、组内题号升序），
        // 直接复用其组序与比较器，不再借用状态筛选接口传假实参
        return DIFFICULTY_ORDER.flatMap(level =>
            questions
                .filter(q => isDifficultyLevel(q.difficulty) && q.difficulty === level)
                .sort(byFrontendQuestionIdAsc)
        );
    }
    return CATEGORIES.flatMap(category => questions.filter(q => q.category === category));
}

/**
 * 顺序列表中的下一题：返回当前题的后一题；当前题不在列表时从头开始（返回第一题）。
 * 已是末题时返回 undefined，由调用方提示"已是最后一题"。
 */
export function nextQuestion(ordered: Hot100Question[], currentId: string): Hot100Question | undefined {
    const idx = ordered.findIndex(q => q.frontendQuestionId === currentId);
    if (idx === -1) {
        return ordered[0];
    }
    return ordered[idx + 1];
}