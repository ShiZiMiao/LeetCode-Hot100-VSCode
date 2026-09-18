/**
 * 按难度分组纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 分组顺序固定 简单 → 中等 → 困难；同难度组内按题号（数值）升序。
 */

import { Hot100Question } from '../data/hot100Data';
import { QuestionStatus, matchesStatusFilter, StatusFilter } from './progressStats';

/** 难度等级（与列表 API 的 EASY/MEDIUM/HARD 大写枚举一致；静态数据同此类型） */
export type DifficultyLevel = 'EASY' | 'MEDIUM' | 'HARD';

/** 分组展示顺序：简单 → 中等 → 困难 */
export const DIFFICULTY_ORDER: DifficultyLevel[] = ['EASY', 'MEDIUM', 'HARD'];

/** 难度分组标题（中文 + 英文，风格与分类名一致） */
export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
    EASY: '简单 (Easy)',
    MEDIUM: '中等 (Medium)',
    HARD: '困难 (Hard)'
};

/** 难度中文短标签（题号方括号/搜索项/统计行用） */
export const DIFFICULTY_ZH: Record<DifficultyLevel, string> = {
    EASY: '简单',
    MEDIUM: '中等',
    HARD: '困难'
};

export function isDifficultyLevel(value: string | undefined | null): value is DifficultyLevel {
    return value === 'EASY' || value === 'MEDIUM' || value === 'HARD';
}

/** 同难度组内按题号升序：'11' / '9' 用数值比较，避免字符串序（'11' < '9'） */
export function byFrontendQuestionIdAsc(a: Hot100Question, b: Hot100Question): number {
    return Number(a.frontendQuestionId) - Number(b.frontendQuestionId);
}

/**
 * 按难度构建分组：始终按 简单 → 中等 → 困难 顺序输出三组（组内题目经状态筛选后可能为空，
 * 调用方自行隐藏空组）。difficultyOf 提供难度来源（静态数据兜底、API 实时数据可覆盖），
 * statusOf 与 filter 复用侧栏状态筛选，与按分类模式行为一致。
 */
export function buildDifficultyGroups(
    questions: Hot100Question[],
    difficultyOf: (q: Hot100Question) => DifficultyLevel | undefined,
    statusOf: (q: Hot100Question) => QuestionStatus | undefined,
    filter: StatusFilter
): Array<{ level: DifficultyLevel; questions: Hot100Question[] }> {
    return DIFFICULTY_ORDER.map(level => ({
        level,
        questions: questions
            .filter(q =>
                difficultyOf(q) === level &&
                matchesStatusFilter(statusOf(q), filter)
            )
            .sort(byFrontendQuestionIdAsc)
    }));
}