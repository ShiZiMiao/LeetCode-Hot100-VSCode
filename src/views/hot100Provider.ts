/**
 * Hot 100 题目列表 Provider
 * 实现按分类（官网默认）或按难度（简单/中等/困难）的树形结构显示；顶层含总进度与错题回顾入口，
 * 支持状态筛选（未做/已解决/尝试过）与判题结果实时更新（本地状态 + 错题队列）
 */

import * as vscode from 'vscode';
import { LeetCodeApi, Question } from '../core/leetcodeApi';
import { HOT_100_LIST, CATEGORIES, Hot100Question, HOT_100_IDS, ID_TO_SLUG, categoryLabel } from '../data/hot100Data';
import { computeProgressStats, progressPercent, matchesStatusFilter, ProgressStats, StatusFilter, STATUS_FILTER_LABELS, QuestionStatus } from '../utils/progressStats';
import { WrongEntry, addWrongEntry, removeWrongEntry, formatFailedAt, failureCountOf, nextReviewAt, isReviewDue, sortWrongByReview } from '../utils/wrongQueue';
import { DifficultyLevel, DIFFICULTY_LABELS, DIFFICULTY_ZH, buildDifficultyGroups, isDifficultyLevel } from '../utils/difficultyGroups';
import { computeStudyStats, localDateStr, StudyStats } from '../utils/studyStats';
import { pickDailyQuestion } from '../utils/dailyQuestion';
import { GroupByMode, orderedQuestions } from '../utils/questionOrder';
import { formatAcRate } from '../utils/metaFormat';

export type { GroupByMode } from '../utils/questionOrder';

// 树形节点类型
type TreeNode = CategoryItem | QuestionItem | ProgressItem | WrongCategoryItem | DifficultyItem | StatsItem | StatsRowItem | FavoriteItem | DailyItem;

const WRONG_STORE_KEY = 'hot100WrongQueue';
const GROUP_BY_STORE_KEY = 'hot100GroupBy';
const SOLVED_DATES_KEY = 'hot100SolvedDates';
const FAVORITES_KEY = 'hot100Favorites';

/** 列表接口下发的题目元数据（展示用；仅保留实际消费的字段） */
interface QuestionMeta {
    paidOnly: boolean;
    acRate?: number;
}

// 每日目标默认值（可在设置 leetcode.dailyGoal 中修改）
const DEFAULT_DAILY_GOAL = 3;

function dailyGoal(): number {
    const v = vscode.workspace.getConfiguration('leetcode').get<number>('dailyGoal', DEFAULT_DAILY_GOAL);
    return Number.isInteger(v) && v > 0 ? v : DEFAULT_DAILY_GOAL;
}

// titleSlug → frontendQuestionId 映射（用于判题结果按 slug 更新本地状态）
const SLUG_TO_ID: Map<string, string> = new Map(
    [...ID_TO_SLUG.entries()].map(([id, slug]) => [slug, id] as [string, string])
);

