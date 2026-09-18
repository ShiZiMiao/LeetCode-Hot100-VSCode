/**
 * 相似题目解析纯逻辑（无 vscode 依赖，src/unit 单测覆盖）
 * 题面接口的 similarQuestions 为 JSON 字符串（条目含 titleSlug/title/translatedTitle/difficulty/isPaidOnly，
 * 无 frontendQuestionId，打开用 slug）
 */

export interface SimilarQuestion {
    titleSlug: string;
    title: string;
    translatedTitle: string;
    /** 详情接口大小写枚举：Easy/Medium/Hard */
    difficulty: string;
    paidOnly: boolean;
}

export function parseSimilarQuestions(raw: unknown): SimilarQuestion[] {
    let arr: any = raw;
    if (typeof raw === 'string') {
        try {
            arr = JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }
    if (!Array.isArray(arr)) {
        return [];
    }
    return arr
        .filter((q: any) => q && typeof q.titleSlug === 'string' && q.titleSlug.length > 0)
        .map((q: any) => ({
            titleSlug: q.titleSlug,
            title: q.title || '',
            translatedTitle: q.translatedTitle || '',
            difficulty: q.difficulty || '',
            paidOnly: q.isPaidOnly === true
        }));
}

/** 详情接口难度（Easy/Medium/Hard）→ 中文短标签；未知值原样返回 */
export function difficultyZhOf(value: string): string {
    const v = value.toLowerCase();
    return v === 'easy' ? '简单' : v === 'medium' ? '中等' : v === 'hard' ? '困难' : value;
}