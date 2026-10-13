/**
 * 登录输入的 Cookie 组装纯逻辑（无 vscode 依赖，可直接单测）。
 * 允许用户只粘贴 LEETCODE_SESSION 与 csrftoken 两个值，也允许把
 * 浏览器里整段 Cookie（或其中一部分）粘到任一输入框，自动拆分。
 */

/**
 * 由登录表单的两个输入组装接口所需 Cookie 串。
 * 任一输入中含 `LEETCODE_SESSION=`/`csrftoken=` 的 KEY=VALUE 形式时优先从中提取
 * （整段 Cookie 粘贴场景）；否则按裸值拼接。两个键凑不齐时返回 null（调用方提示用户）。
 */
export function buildLeetCodeCookie(sessionRaw: string, csrfRaw: string): string | null {
    const s = (sessionRaw || '').trim();
    const c = (csrfRaw || '').trim();
    // 整段 Cookie 粘贴：从两个输入合并后的文本里按键名提取
    const combined = s + '; ' + c;
    const mSession = combined.match(/(?:^|[;\s])LEETCODE_SESSION=([^;\s]+)/);
    const mCsrf = combined.match(/(?:^|[;\s])csrftoken=([^;\s]+)/);
    if (mSession && mCsrf) {
        return `LEETCODE_SESSION=${mSession[1]}; csrftoken=${mCsrf[1]}`;
    }
    // 混合形态（一侧 KEY=VALUE、另一侧裸值）：剥掉输入里已有的键前缀再拼接，
    // 否则会产出 LEETCODE_SESSION=LEETCODE_SESSION=... 的双前缀坏 Cookie
    const stripKey = (raw: string, key: string): string => {
        const keyed = raw.match(new RegExp('(?:^|[;\\s])' + key + '=([^;\\s]+)', 'i'));
        if (keyed) {
            return keyed[1];
        }
        const bare = raw.match(/^[^;\s]+/);
        return bare ? bare[0] : '';
    };
    const bareSession = stripKey(s, 'LEETCODE_SESSION');
    const bareCsrf = stripKey(c, 'csrftoken');
    if (bareSession && bareCsrf) {
        return `LEETCODE_SESSION=${bareSession}; csrftoken=${bareCsrf}`;
    }
    return null;
}
