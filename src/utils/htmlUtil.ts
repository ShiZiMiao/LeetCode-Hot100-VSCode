/**
 * 共用 HTML/文本工具（无 vscode 依赖，纯函数）
 */

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function formatArticleDate(ts: number): string {
	const d = new Date(ts * 1000);
	return isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN');
}

export function errMsg(error: unknown): string {
	if (error instanceof Error) { return error.message; }
	if (typeof error === 'string') { return error; }
	try { return JSON.stringify(error); } catch { return String(error); }
}
