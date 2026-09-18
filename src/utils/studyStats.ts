/**
 * 刷题统计纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 统计行（总/难度/分类分布）、连续打卡天数、今日目标进度。
 * 打卡日期为本地时区 'YYYY-MM-DD' 字符串集合，由"提交通过"事件累积（仅记扩展内的通过）。
 */

import { Hot100Question, CATEGORIES } from '../data/hot100Data';
import { DifficultyLevel, DIFFICULTY_ORDER, isDifficultyLevel } from './difficultyGroups';
import { computeProgressStats, ProgressStats, QuestionStatus } from './progressStats';

/** 本地日期串 'YYYY-MM-DD'（本地时区，打卡/每日目标按天计） */
export function localDateStr(now: Date = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function prevDateStr(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return localDateStr(dt);
}

/**
 * 连续打卡天数：从今天往前数连续有提交通过的天数；
 * 今天还没通过则从昨天往前数（当天尚未刷完不算断）
 */
export function computeStreak(solvedDates: readonly string[], today: string = localDateStr()): number {
    const dates = new Set(solvedDates);
    let cursor = dates.has(today) ? today : prevDateStr(today);
    let streak = 0;
    while (dates.has(cursor)) {
        streak++;
        cursor = prevDateStr(cursor);
    }
    return streak;
}

export interface StudyStats {
    total: ProgressStats;
    /** 按难度分布（简单/中等/困难顺序） */
    difficultyRows: Array<{ level: DifficultyLevel; solved: number; total: number }>;
    /** 按分类分布（保持 CATEGORIES 顺序） */
    categoryRows: Array<{ category: string; solved: number; total: number }>;
    streakDays: number;
    /** 今日通过数（本地日期匹配） */
    todaySolved: number;
}

/**
 * 汇总刷题统计：总进度 + 难度/分类分布 + 连续打卡 + 今日进度。
 * 统计始终基于全列表（不受侧栏状态筛选影响），与总进度行行为一致。
 */
export function computeStudyStats(
    questions: Hot100Question[],
    statusOf: (q: Hot100Question) => QuestionStatus | undefined,
    solvedDates: readonly string[],
    today: string = localDateStr()
): StudyStats {
    const total = computeProgressStats(questions.map(q => statusOf(q)));
    const difficultyRows = DIFFICULTY_ORDER.map(level => {
        const stats = computeProgressStats(
            questions.filter(q => isDifficultyLevel(q.difficulty) && q.difficulty === level).map(q => statusOf(q))
        );
        return { level, solved: stats.solved, total: stats.total };
    });
    const categoryRows = CATEGORIES.map(category => {
        const stats = computeProgressStats(questions.filter(q => q.category === category).map(q => statusOf(q)));
        return { category, solved: stats.solved, total: stats.total };
    });
    return {
        total,
        difficultyRows,
        categoryRows,
        streakDays: computeStreak(solvedDates, today),
        todaySolved: solvedDates.filter(d => d === today).length
    };
}