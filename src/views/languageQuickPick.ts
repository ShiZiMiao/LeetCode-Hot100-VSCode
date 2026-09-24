/**
 * 语言选择 QuickPick（UI 交互层；语言表与 slug 归一化在 utils/languageUtils 纯逻辑模块）
 */
import * as vscode from 'vscode';
import { getLanguageInfo, normalizeLangSlug } from '../utils/languageUtils';

/**
 * 让用户选择编程语言
 * @param availableSnippets 题目支持的代码片段列表
 * @returns 选择的语言片段，如果取消则返回 undefined
 */
export async function selectLanguage(availableSnippets: { lang: string; langSlug: string; code: string }[]): Promise<{ langSlug: string; code: string } | undefined> {
    // 构建可选语言列表（只显示题目支持的语言；slug 经归一化识别 golang 等别名）
    const items: vscode.QuickPickItem[] = [];
    const snippetMap = new Map<string, { langSlug: string; code: string }>();

    for (const snippet of availableSnippets) {
        const canonical = normalizeLangSlug(snippet.langSlug);
        const langInfo = getLanguageInfo(canonical);
        if (langInfo && !snippetMap.has(canonical)) {
            items.push({
                label: langInfo.displayName,
                description: `.${langInfo.extension}`,
                detail: canonical
            });
            snippetMap.set(canonical, { langSlug: snippet.langSlug, code: snippet.code });
        }
    }

    // 按常用语言排序（Python, Java, C++ 优先；Python2 的 python slug 已移除）
    const priorityOrder = ['python3', 'java', 'cpp', 'javascript', 'typescript', 'go', 'c'];
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
