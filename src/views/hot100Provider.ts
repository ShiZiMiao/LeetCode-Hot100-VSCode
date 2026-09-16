/**
 * Hot 100 题目列表 Provider
 * 实现按分类的树形结构显示；顶层含总进度与错题回顾入口，
 * 支持状态筛选（未做/已解决/尝试过）与判题结果实时更新（本地状态 + 错题队列）
 */

import * as vscode from 'vscode';
import { LeetCodeApi, Question } from '../core/leetcodeApi';
import { HOT_100_LIST, CATEGORIES, Hot100Question, HOT_100_IDS, ID_TO_SLUG } from '../data/hot100Data';
import { computeProgressStats, progressPercent, matchesStatusFilter, ProgressStats, StatusFilter, STATUS_FILTER_LABELS, QuestionStatus } from '../utils/progressStats';
import { WrongEntry, addWrongEntry, removeWrongEntry, formatFailedAt } from '../utils/wrongQueue';

// 树形节点类型
type TreeNode = CategoryItem | QuestionItem | ProgressItem | WrongCategoryItem;

const WRONG_STORE_KEY = 'hot100WrongQueue';

// frontendQuestionId → titleSlug 反向映射（用于判题结果按 slug 更新本地状态）
const SLUG_TO_ID: Map<string, string> = new Map(
    [...ID_TO_SLUG.entries()].map(([id, slug]) => [slug, id] as [string, string])
);

function statusOf(status: QuestionStatus | string | null | undefined): QuestionStatus {
    return status === 'ac' ? 'ac' : status === 'notac' ? 'notac' : null;
}

/**
 * Hot 100 Provider - 实现分类树形结构
 */
export class Hot100Provider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private leetCodeApi: LeetCodeApi;
    private store?: vscode.Memento;
    // 存储题目状态信息（从API获取 + 判题结果本地更新）
    private questionStatusMap: Map<string, QuestionStatus> = new Map();
    // 存储题目难度（从API获取：EASY/MEDIUM/HARD）
    private questionDifficultyMap: Map<string, string> = new Map();
    private isLoaded: boolean = false;
    private filter: StatusFilter = 'all';
    private wrongList: WrongEntry[] = [];

    constructor(leetCodeApi: LeetCodeApi, store?: vscode.Memento) {
        this.leetCodeApi = leetCodeApi;
        this.store = store;
        const cached = store?.get<WrongEntry[]>(WRONG_STORE_KEY, []);
        if (Array.isArray(cached)) {
            this.wrongList = cached;
        }
    }

    refresh(): void {
        this.isLoaded = false;
        this.questionStatusMap.clear();
        this.questionDifficultyMap.clear();
        this._onDidChangeTreeData.fire();
    }

    /** 设置状态筛选并刷新树 */
    setStatusFilter(filter: StatusFilter): void {
        this.filter = filter;
        this._onDidChangeTreeData.fire();
    }

