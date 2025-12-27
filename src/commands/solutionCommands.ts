/**
 * 题解相关命令处理
 */

import * as vscode from 'vscode';
import { LeetCodeApi, Question } from '../core/leetcodeApi';

/**
 * 题解面板管理器
 */
export class SolutionPanelManager {
    private static instance: SolutionPanelManager;
    private panel: vscode.WebviewPanel | undefined;
    private leetCodeApi: LeetCodeApi;

    private constructor(leetCodeApi: LeetCodeApi) {
        this.leetCodeApi = leetCodeApi;
    }

    public static getInstance(leetCodeApi: LeetCodeApi): SolutionPanelManager {
        if (!SolutionPanelManager.instance) {
            SolutionPanelManager.instance = new SolutionPanelManager(leetCodeApi);
        }
        return SolutionPanelManager.instance;
    }

    /**
     * 显示题解
     */
    public async showSolution(titleSlug: string): Promise<void> {
        try {
            // 获取官方题解
            const officialData = await this.leetCodeApi.getOfficialSolution(titleSlug);
            const officialSolution = officialData?.data?.question?.solution;

            // 获取社区题解
            const communityData = await this.leetCodeApi.getSolutionArticles(titleSlug, 0, 10);
            const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];

            // 构建题解内容
            let content = '';

            // 官方题解
            if (officialSolution && officialSolution.content && officialSolution.canSeeDetail) {
                content += officialSolution.content;
            } else if (officialSolution && !officialSolution.canSeeDetail) {
                content += '🔒 官方题解为会员专享内容\n\n';
            }

            // 如果没有官方题解，显示社区题解列表
            if (!content && communityArticles.length > 0) {
                content = '## 💡 社区热门题解\n\n';
                communityArticles.forEach((edge: any) => {
                    const article = edge.node;
                    const author = article.author?.profile?.realName || article.author?.username || '匿名';
                    content += `### ${article.title}\n`;
                    content += `👍 ${article.upvoteCount} | 作者: ${author}\n\n`;
                });
            }

            if (!content) {
                content = '暂无题解';
            }

            return;
        } catch (error) {
            vscode.window.showErrorMessage(`加载题解失败: ${error}`);
        }
    }

    /**
     * 获取社区题解详情
     */
    public async getArticleDetail(slug: string): Promise<any> {
        try {
            const articleData = await this.leetCodeApi.getSolutionArticle(slug);
            return articleData?.data?.solutionArticle;
        } catch (error) {
            vscode.window.showErrorMessage(`加载题解详情失败: ${error}`);
            return null;
        }
    }
}
