/**
 * 语言工具（纯逻辑，无 vscode 依赖，可直接单测）
 * 语言 slug 归一化（leetcode.cn 真实 slug 与内部规范 slug 的别名收口）、文件扩展名映射。
 * QuickPick 交互在 views/languageQuickPick.ts，保持本模块零 vscode 依赖。
 */

/** 内部规范语言条目 */
interface LanguageInfo {
    slug: string;           // 内部规范语言标识
    displayName: string;    // 显示名称
    extension: string;      // 文件扩展名
}

// 支持的编程语言列表
// 注意只有 python3 一个 Python 条目：leetcode.cn 的 'python' slug 是 Python 2 判题环境，
// 与 Python3 同为 .py 扩展名，在语言选择器里并列极易误选，且注解语法无法通过判题
const SUPPORTED_LANGUAGE_LIST: LanguageInfo[] = [
    { slug: 'python3', displayName: 'Python3', extension: 'py' },
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

/** 对外只读语言表（选择器/保存路径共用） */
export const SUPPORTED_LANGUAGES: ReadonlyArray<Readonly<LanguageInfo>> = SUPPORTED_LANGUAGE_LIST;

/**
 * leetcode.cn 真实 slug → 内部规范 slug 的别名：
 * Go 在 leetcode.cn 是 'golang'（非 'go'），C++ 的 'c++' 写法与 python 别名一并归一，
 * 全仓语言识别/扩展名/选择器统一走 normalizeLangSlug，避免各处自维护别名表
 */
const SLUG_ALIASES: Record<string, string> = {
    golang: 'go',
    'c++': 'cpp',
    'py': 'python3',
};

/** 语言 slug 归一化：trim/小写 + 别名映射；未知 slug 原样小写返回 */
export function normalizeLangSlug(langSlug: string): string {
    const key = String(langSlug || '').trim().toLowerCase();
    return SLUG_ALIASES[key] ?? key;
}

const slugToLanguage: Map<string, LanguageInfo> = new Map(
    SUPPORTED_LANGUAGE_LIST.map(lang => [lang.slug, lang])
);

/** 按归一化 slug 取语言条目；未知返回 undefined */
export function getLanguageInfo(langSlug: string): LanguageInfo | undefined {
    return slugToLanguage.get(normalizeLangSlug(langSlug));
}

/**
 * 根据语言slug获取文件扩展名（未知语言回退 txt，不丢文件）
 */
export function getExtension(langSlug: string): string {
    return getLanguageInfo(langSlug)?.extension || 'txt';
}
