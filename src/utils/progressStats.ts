/**
 * 刷题进度统计纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 */

/** 题目状态：ac=已解决（提交通过）、notac=尝试过（运行/提交未通过）、null=未做 */
export type QuestionStatus = 'ac' | 'notac' | null;

export interface ProgressStats {
    total: number;
    solved: number;
    attempted: number;
    notStarted: number;
}

export function computeProgressStats(statuses: Array<QuestionStatus | string | null | undefined>): ProgressStats {
    let solved = 0;
    let attempted = 0;
    let notStarted = 0;
    for (const s of statuses) {
        if (s === 'ac') {
            solved++;
        } else if (s === 'notac') {
            attempted++;
        } else {
            notStarted++;
        }
    }
    return { total: statuses.length, solved, attempted, notStarted };
}

export function progressPercent(stats: ProgressStats): number {
    return stats.total > 0 ? Math.round((stats.solved / stats.total) * 100) : 0;
}

export type StatusFilter = 'all' | 'solved' | 'attempted' | 'not_started';

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
    all: '全部',
    solved: '已解决',
    attempted: '尝试过',
    not_started: '未做'
};

export function matchesStatusFilter(status: QuestionStatus | string | null | undefined, filter: StatusFilter): boolean {
    if (filter === 'all') {
        return true;
    }
    if (filter === 'solved') {
        return status === 'ac';
    }
    if (filter === 'attempted') {
        return status === 'notac';
    }
    // not_started：未尝试（含状态未知/空串）
    return status === null || status === undefined || status === '';
}