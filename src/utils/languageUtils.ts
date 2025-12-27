/**
 * 语言工具函数
 * 提供语言slug到文件扩展名的映射和语言选择功能
 */

import * as vscode from 'vscode';

// 支持的编程语言列表
export interface LanguageInfo {
    slug: string;           // LeetCode使用的语言标识
    displayName: string;    // 显示名称
    extension: string;      // 文件扩展名
}

// LeetCode支持的语言列表
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
    { slug: 'python3', displayName: 'Python 3', extension: 'py' },
    { slug: 'python', displayName: 'Python', extension: 'py' },
    { slug: 'java', displayName: 'Java', extension: 'java' },
    { slug: 'cpp', displayName: 'C++', extension: 'cpp' },
    { slug: 'c', displayName: 'C', extension: 'c' },
    { slug: 'csharp', displayName: 'C#', extension: 'cs' },
    { slug: 'javascript', displayName: 'JavaScript', extension: 'js' },
    { slug: 'typescript', displayName: 'TypeScript', extension: 'ts' },
    { slug: 'go', displayName: 'Go', extension: 'go' },
    { slug: 'rust', displayName: 'Rust', extension: 'rs' },
    { slug: 'kotlin', displayName: 'Kotlin', extension: 'kt' },
    { slug: 'swift', displayName: 'Swift', extension: 'swift' },
    { slug: 'ruby', displayName: 'Ruby', extension: 'rb' },
    { slug: 'scala', displayName: 'Scala', extension: 'scala' },
    { slug: 'php', displayName: 'PHP', extension: 'php' },
];

// slug到语言信息的映射
const slugToLanguage: Map<string, LanguageInfo> = new Map(
    SUPPORTED_LANGUAGES.map(lang => [lang.slug, lang])
);

/**
 * 根据语言slug获取文件扩展名
 */
export function getExtension(langSlug: string): string {
    return slugToLanguage.get(langSlug)?.extension || 'txt';
}

/**
 * 根据语言slug获取语言信息
 */
export function getLanguageInfo(langSlug: string): LanguageInfo | undefined {
    return slugToLanguage.get(langSlug);
}

/**
 * 让用户选择编程语言
 * @param availableSnippets 题目支持的代码片段列表
 * @returns 选择的语言slug，如果取消则返回undefined
 */
export async function selectLanguage(availableSnippets: { lang: string; langSlug: string; code: string }[]): Promise<{ langSlug: string; code: string } | undefined> {
    // 构建可选语言列表（只显示题目支持的语言）
    const items: vscode.QuickPickItem[] = [];
    const snippetMap = new Map<string, { langSlug: string; code: string }>();

    for (const snippet of availableSnippets) {
        const langInfo = slugToLanguage.get(snippet.langSlug);
        if (langInfo) {
            items.push({
                label: langInfo.displayName,
                description: `.${langInfo.extension}`,
                detail: snippet.langSlug
            });
            snippetMap.set(snippet.langSlug, { langSlug: snippet.langSlug, code: snippet.code });
        }
    }

    // 按常用语言排序（Python, Java, C++ 优先）
    const priorityOrder = ['python3', 'python', 'java', 'cpp', 'javascript', 'typescript', 'go', 'c'];
    items.sort((a, b) => {
        const aIndex = priorityOrder.indexOf(a.detail || '');
        const bIndex = priorityOrder.indexOf(b.detail || '');
        if (aIndex === -1 && bIndex === -1) {
            return 0;
        }
        if (aIndex === -1) {
            return 1;
        }
        if (bIndex === -1) {
            return -1;
        }
        return aIndex - bIndex;
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: '选择编程语言',
        title: '请选择编程语言'
    });

    if (selected && selected.detail) {
        return snippetMap.get(selected.detail);
    }

    return undefined;
}

/**
 * 获取代码文件的保存路径
 * @param workspaceFolder 工作区文件夹
 * @param questionId 题目ID
 * @param titleSlug 题目slug
 * @param langSlug 语言slug
 */
export function getCodeFilePath(
    workspaceFolder: string,
    questionId: string,
    titleSlug: string,
    langSlug: string
): string {
    const ext = getExtension(langSlug);
    // 文件名格式：题号_题目slug.扩展名
    const fileName = `${questionId}_${titleSlug}.${ext}`;
    return `${workspaceFolder}/leetcode/${fileName}`;
}
