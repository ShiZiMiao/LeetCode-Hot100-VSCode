/**
 * Hot 100 题目列表 Provider
 * 实现按分类的树形结构显示
 */

import * as vscode from 'vscode';
import { LeetCodeApi, Question } from '../core/leetcodeApi';
import { HOT_100_LIST, CATEGORIES, Hot100Question, HOT_100_IDS, ID_TO_SLUG } from '../data/hot100Data';

// 树形节点类型
type TreeNode = CategoryItem | QuestionItem;

/**
 * Hot 100 Provider - 实现分类树形结构
 */
export class Hot100Provider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private leetCodeApi: LeetCodeApi;
    // 存储题目状态信息（从API获取）
    private questionStatusMap: Map<string, string | null> = new Map();
    private isLoaded: boolean = false;

    constructor(leetCodeApi: LeetCodeApi) {
        this.leetCodeApi = leetCodeApi;
    }

    refresh(): void {
        this.isLoaded = false;
        this.questionStatusMap.clear();
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

        // 顶层：显示分类
        if (!element) {
            return CATEGORIES.map((category, index) => {
                const questions = HOT_100_LIST.filter(q => q.category === category);
                return new CategoryItem(category, questions.length, index);
            });
        }

        // 分类下面：显示该分类的题目
        if (element instanceof CategoryItem) {
            const categoryQuestions = HOT_100_LIST.filter(q => q.category === element.category);
            return categoryQuestions.map(q => {
                const status = this.questionStatusMap.get(q.frontendQuestionId) || null;
                return new QuestionItem(q, status);
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
                    this.questionStatusMap.set(q.frontendQuestionId, q.status);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`加载题目状态失败: ${error}`);
        }
    }
}

/**
 * 分类节点
 */
export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly category: string,
        public readonly questionCount: number,
        public readonly index: number
    ) {
        super(category, vscode.TreeItemCollapsibleState.Collapsed);

        this.tooltip = `${category} - 共 ${questionCount} 题`;
        this.description = `(${questionCount})`;
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
        status: string | null
    ) {
        // 使用中文标题显示
        const label = `[${hot100Question.frontendQuestionId}] ${hot100Question.titleCn}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        // 构建Question对象
        this.question = {
            frontendQuestionId: hot100Question.frontendQuestionId,
            title: hot100Question.titleCn,
            titleSlug: hot100Question.titleSlug,
            difficulty: '', // 从API获取时会更新
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