/** 状态归一化：宽入参是有意为之（globalState 历史值/接口脏数据统一按未做处理，有单测覆盖） */
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
    // 首次加载的 in-flight Promise（并发 getChildren 复用，避免各自重复拉全部分页）
    private loading?: Promise<void>;
    // 加载世代号：refresh() 递增；晚到的加载结果世代不匹配直接丢弃（否则写回过期状态）
    private loadGeneration = 0;
    private filter: StatusFilter = 'all';
    private groupBy: GroupByMode = 'category';
    private wrongList: WrongEntry[] = [];
    // 提交通过的日期集合（YYYY-MM-DD，本地时区；仅记扩展内通过，用于连续打卡/每日目标）
    private solvedDates: Set<string> = new Set();
    // 本地收藏（与官网收藏独立，离线可用；toggleFavorite 维护）
    private favoriteIds: Set<string> = new Set();
    // 列表接口元数据（会员题/通过率/频次/题解数，API 加载后填充）
    private questionMetaMap: Map<string, QuestionMeta> = new Map();

    constructor(leetCodeApi: LeetCodeApi, store?: vscode.Memento) {
        this.leetCodeApi = leetCodeApi;
        this.store = store;
const cached = store?.get<WrongEntry[]>(WRONG_STORE_KEY, []);
		if (Array.isArray(cached)) {
			// 历史遗留的非 Hot 100 条目（旧版本每日一题/外部文件判题进入）直接清除并同步持久化
			this.wrongList = cached.filter(w => w && typeof w.titleSlug === 'string' && SLUG_TO_ID.has(w.titleSlug));
			if (this.wrongList.length !== cached.length) {
				store?.update(WRONG_STORE_KEY, this.wrongList);
			}
		}
        const cachedDates = store?.get<string[]>(SOLVED_DATES_KEY, []);
        if (Array.isArray(cachedDates)) {
            this.solvedDates = new Set(cachedDates.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)));
        }
        const cachedFavs = store?.get<string[]>(FAVORITES_KEY, []);
        if (Array.isArray(cachedFavs)) {
            this.favoriteIds = new Set(cachedFavs.filter(id => typeof id === 'string'));
        }
        const savedGroupBy = store?.get<string>(GROUP_BY_STORE_KEY, 'category');
        this.groupBy = savedGroupBy === 'difficulty' ? 'difficulty' : 'category';
    }

    /** 当前分组方式（命令面板标题里展示用） */
    get currentGroupBy(): GroupByMode {
        return this.groupBy;
    }

    /** 切换分组方式（按分类/按难度）并刷新树，选择持久化 */
    setGroupBy(mode: GroupByMode): void {
        this.groupBy = mode;
        this.store?.update(GROUP_BY_STORE_KEY, mode);
        this._onDidChangeTreeData.fire();
    }

    /** 收藏状态（本地收藏，独立于官网 isFavor） */
    isFavorite(frontendQuestionId: string): boolean {
        return this.favoriteIds.has(frontendQuestionId);
    }

    /** 切换收藏并持久化，返回切换后的状态 */
    toggleFavorite(frontendQuestionId: string): boolean {
        if (this.favoriteIds.has(frontendQuestionId)) {
            this.favoriteIds.delete(frontendQuestionId);
        } else {
            this.favoriteIds.add(frontendQuestionId);
        }
        this.store?.update(FAVORITES_KEY, [...this.favoriteIds]);
        this._onDidChangeTreeData.fire();
        return this.favoriteIds.has(frontendQuestionId);
    }

    refresh(): void {
        this.loadGeneration++;
        this.loading = undefined;
        this.isLoaded = false;
        this.questionStatusMap.clear();
        this.questionDifficultyMap.clear();
        this.questionMetaMap.clear();
        this._onDidChangeTreeData.fire();
    }

    /** 设置状态筛选并刷新树 */
    setStatusFilter(filter: StatusFilter): void {
        this.filter = filter;
        this._onDidChangeTreeData.fire();
    }

    /** 仅重绘当前树（外部配置变化等场景，不重拉 API 状态） */
    rerender(): void {
        this._onDidChangeTreeData.fire();
    }