/**
	 * 判题结果接入：更新题目状态（测试/提交均算"尝试过"，提交通过算"已解决"；
	 * 已解决不会被测试结果降级）。recordWrong=true 时维护错题回顾队列
	 * （提交失败入队、通过自动移出；测试失败不记队列）
	 */
	recordJudgeResult(titleSlug: string, opts: { solved: boolean; reason?: string; recordWrong?: boolean }): void {
		const id = SLUG_TO_ID.get(titleSlug);
		if (id) {
			const cur = statusOf(this.questionStatusMap.get(id));
			this.questionStatusMap.set(id, opts.solved ? 'ac' : cur === 'ac' ? 'ac' : 'notac');
		}
		if (opts.recordWrong) {
			const entry: WrongEntry = {
				titleSlug,
				title: HOT_100_LIST.find(q => q.titleSlug === titleSlug)?.titleCn || titleSlug,
				failedAt: Date.now(),
				reason: opts.reason || '未通过'
			};
			this.wrongList = opts.solved
				? removeWrongEntry(this.wrongList, titleSlug)
				: addWrongEntry(this.wrongList, entry);
			this.store?.update(WRONG_STORE_KEY, this.wrongList);
		}
		if (id || this.wrongList.length > 0) {
			this._onDidChangeTreeData.fire();
		}
	}

    /** 清空错题回顾队列 */
    clearWrongQueue(): void {
        this.wrongList = [];
        this.store?.update(WRONG_STORE_KEY, []);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        // 如果还没有加载过，先从API获取题目状态
        if (!this.isLoaded) {
            await this.loadQuestionStatus();
            this.isLoaded = true;
        }

        // 顶层：进度 + 错题回顾 + 分类
        if (!element) {
            const totalStats = computeProgressStats(
                HOT_100_LIST.map(q => statusOf(this.questionStatusMap.get(q.frontendQuestionId)))
            );
            const nodes: TreeNode[] = [new ProgressItem(totalStats, this.filter)];
            if (this.wrongList.length > 0) {
                nodes.push(new WrongCategoryItem(this.wrongList.length));
            }
            for (const [index, category] of CATEGORIES.entries()) {
                const categoryQuestions = HOT_100_LIST.filter(
                    q => q.category === category && matchesStatusFilter(statusOf(this.questionStatusMap.get(q.frontendQuestionId)), this.filter)
                );
                if (categoryQuestions.length === 0) {
                    // 筛选后无匹配题目时隐藏分组
                    continue;
                }
                const catStats = computeProgressStats(categoryQuestions.map(q => statusOf(this.questionStatusMap.get(q.frontendQuestionId))));
                nodes.push(new CategoryItem(category, categoryQuestions.length, catStats.solved, index));
            }
            return nodes;
        }

        // 错题回顾：显示失败记录（最新在前）
        if (element instanceof WrongCategoryItem) {
            return this.wrongList.map(w => new WrongItem(w, SLUG_TO_ID.get(w.titleSlug) || ''));
        }

        // 分类下面：显示该分类的题目
        if (element instanceof CategoryItem) {
            const categoryQuestions = HOT_100_LIST.filter(
                q => q.category === element.category && matchesStatusFilter(statusOf(this.questionStatusMap.get(q.frontendQuestionId)), this.filter)
            );
            return categoryQuestions.map(q => {
                const status = statusOf(this.questionStatusMap.get(q.frontendQuestionId));
                const difficulty = this.questionDifficultyMap.get(q.frontendQuestionId) || '';
                return new QuestionItem(q, status, difficulty);
            });
        }

        return [];
    }

    /**
     * 从API加载题目状态（已完成/未完成等）
     */
    private async loadQuestionStatus(): Promise<void> {
        try {
            // 获取足够多的题目以覆盖所有Hot 100
            const allQuestions = await this.leetCodeApi.getHot100Problems();

            // 构建状态映射
            for (const q of allQuestions) {
                if (HOT_100_IDS.has(q.frontendQuestionId)) {
                    // leetcode.cn 列表接口的状态是大写枚举（AC/TRIED/NOT_STARTED），
                    // 与 question 详情接口的小写 status（ac/notac/null）不同，统一归一化
                    const raw = q.status;
                    this.questionStatusMap.set(
                        q.frontendQuestionId,
                        raw === 'AC' ? 'ac' : raw === 'TRIED' ? 'notac' : null
                    );
                    if (q.difficulty) {
                        this.questionDifficultyMap.set(q.frontendQuestionId, q.difficulty);
                    }
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`加载题目状态失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * 总进度节点（侧栏首行）
 */
export class ProgressItem extends vscode.TreeItem {
    constructor(stats: ProgressStats, filter: StatusFilter) {
        super(`📊 总进度：${stats.solved} / ${stats.total}（${progressPercent(stats)}%）`, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `已解决 ${stats.solved} · 尝试过 ${stats.attempted} · 未做 ${stats.notStarted}\n点击切换状态筛选`;
        this.description = filter === 'all' ? '' : `筛选：${STATUS_FILTER_LABELS[filter]}`;
        this.iconPath = new vscode.ThemeIcon('graph');
        this.command = { command: 'leetcode.setStatusFilter', title: '状态筛选' };
        this.contextValue = 'progress';
    }
}

/**
 * 错题回顾分类节点（入口，可展开）
 */
export class WrongCategoryItem extends vscode.TreeItem {
    constructor(count: number) {
        super(`❌ 错题回顾（${count}）`, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = '提交失败的题目，按失败时间倒序；提交通过后自动移出';
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
        this.contextValue = 'wrongCategory';
    }
}

/**
 * 错题回顾条目
 */
export class WrongItem extends vscode.TreeItem {
    constructor(entry: WrongEntry, frontendQuestionId: string) {
        const idPrefix = frontendQuestionId ? `[${frontendQuestionId}] ` : '';
        super(`❌ ${idPrefix}${entry.title}`, vscode.TreeItemCollapsibleState.None);
        const ts = formatFailedAt(entry.failedAt);
        this.description = `${ts} · ${entry.reason}`;
        this.tooltip = `${entry.titleSlug}\n失败：${ts} · ${entry.reason}\n点击重新打开题目`;
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
        const q = HOT_100_LIST.find(x => x.titleSlug === entry.titleSlug);
        if (q) {
            this.command = {
                command: 'leetcode.openProblem',
                title: 'Open Problem',
                arguments: [{
                    frontendQuestionId: q.frontendQuestionId,
                    title: q.titleCn,
                    titleSlug: q.titleSlug,
                    difficulty: '',
                    status: null
                } as Question]
            };
        }
        this.contextValue = 'wrong';
    }
}

/**
 * 分类节点
 */
export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly category: string,
        public readonly questionCount: number,
        public readonly solvedCount: number,
        public readonly index: number
    ) {
        super(category, vscode.TreeItemCollapsibleState.Collapsed);

        this.tooltip = `${category} - 共 ${questionCount} 题，已解决 ${solvedCount}`;
        this.description = `已解 ${solvedCount} / ${questionCount}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'category';
    }
}

/**
 * 题目节点
 */
export class QuestionItem extends vscode.TreeItem {
    public readonly question: Question;

    constructor(
        hot100Question: Hot100Question,
        status: QuestionStatus,
        difficulty: string = ''
    ) {
        // 列表接口返回大写难度枚举（EASY/MEDIUM/HARD），与详情接口区分大小写不同
        const difficultyZh = difficulty === 'EASY' ? '简单' : difficulty === 'MEDIUM' ? '中等' : difficulty === 'HARD' ? '困难' : '';
        // 难度与题号一起放在中括号里，如 [1 · 简单]
        const label = `[${hot100Question.frontendQuestionId}${difficultyZh ? ' · ' + difficultyZh : ''}] ${hot100Question.titleCn}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        // 构建Question对象
        this.question = {
            frontendQuestionId: hot100Question.frontendQuestionId,
            title: hot100Question.titleCn,
            titleSlug: hot100Question.titleSlug,
            difficulty: difficulty,
            status: status
        };

        this.tooltip = `${hot100Question.titleEn} - ${hot100Question.titleCn}`;
        this.description = hot100Question.titleEn;

        // 状态图标
        if (status === 'ac') {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
        } else if (status === 'notac') {
            this.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconFailed'));
        } else {
            this.iconPath = new vscode.ThemeIcon('circle-outline');
        }

        // 点击命令
        this.command = {
            command: 'leetcode.openProblem',
            title: 'Open Problem',
            arguments: [this.question]
        };

        this.contextValue = 'question';
    }
}