/**
	 * 判题结果接入：更新题目状态（测试/提交均算"尝试过"，提交通过算"已解决"；
	 * 已解决不会被测试结果降级）。recordWrong=true 时维护错题回顾队列
	 * （提交失败入队、通过自动移出；测试失败不记队列）。
	 * 非 Hot 100 题（外部文件解析而来）保留通用判题流程，但侧栏的错题队列、
	 * 打卡/每日目标统计等 Hot 100 专属功能不记录它。
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
			// 通过时无条件移出（含历史遗留的非 Hot 100 旧条目）；失败仅 Hot 100 入队
			if (opts.solved) {
				this.wrongList = removeWrongEntry(this.wrongList, titleSlug);
			} else if (id) {
				this.wrongList = addWrongEntry(this.wrongList, entry);
			}
			this.store?.update(WRONG_STORE_KEY, this.wrongList);
		}
		// 提交通过当日打卡：连续打卡/每日目标进度依赖此集合（仅 Hot 100）
		if (opts.solved && id) {
			this.solvedDates.add(localDateStr());
			this.store?.update(SOLVED_DATES_KEY, [...this.solvedDates]);
		}
		if (id || this.wrongList.length > 0 || opts.solved) {
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
        // 首次加载题目状态（并发展开多节点时复用同一个 in-flight 请求）
        if (!this.isLoaded) {
            if (!this.loading) {
                const gen = this.loadGeneration;
                const p = this.loadQuestionStatus(gen).finally(() => {
                    if (this.loading === p) {
                        this.loading = undefined;
                    }
                });
                this.loading = p;
            }
            await this.loading;
        }

        // 顶层：进度 + 刷题统计 + 错题回顾 + 分类（或难度分组）
        if (!element) {
            const totalStats = computeProgressStats(
                HOT_100_LIST.map(q => statusOf(this.questionStatusMap.get(q.frontendQuestionId)))
            );
            const nodes: TreeNode[] = [new ProgressItem(totalStats, this.filter), new StatsItem(), new DailyItem(pickDailyQuestion(localDateStr()))];
            if (this.wrongList.length > 0) {
                nodes.push(new WrongCategoryItem(this.wrongList.length));
            }
            if (this.favoriteIds.size > 0) {
                nodes.push(new FavoriteItem(this.favoriteIds.size));
            }
            if (this.groupBy === 'difficulty') {
                // 按难度：简单 → 中等 → 困难，组内按题号升序；筛选后无匹配题目时隐藏分组
                for (const group of this.difficultyGroups()) {
                    if (group.questions.length === 0) {
                        continue;
                    }
                    const stats = computeProgressStats(group.questions.map(q => statusOf(this.questionStatusMap.get(q.frontendQuestionId))));
                    nodes.push(new DifficultyItem(group.level, group.questions.length, stats.solved));
                }
                return nodes;
            }
            for (const category of CATEGORIES) {
                const categoryQuestions = HOT_100_LIST.filter(
                    q => q.category === category && matchesStatusFilter(statusOf(this.questionStatusMap.get(q.frontendQuestionId)), this.filter)
                );
                if (categoryQuestions.length === 0) {
                    // 筛选后无匹配题目时隐藏分组
                    continue;
                }
                const catStats = computeProgressStats(categoryQuestions.map(q => statusOf(this.questionStatusMap.get(q.frontendQuestionId))));
                nodes.push(new CategoryItem(category, categoryQuestions.length, catStats.solved));
            }
            return nodes;
        }

        // 错题回顾：显示失败记录（按复习到期排序，到期的排最前）
        if (element instanceof WrongCategoryItem) {
            return sortWrongByReview(this.wrongList).map(w => new WrongItem(w, SLUG_TO_ID.get(w.titleSlug) || ''));
        }

        // 刷题统计：总进度 + 难度/分类分布 + 连续打卡 + 今日目标
        if (element instanceof StatsItem) {
            return this.buildStatsRows();
        }

        // 我的收藏：按当前分组顺序排列（状态筛选与分类/难度分组一致）
        if (element instanceof FavoriteItem) {
            return orderedQuestions(HOT_100_LIST, this.groupBy)
                .filter(q => this.isFavorite(q.frontendQuestionId)
                    && matchesStatusFilter(statusOf(this.questionStatusMap.get(q.frontendQuestionId)), this.filter))
                .map(q => this.toQuestionItem(q));
        }

        // 难度分组下面：显示该难度内按题号升序的题目
        if (element instanceof DifficultyItem) {
            const group = this.difficultyGroups().find(g => g.level === element.level);
            return group ? group.questions.map(q => this.toQuestionItem(q)) : [];
        }

        // 分类下面：显示该分类的题目
        if (element instanceof CategoryItem) {
            const categoryQuestions = HOT_100_LIST.filter(
                q => q.category === element.category && matchesStatusFilter(statusOf(this.questionStatusMap.get(q.frontendQuestionId)), this.filter)
            );
            return categoryQuestions.map(q => this.toQuestionItem(q));
        }

        return [];
    }

    /**
     * 题目难度：优先列表 API 实时值（与题目标签展示一致），API 缺失时回退静态数据，
     * 保证离线/接口失败时按难度分组与标签仍可用。
     */
    private difficultyOf(q: Hot100Question): DifficultyLevel | undefined {
        const api = this.questionDifficultyMap.get(q.frontendQuestionId);
        if (isDifficultyLevel(api)) {
            return api;
        }
        return isDifficultyLevel(q.difficulty) ? q.difficulty : undefined;
    }

    /**
     * 按难度构建分组（简单 → 中等 → 困难，组内题号升序，已套用状态筛选）。
     * 顶层与展开子节点共用，避免两处分组逻辑漂移。
     */
    private difficultyGroups(): Array<{ level: DifficultyLevel; questions: Hot100Question[] }> {
        return buildDifficultyGroups(
            HOT_100_LIST,
            q => this.difficultyOf(q),
            q => statusOf(this.questionStatusMap.get(q.frontendQuestionId)),
            this.filter
        );
    }

    private toQuestionItem(q: Hot100Question): QuestionItem {
        const status = statusOf(this.questionStatusMap.get(q.frontendQuestionId));
        const difficulty = this.difficultyOf(q) || '';
        // 难度分组下组头已标明难度，题目标签改显示所属分类（如「[1 · 哈希]」），避免信息重复
        const labelTag = this.groupBy === 'difficulty' ? categoryLabel(q.category) : undefined;
        return new QuestionItem(q, status, difficulty, labelTag, {
            ...(this.questionMetaMap.get(q.frontendQuestionId) || { paidOnly: false }),
            isFavorite: this.isFavorite(q.frontendQuestionId)
        });
    }

    /** 当前分组方式的题目顺序（不含状态筛选，供"下一题"命令用） */
    ordered(): Hot100Question[] {
        return orderedQuestions(HOT_100_LIST, this.groupBy);
    }

    /** 全量题目 + 状态/难度/元数据（搜索与随机抽题的候选池） */
    allWithMeta(): Array<{ q: Hot100Question; status: QuestionStatus; difficulty: DifficultyLevel | undefined; paidOnly: boolean; isFavorite: boolean }> {
        return HOT_100_LIST.map(q => ({
            q,
            status: statusOf(this.questionStatusMap.get(q.frontendQuestionId)),
            difficulty: this.difficultyOf(q),
            paidOnly: this.questionMetaMap.get(q.frontendQuestionId)?.paidOnly ?? false,
            isFavorite: this.isFavorite(q.frontendQuestionId)
        }));
    }

    /** 当前错题回顾队列（随机错题用） */
    currentWrongList(): WrongEntry[] {
        return this.wrongList;
    }

    /** 刷题统计子节点：总进度 / 难度 / 分类 / 连续打卡 / 今日目标 */
    private buildStatsRows(): StatsRowItem[] {
        const stats: StudyStats = computeStudyStats(
            HOT_100_LIST,
            q => statusOf(this.questionStatusMap.get(q.frontendQuestionId)),
            [...this.solvedDates]
        );
        const rows: StatsRowItem[] = [
            new StatsRowItem(`总进度：${stats.total.solved} / ${stats.total.total}（${progressPercent(stats.total)}%）`, new vscode.ThemeIcon('graph'), undefined, 'statsRow')
        ];
        for (const row of stats.difficultyRows) {
            rows.push(new StatsRowItem(
                `${DIFFICULTY_ZH[row.level]}：${row.solved} / ${row.total}`,
                difficultyIcon(row.level),
                undefined,
                'statsRow'
            ));
        }
        for (const row of stats.categoryRows) {
            rows.push(new StatsRowItem(`${categoryLabel(row.category)}：${row.solved} / ${row.total}`, new vscode.ThemeIcon('folder'), undefined, 'statsRow'));
        }
        rows.push(new StatsRowItem(
            `连续打卡：${stats.streakDays} 天`,
            new vscode.ThemeIcon('flame', new vscode.ThemeColor('charts.orange')),
            stats.todaySolved > 0 ? `今日已通过 ${stats.todaySolved} 题` : undefined,
            'statsRow'
        ));
        const goal = dailyGoal();
        rows.push(new StatsRowItem(
            `今日目标：${Math.min(stats.todaySolved, goal)} / ${goal}`,
            new vscode.ThemeIcon('target'),
            '点击修改每日目标',
            'statsGoal'
        ));
        return rows;
    }

    /**
     * 从API加载题目状态（已完成/未完成等）。gen 为发起时的世代号：
     * 加载期间若发生 refresh()（世代已递增），晚到结果直接丢弃，避免过期状态写回并标记已加载。
     */
    private async loadQuestionStatus(gen: number): Promise<void> {
        try {
            // 获取足够多的题目以覆盖所有Hot 100
            const allQuestions = await this.leetCodeApi.getHot100Problems();
            if (gen !== this.loadGeneration) {
                return;
            }

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
                    this.questionMetaMap.set(q.frontendQuestionId, {
                        paidOnly: q.paidOnly === true,
                        acRate: q.acRate
                    });
                }
            }
        } catch (error) {
            if (gen === this.loadGeneration) {
                vscode.window.showErrorMessage(`加载题目状态失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        } finally {
            if (gen === this.loadGeneration) {
                // 失败也标记已加载（错误已提示），避免每次展开树都重复整表拉取；refresh() 可重试
                this.isLoaded = true;
            }
        }
    }
}

/**
 * 难度彩色圆点图标（绿/黄/红，与官网难度色一致；分组头与统计行共用）
 */
function difficultyIcon(level: DifficultyLevel): vscode.ThemeIcon {
    return new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor(level === 'EASY' ? 'charts.green' : level === 'MEDIUM' ? 'charts.yellow' : 'charts.red')
    );
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
        this.tooltip = '提交失败的题目，按复习到期排序（到期的排最前）；提交通过后自动移出';
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
        this.contextValue = 'wrongCategory';
    }
}

/**
 * 错题回顾条目：显示失败次数、最近失败时间与原因（按复习到期排序后展示）
 */
export class WrongItem extends vscode.TreeItem {
    constructor(entry: WrongEntry, frontendQuestionId: string) {
        const idPrefix = frontendQuestionId ? `[${frontendQuestionId}] ` : '';
        super(`❌ ${idPrefix}${entry.title}`, vscode.TreeItemCollapsibleState.None);
        const ts = formatFailedAt(entry.failedAt);
        const due = formatFailedAt(nextReviewAt(entry));
        const dueText = isReviewDue(entry) ? `已到期复习（下次 ${due}）` : `复习排期：${due}`;
        const failMsg = `失败 ${failureCountOf(entry)} 次`;
        this.description = `${failMsg} · ${ts} · ${entry.reason}`;
        this.tooltip = `${entry.titleSlug}\n${failMsg}，${dueText}\n失败时间：${ts} · ${entry.reason}\n点击重新打开题目`;
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
        public readonly solvedCount: number
    ) {
        super(category, vscode.TreeItemCollapsibleState.Collapsed);

        this.tooltip = `${category} - 共 ${questionCount} 题，已解决 ${solvedCount}`;
        this.description = `已解 ${solvedCount} / ${questionCount}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'category';
    }
}

/**
 * 难度分组节点（简单/中等/困难），展开后组内按题号升序
 */
export class DifficultyItem extends vscode.TreeItem {
    constructor(
        public readonly level: DifficultyLevel,
        public readonly questionCount: number,
        public readonly solvedCount: number
    ) {
        super(DIFFICULTY_LABELS[level], vscode.TreeItemCollapsibleState.Collapsed);

        this.tooltip = `${DIFFICULTY_LABELS[level]} - 共 ${questionCount} 题，已解决 ${solvedCount}`;
        this.description = `已解 ${solvedCount} / ${questionCount}`;
        this.iconPath = difficultyIcon(level);
        this.contextValue = 'difficulty';
    }
}

/**
 * 刷题统计分组节点（展开显示总进度/难度/分类分布、连续打卡、今日目标）
 */
export class StatsItem extends vscode.TreeItem {
    constructor() {
        super('📈 刷题统计', vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = '总进度、难度/分类分布、连续打卡天数与每日目标';
        this.iconPath = new vscode.ThemeIcon('graph-line');
        this.contextValue = 'stats';
    }
}

/**
 * 刷题统计子行（只读展示；contextValue 为 statsGoal 的行可点击设置每日目标）
 */
export class StatsRowItem extends vscode.TreeItem {
    constructor(
        label: string,
        icon: vscode.ThemeIcon,
        description?: string,
        contextValue: string = 'statsRow'
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = icon;
        // 内容已全部行内可见，关闭默认"悬浮=标签文本"提示
        this.tooltip = '';
        if (description !== undefined) {
            this.description = description;
        }
        this.contextValue = contextValue;
        if (contextValue === 'statsGoal') {
            this.command = { command: 'leetcode.setDailyGoal', title: '设置每日目标' };
        }
    }
}

/**
 * 每日一题入口节点（按日期从 Hot 100 中随机抽取，每天固定一题）
 */
export class DailyItem extends vscode.TreeItem {
    constructor(question?: Hot100Question) {
        super(
            question
                ? `📅 今日每日一题：${question.frontendQuestionId}. ${question.titleCn}`
                : '📅 今日每日一题',
            vscode.TreeItemCollapsibleState.None
        );
        const diffZh = question ? (isDifficultyLevel(question.difficulty) ? DIFFICULTY_ZH[question.difficulty] : '') : '';
        this.tooltip = question
            ? `${question.titleEn}（${diffZh}）\n从 Hot 100 中按日期随机抽取，每天固定一题（Ctrl+Alt+D）`
            : '从 Hot 100 中按日期随机抽取，每天固定一题（Ctrl+Alt+D）';
        this.iconPath = new vscode.ThemeIcon('calendar');
        this.command = { command: 'leetcode.dailyQuestion', title: '每日一题' };
        this.contextValue = 'daily';
    }
}

/**
 * 我的收藏分组节点（本地收藏，右键题目行切换；子项按当前分组顺序排列）
 */
export class FavoriteItem extends vscode.TreeItem {
    constructor(count: number) {
        super(`⭐ 我的收藏（${count}）`, vscode.TreeItemCollapsibleState.Collapsed);
        this.tooltip = '本地收藏的题目（右键题目行可收藏/取消收藏），按当前分组顺序排列';
        this.iconPath = new vscode.ThemeIcon('star');
        this.contextValue = 'favorite';
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
        difficulty: string = '',
        labelTag?: string,  // 题号标签文本：难度模式下传所属分类（如「哈希」），缺省显示难度
        meta: QuestionMeta & { isFavorite?: boolean } = { paidOnly: false }
    ) {
        // 列表接口返回大写难度枚举（EASY/MEDIUM/HARD），与详情接口区分大小写不同
        const difficultyZh = isDifficultyLevel(difficulty) ? DIFFICULTY_ZH[difficulty] : '';
        // 难度与题号一起放在中括号里，如 [1 · 简单]；标签缺省时显式传空串表示不显示
        const tag = labelTag !== undefined ? labelTag : difficultyZh;
        const marks = `${meta.paidOnly ? '🔒' : ''}${meta.isFavorite ? '⭐' : ''}`;
        const label = `${marks}[${hot100Question.frontendQuestionId}${tag ? ' · ' + tag : ''}] ${hot100Question.titleCn}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        // 构建Question对象
        this.question = {
            frontendQuestionId: hot100Question.frontendQuestionId,
            title: hot100Question.titleCn,
            titleSlug: hot100Question.titleSlug,
            difficulty: difficulty,
            status: status
        };

        const acRateText = formatAcRate(meta.acRate);
        // 难度/通过率/会员/收藏均已行内可见（标签标记 + 描述列），不再重复悬浮窗；
        // 空串显式关闭 VS Code 默认的"悬浮=标签文本"提示
        this.tooltip = '';
        this.description = `${hot100Question.titleEn}${acRateText ? ` · ${acRateText}` : ''}`;

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