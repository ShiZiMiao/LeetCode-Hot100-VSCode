/**
 * LeetCode Hot 100 刷题助手
 * VS Code 扩展入口文件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createHash } from 'crypto';
import { AuthManager } from './core/authManager';
import { LeetCodeApi, Question } from './core/leetcodeApi';
import { Hot100Provider } from './views/hot100Provider';
import { selectLanguage, getExtension } from './utils/languageUtils';
import { generateDebugFile } from './utils/debugUtils';

/**
 * 清理题解 Markdown 内容中的 <iframe> 代码游玩区。
 *
 * LeetCode 官方题解内容包含指向 https://leetcode.cn/playground/... 的跨域 iframe。
 * 在 VS Code 的 webview 中，这类跨域 iframe 无法携带用户会话 Cookie，会被
 * LeetCode 重定向成登录页，导致题解显示异常。此函数将其整块移除，
 * 同时保留题解中的文字、公式与代码块。题目自身的代码骨架由
 * codeSnippets 以代码块形式单独展示。
 */
function sanitizeSolutionContent(content: string): string {
	if (!content) {
		return content;
	}
	return content.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
}

/** HTML 转义，防止代码注入 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * 把 HTML 中的 http(s) 图片下载到本地缓存，并替换为 webview 可访问的 asWebviewUri，
 * 避免 webview 加载外部图片失败（如 assets.leetcode.com 等域名）。
 */
async function localizeContentImages(html: string, panel: vscode.WebviewPanel, context: vscode.ExtensionContext, api: LeetCodeApi): Promise<string> {
	const srcs = [...new Set([...html.matchAll(/src="(https?:\/\/[^"]+)"/gi)].map(m => m[1]))];
	if (srcs.length === 0) {
		return html;
	}
	const dirUri = vscode.Uri.joinPath(context.globalStorageUri, 'img');
	await vscode.workspace.fs.createDirectory(dirUri);
	let out = html;
	for (const src of srcs) {
		try {
			const extMatch = src.match(/\.(png|jpe?g|gif|webp|svg)(\?|$)/i);
			const ext = extMatch ? '.' + extMatch[1].toLowerCase() : '.png';
			const hash = createHash('sha1').update(src).digest('hex').slice(0, 16);
			const fileUri = vscode.Uri.joinPath(dirUri, hash + ext);
			let stat: vscode.FileStat | null = null;
			try {
				stat = await vscode.workspace.fs.stat(fileUri);
			} catch (e) {
				stat = null;
			}
			if (!stat || stat.size === 0) {
				const buf = await api.downloadBinaryRaw(src);
				if (!buf || buf.length === 0) {
					continue;
				}
				await vscode.workspace.fs.writeFile(fileUri, new Uint8Array(buf));
			}
			const localUri = panel.webview.asWebviewUri(fileUri).toString();
			out = out.split(src).join(localUri);
		} catch (e) {
			// 单张图失败保留原地址，不阻断其余内容
		}
	}
	return out;
}

/**
 * 把题解内容中少量内联 HTML 还原为 Markdown 文本，避免静态渲染时残留原始标签。
 * 只处理安全的常用标签；iframe 等占位区域由调用方在渲染前移除。
 */
function htmlToMarkdown(content: string): string {
	let s = content;
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(/<\/p>\s*/gi, '\n\n');
	s = s.replace(/<p[^>]*>/gi, '');
	s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)');
	s = s.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)');
	s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
	s = s.replace(/<\/h([1-6])>/gi, '\n\n');
	s = s.replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n\n' + '#'.repeat(Number(n)) + ' ');
	s = s.replace(/<(\/?)strong[^>]*>/gi, '**');
	s = s.replace(/<(\/?)b[^>]*>/gi, '**');
	s = s.replace(/<(\/?)em[^>]*>/gi, '*');
	s = s.replace(/<(\/?)i[^>]*>/gi, '*');
	s = s.replace(/<(\/?)code[^>]*>/gi, '`');
	s = s.replace(/<(\/?)del[^>]*>/gi, '~~');
	s = s.replace(/<li[^>]*>/gi, '\n- ');
	s = s.replace(/<\/li>/gi, '');
	s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n\n');
	s = s.replace(/<\/?blockquote[^>]*>/gi, '\n> ');
	s = s.replace(/<\/?(span|div)[^>]*>/gi, '');
	s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ''); // 兜底：移除其余未知标签
	s = s.replace(/<!(\[)/g, '$1'); // 部分文章正文带 <![img](...) 包裹，还原为 ![img](...)
	return s;
}

interface MarkdownCodeBlock {
	lang: string;
	code: string;
}

/** 代码语言优先级：Python3/Python > C/C++ > 其他（官方题解每组只展示一种语言时使用） */
function codeLangPriority(lang: string): number {
	const l = lang.toLowerCase().replace(/\s+/g, '');
	if (l === 'python3' || l === 'python') {
		return 0;
	}
	if (l === 'c' || l === 'c++' || l === 'cpp') {
		return 1;
	}
	return 2;
}

/** 语言名显示规范化：py → Python、cpp → C++、golang → Go 等（标签页与代码块标注用） */
function displayLangName(lang: string): string {
	const map: Record<string, string> = {
		'py': 'Python', 'python': 'Python', 'python3': 'Python3',
		'java': 'Java', 'cpp': 'C++', 'c++': 'C++', 'c': 'C',
		'go': 'Go', 'golang': 'Go', 'js': 'JavaScript', 'javascript': 'JavaScript',
		'rust': 'Rust', 'ts': 'TypeScript', 'typescript': 'TypeScript'
	};
	return map[lang.toLowerCase()] || lang;
}

/**
 * 行内 Markdown 渲染（图片/视频/链接/行内代码/粗体/斜体/删除线），文本先做 HTML 转义。
 * videoPageUrl 存在时，视频题解（![xxx.mp4](资产id)）渲染为可点击播放入口——
 * 视频在 LeetCode 内部 CDN 上且带防盗链，webview 无法直接内嵌播放。
 */
function renderInlineMarkdown(text: string, videoPageUrl?: string): string {
	let s = escapeHtml(text);
	s = s.replace(/!\[([^\]]*\.(?:mp4|webm))\]\(([^)\s]+)\)/gi, (m, alt, url) => {
		if (videoPageUrl) {
			// 视频题解：uuid 为阿里云 VOD 视频标识，点击后由扩展端查询 playAuth 播放凭证，
			// 再用 Aliplayer 内嵌播放；失败时降级为浏览器播放入口
			const uuid = url.replace(/\.(mp4|webm)$/i, '');
			return `<button class="video-link" data-play-uuid="${uuid}" data-page-url="${videoPageUrl}" onclick="playArticleVideo(this)">🎬 播放视频题解</button>`;
		}
		return `<span class="img-placeholder">[视频：${alt}]</span>`;
	});
	s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
		if (/^https?:\/\//i.test(url)) {
			return `<img src="${url}" alt="${alt}" />`;
		}
		return `<span class="img-placeholder">[图片：${alt || 'media'}]</span>`;
	});
	s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
		if (/^https?:\/\//i.test(url)) {
			return `<a href="${url}">${text}</a>`;
		}
		return `${text}（${url}）`;
	});
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
	s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
	s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
	return s;
}

function renderCodeBlockHtml(block: MarkdownCodeBlock): string {
	const cls = block.lang ? `language-${escapeHtml(block.lang)}` : '';
	const themeClass = isDarkEditorTheme() ? 'hljs-dark' : '';
	// 高亮在扩展端完成：HTML 直接带 hljs 高亮标签，代码显示不依赖网络与 webview 脚本
	let inner = escapeHtml(block.code);
	const lang = highlightLangName(block.lang);
	if (hljsRuntime && lang && hljsRuntime.getLanguage(lang)) {
		try {
			inner = hljsRuntime.highlight(block.code, { language: lang }).value;
		} catch (e) {
			// 单个代码块高亮失败时回退为纯文本，不影响显示
		}
	}
	// lc-pre 类名避免与旧规则 .code-block/.code-tabs 冲突；行为复制带标签页组时复制当前语言
	return `<pre class="lc-pre"><button class="lc-copy" title="复制代码" onclick="copyCode(this)">⧉</button><code class="${cls}${themeClass ? ' ' + themeClass : ''}">${inner}</code></pre>`;
}

/** 官方题解标签页语言优先级：Python → C/C++ → Java → 其他（同优先级保持原文顺序） */
function codeTabOrder(lang: string): number {
	const l = lang.toLowerCase().replace(/\s+/g, '');
	if (l === 'python3' || l === 'python' || l === 'py') {
		return 0;
	}
	if (l === 'c' || l === 'c++' || l === 'cpp') {
		return 1;
	}
	if (l === 'java') {
		return 2;
	}
	return 3;
}

/**
 * 多语言代码块 → 语言标签页（保留全部语言，点击切换，类似网页版题解）。
 * preferredFirst 为 true 时按 Python → C/C++ → Java → 其他 的顺序排列（用于官方题解）。
 */
function renderCodeTabsHtml(blocks: MarkdownCodeBlock[], preferredFirst: boolean = false): string {
	let ordered = blocks;
	if (preferredFirst && blocks.length > 1) {
		// sort 稳定：同一优先级内保持原文顺序
		ordered = blocks.slice().sort((a, b) => codeTabOrder(a.lang) - codeTabOrder(b.lang));
	}
	const tabs = ordered.map((b, idx) => `<button class="lang-tab${idx === 0 ? ' active' : ''}" onclick="selectLangTab(this)">${escapeHtml(displayLangName(b.lang))}</button>`).join('');
	const contents = ordered.map((b, idx) => `<div class="lang-code-block${idx === 0 ? ' active' : ''}">${renderCodeBlockHtml(b)}</div>`).join('');
	return `<div class="code-tabs-container"><div class="lang-tabs">${tabs}</div>${contents}</div>`;
}

/** 相邻代码块组中，按优先级挑一种语言（Python3/Python → C/C++ → 其他首个） */
function pickPreferredCodeBlock(blocks: MarkdownCodeBlock[]): MarkdownCodeBlock | null {
	if (blocks.length === 0) {
		return null;
	}
	for (const priority of [0, 1]) {
		const picked = blocks.find(b => codeLangPriority(b.lang) === priority);
		if (picked) {
			return picked;
		}
	}
	return blocks[0];
}

/**
 * 轻量级 Markdown → HTML 渲染器（扩展端静态渲染，不依赖 webview 的 CDN marked）。
 * 支持标题、段落、行内格式、图片/链接、列表、引用、分隔线、表格与围栏代码块。
 * codeMode:
 *   - 'preferred'：相邻的多语言代码块只保留一种（Python3/Python → C/C++ → 其他首个）；
 *   - 'all'：保留全部代码块并按语言生成标签页（preferredFirst 时优先语言排首位并默认选中，
 *     用于官方题解，接近网页版的多语言切换体验；社区题解保持原文顺序）。
 */
function renderMarkdownToHtml(md: string, codeMode: 'preferred' | 'all' = 'preferred', preferredFirst: boolean = false, videoPageUrl?: string): string {
	if (!md) {
		return '';
	}
	// 社区题解正文使用 \r\n 行尾，先归一化，否则围栏/标题等匹配不到
	const lines = htmlToMarkdown(md.replace(/\r\n?/g, '\n')).split('\n');
	const out: string[] = [];
	// 围栏行：```lang [label] 或 ``` 均命中；语言从 ``` 后的内容提取，去掉 [label]
	const fenceLineRe = /^\s*```\s*(.*)$/;
	const fenceCloseRe = /^\s*```\s*$/;
	let i = 0;

	const isTableSeparator = (line: string) => /^\|[\s:|-]+\|$/.test(line.trim());
	const splitTableRow = (line: string) => line.trim().slice(1, -1).split('|').map(c => c.trim());

	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		const fenceMatch = line.match(fenceLineRe);

		if (fenceMatch) {
			// 收集相邻代码块（只允许空行分隔），组成一个"解法代码组"
			const blocks: MarkdownCodeBlock[] = [];
			let groupDone = false;
			while (!groupDone && i < lines.length) {
				const fm = lines[i].match(fenceLineRe);
				if (!fm) {
					break;
				}
				const lang = fm[1].trim().replace(/\s*\[.*\]$/, '');
				i++;
				const code: string[] = [];
				while (i < lines.length && !fenceCloseRe.test(lines[i])) {
					code.push(lines[i]);
					i++;
				}
				if (i < lines.length) {
					i++; // 跳过结束围栏
				}
				blocks.push({ lang, code: code.join('\n') });
				// 后面只隔空行且还有带语言的围栏，则视为相邻块，继续收集
				let j = i;
				while (j < lines.length && lines[j].trim() === '') {
					j++;
				}
				if (j < lines.length && /^\s*```\s*\S/.test(lines[j])) {
					i = j;
				} else {
					groupDone = true;
				}
			}
			if (codeMode === 'preferred') {
				const picked = pickPreferredCodeBlock(blocks);
				if (picked) {
					out.push(renderCodeBlockHtml(picked));
				}
			} else {
				out.push(blocks.length > 1 ? renderCodeTabsHtml(blocks, preferredFirst) : renderCodeBlockHtml(blocks[0]));
			}
			continue;
		}

		if (trimmed === '' || trimmed === '[TOC]') {
			i++;
		} else if (/^#{1,6}\s+/.test(trimmed)) {
			const level = trimmed.match(/^#+/)![0].length;
			// 方法/章节标题（h2~h4）前补分隔线，避免多个解法连成一片
			if (level <= 4 && out.length > 0) {
				out.push('<hr>');
			}
			out.push(`<h${level}>${renderInlineMarkdown(trimmed.replace(/^#+\s*/, ''), videoPageUrl)}</h${level}>`);
			i++;
		} else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
			out.push('<hr>');
			i++;
		} else if (/^>\s?/.test(trimmed)) {
			const quote: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
				quote.push(lines[i].trim().replace(/^>\s?/, ''));
				i++;
			}
			out.push(`<blockquote>${renderInlineMarkdown(quote.join(' '), videoPageUrl)}</blockquote>`);
		} else if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
			const header = splitTableRow(trimmed);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
				rows.push(splitTableRow(lines[i]));
				i++;
			}
			const thead = header.map(c => `<th>${renderInlineMarkdown(c, videoPageUrl)}</th>`).join('');
			const tbody = rows.map(r => `<tr>${r.map(c => `<td>${renderInlineMarkdown(c, videoPageUrl)}</td>`).join('')}</tr>`).join('');
			out.push(`<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`);
		} else {
			const listMatch = trimmed.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
			if (listMatch) {
				const items: { indent: number; ordered: boolean; text: string }[] = [];
				while (i < lines.length) {
					const lm = lines[i].trim().match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
					if (!lm) {
						break;
					}
					items.push({ indent: lm[1].length, ordered: /^\d+\./.test(lm[2]), text: lm[3] });
					i++;
				}
				let listHtml = '';
				const stack: { tag: string; indent: number }[] = [];
				for (const item of items) {
					const tag = item.ordered ? 'ol' : 'ul';
					while (stack.length > 0 && item.indent <= stack[stack.length - 1].indent) {
						listHtml += `</${stack.pop()!.tag}>`;
					}
					if (stack.length === 0 || stack[stack.length - 1].tag !== tag) {
						listHtml += `<${tag}>`;
						stack.push({ tag, indent: item.indent });
					}
					listHtml += `<li>${renderInlineMarkdown(item.text, videoPageUrl)}</li>`;
				}
				while (stack.length > 0) {
					listHtml += `</${stack.pop()!.tag}>`;
				}
				out.push(listHtml);
			} else {
				// 段落：连续非空、非块级起点行合并为一段
				const para: string[] = [trimmed];
				i++;
				while (i < lines.length) {
					const t = lines[i].trim();
					if (t === '' || /^#{1,6}\s+/.test(t) || /^>\s?/.test(t) || /^\s*```/.test(t) || /^(\s*)([-*+]|\d+\.)\s+/.test(t) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(t)) {
						break;
					}
					para.push(t);
					i++;
				}
				out.push(`<p>${renderInlineMarkdown(para.join(' '), videoPageUrl)}</p>`);
			}
		}
	}
	return out.join('\n');
}

// 状态栏项
let statusBarItem: vscode.StatusBarItem;

// highlight.js 本地资源（vendor/ 随扩展打包，.vscodeignore 未排除），
// 在扩展端执行并直接产出高亮 HTML，webview 无需再运行任何高亮脚本
let highlightJsContent: string | null = null;
let hljsRuntime: any = null;

function getHighlightJs(context: vscode.ExtensionContext): string | null {
	if (highlightJsContent !== null) {
		return highlightJsContent;
	}
	try {
		highlightJsContent = fs.readFileSync(path.join(context.extensionPath, 'vendor', 'highlight.min.js'), 'utf8');
		return highlightJsContent;
	} catch (e) {
		return null;
	}
}

/** 在扩展端执行 vendored highlight.js（函数包裹避免 var 泄漏到全局），失败返回 null */
function loadHljsRuntime(context: vscode.ExtensionContext): any {
	try {
		const js = getHighlightJs(context);
		if (!js) {
			return null;
		}
		return vm.runInThisContext(`(function () {${js}\n;return hljs;})()`, { filename: 'vendor/highlight.min.js' });
	} catch (e) {
		return null;
	}
}

/** 语言标识 → highlight.js 语言名（py → python、cpp → cpp 等） */
const HLJS_LANG_MAP: Record<string, string> = {
	python3: 'python', python: 'python', py: 'python',
	golang: 'go', go: 'go', 'c++': 'cpp', cpp: 'cpp', c: 'c',
	java: 'java', javascript: 'javascript', js: 'javascript',
	rust: 'rust', typescript: 'typescript', ts: 'typescript'
};

function highlightLangName(lang: string): string | null {
	return HLJS_LANG_MAP[lang.toLowerCase()] || null;
}

/** 按 VSCode 当前主题决定代码配色（渲染时静态写入 HTML，webview 不再切换） */
function isDarkEditorTheme(): boolean {
	try {
		return vscode.window.activeColorTheme?.kind !== vscode.ColorThemeKind.Light;
	} catch (e) {
		return true;
	}
}

// ffmpeg.wasm 核心（扩展端运行，TS→MP4 纯 remux；webview 只做原生播放）
let ffmpegCorePromise: Promise<any> | null = null;

function getFfmpegCore(context: vscode.ExtensionContext): Promise<any> {
	if (!ffmpegCorePromise) {
		const corePath = path.join(context.extensionPath, 'vendor', 'ffmpeg', 'ffmpeg-core.js');
		ffmpegCorePromise = (async () => {
			// Node >= 22.12 支持 require(ESM)，失败时退回动态 import
			let factory: any = null;
			try {
				const mod = require(corePath);
				factory = mod.default || mod;
			} catch (e) {
				const dynamicImport = new Function('url', 'return import(url)') as (u: string) => Promise<any>;
				const mod = await dynamicImport('file:///' + corePath.replace(/\\/g, '/'));
				factory = mod.default;
			}
			if (typeof factory !== 'function') {
				throw new Error('ffmpeg 核心加载失败');
			}
			// 实例化 emscripten 核心（返回含 FS/exec 的模块）
			return await factory({
				locateFile: (f: string) => path.join(context.extensionPath, 'vendor', 'ffmpeg', f),
				print: () => {},
				printErr: (m: string) => console.error('[ffmpeg]', m)
			});
		})();
	}
	return ffmpegCorePromise;
}

// 视频播放资源（阿里云 Aliplayer + hls.js，本地 vendor，不依赖 CDN）
let playerFiles: { apiJs: string; apiCss: string; hlsJs: string } | null = null;

function getPlayerFiles(context: vscode.ExtensionContext): { apiJs: string; apiCss: string; hlsJs: string } | null {
	if (playerFiles) {
		return playerFiles;
	}
	const base = path.join(context.extensionPath, 'vendor');
	const apiJs = path.join(base, 'aliplayer-min.js');
	const apiCss = path.join(base, 'aliplayer-min.css');
	const hlsJs = path.join(base, 'hls.min.js');
	if (!fs.existsSync(apiJs) || !fs.existsSync(apiCss) || !fs.existsSync(hlsJs)) {
		return null;
	}
	playerFiles = { apiJs, apiCss, hlsJs };
	return playerFiles;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('LeetCode Extension is now active!');

	// 在扩展端加载 vendored highlight.js，题解代码高亮不依赖网络与 webview 脚本
	hljsRuntime = loadHljsRuntime(context);

	const authManager = new AuthManager(context);
	const leetCodeApi = new LeetCodeApi(authManager);
	const hot100Provider = new Hot100Provider(leetCodeApi);

	vscode.window.registerTreeDataProvider('leetcode-hot100', hot100Provider);

	// 创建状态栏项显示登录状态
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'leetcode.login';
	context.subscriptions.push(statusBarItem);
	updateStatusBar(authManager);

	// 监听登录状态变化
	authManager.onDidChangeLoginStatus(() => {
		updateStatusBar(authManager);
		hot100Provider.refresh();
	});

	// ==================== 登录命令 ====================
	const loginDisposable = vscode.commands.registerCommand('leetcode.login', async () => {
		const isLoggedIn = await authManager.isLoggedIn();

		if (isLoggedIn) {
			// 已登录，显示选项
			const choice = await vscode.window.showQuickPick(
				['退出登录', '取消'],
				{ placeHolder: '您已登录，请选择操作' }
			);
			if (choice === '退出登录') {
				await authManager.logout();
				vscode.window.showInformationMessage('已退出登录');
			}
			return;
		}

		// 创建登录说明面板
		const panel = vscode.window.createWebviewPanel(
			'leetcodeLogin',
			'LeetCode 登录',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);

		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="zh-CN">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>LeetCode 登录</title>
				<style>
					body {
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
						padding: 30px;
						max-width: 800px;
						margin: 0 auto;
						line-height: 1.8;
						color: var(--vscode-foreground);
						background-color: var(--vscode-editor-background);
					}
					h1 { color: var(--vscode-textLink-foreground); margin-bottom: 20px; }
					.step {
						background: var(--vscode-textBlockQuote-background);
						padding: 15px 20px;
						border-radius: 8px;
						margin: 15px 0;
						border-left: 4px solid var(--vscode-textLink-foreground);
					}
					.step-number {
						display: inline-block;
						width: 28px;
						height: 28px;
						background: var(--vscode-textLink-foreground);
						color: white;
						border-radius: 50%;
						text-align: center;
						line-height: 28px;
						margin-right: 10px;
						font-weight: bold;
					}
					code {
						background: var(--vscode-textPreformat-background);
						padding: 2px 6px;
						border-radius: 4px;
						font-family: Consolas, monospace;
					}
					button {
						background: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 12px 24px;
						border-radius: 6px;
						cursor: pointer;
						font-size: 14px;
						margin: 10px 10px 10px 0;
					}
					button:hover { background: var(--vscode-button-hoverBackground); }
					input {
						width: 100%;
						padding: 12px;
						margin: 8px 0;
						border: 1px solid var(--vscode-input-border);
						background: var(--vscode-input-background);
						color: var(--vscode-input-foreground);
						border-radius: 6px;
						font-size: 14px;
						box-sizing: border-box;
					}
					label {
						display: block;
						margin-top: 15px;
						font-weight: bold;
					}
					.success { color: #00b8a3; }
					.error { color: #ff375f; }
					.hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
				</style>
			</head>
			<body>
				<h1>🔐 LeetCode 登录</h1>
				
				<div class="step">
					<span class="step-number">1</span>
					<strong>打开 LeetCode 网站并登录</strong>
					<br><br>
					<button onclick="openLeetCode()">打开 LeetCode 网站</button>
				</div>

				<div class="step">
					<span class="step-number">2</span>
					<strong>获取 Cookie 值</strong>
					<br><br>
					登录后，按 <code>F12</code> 打开开发者工具，然后：
					<ol>
						<li>点击顶部的 <code>Application</code>（应用程序）标签</li>
						<li>在左侧栏找到 <code>Storage</code> → <code>Cookies</code> → <code>https://leetcode.cn</code></li>
						<li>在右侧表格中找到下面两个 Cookie，<strong>双击 Value 列复制值</strong></li>
					</ol>
				</div>

				<div class="step">
					<span class="step-number">3</span>
					<strong>粘贴 Cookie 值</strong>
					
					<label for="sessionInput">LEETCODE_SESSION 的值：</label>
					<input type="text" id="sessionInput" placeholder="粘贴 LEETCODE_SESSION 的值（一长串字符）" />
					<div class="hint">这是一个很长的字符串，通常以 eyJ 开头</div>
					
					<label for="csrfInput">csrftoken 的值：</label>
					<input type="text" id="csrfInput" placeholder="粘贴 csrftoken 的值" />
					<div class="hint">这是一个较短的字符串</div>
					
					<br>
					<button onclick="submitCookie()">确认登录</button>
					<div id="message"></div>
				</div>

				<script>
					const vscode = acquireVsCodeApi();
					
					function openLeetCode() {
						vscode.postMessage({ type: 'openBrowser' });
					}
					
					function submitCookie() {
						const session = document.getElementById('sessionInput').value.trim();
						const csrf = document.getElementById('csrfInput').value.trim();
						
						if (!session) {
							document.getElementById('message').innerHTML = '<span class="error">请输入 LEETCODE_SESSION 的值</span>';
							return;
						}
						if (!csrf) {
							document.getElementById('message').innerHTML = '<span class="error">请输入 csrftoken 的值</span>';
							return;
						}
						
						// 自动组装 Cookie 格式
						const cookie = 'LEETCODE_SESSION=' + session + '; csrftoken=' + csrf;
						document.getElementById('message').innerHTML = '<span class="success">正在验证...</span>';
						vscode.postMessage({ type: 'login', cookie: cookie });
					}
				</script>
			</body>
			</html>
		`;

		// 处理Webview消息
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openBrowser') {
				vscode.env.openExternal(vscode.Uri.parse('https://leetcode.cn/accounts/login/'));
			} else if (message.type === 'login') {
				try {
					await authManager.setCookie(message.cookie);
					const profile = await leetCodeApi.getUserProfile();
					// 适配新的 userStatus API 响应
					if (profile && profile.data && profile.data.userStatus && profile.data.userStatus.isSignedIn) {
						const user = profile.data.userStatus;
						vscode.window.showInformationMessage(`登录成功！欢迎 ${user.realName || user.username}`);
						panel.dispose();
					} else {
						vscode.window.showErrorMessage('登录失败：Cookie 无效或已过期，请重新获取');
						await authManager.logout();
					}
				} catch (error) {
					vscode.window.showErrorMessage(`登录失败: ${error}`);
					await authManager.logout();
				}
			}
		});
	});

	// ==================== 退出登录命令 ====================
	const logoutDisposable = vscode.commands.registerCommand('leetcode.logout', async () => {
		await authManager.logout();
		vscode.window.showInformationMessage('已退出登录');
	});

	// ==================== 刷新列表命令 ====================
	const refreshDisposable = vscode.commands.registerCommand('leetcode.refreshList', () => {
		hot100Provider.refresh();
	});

	// ==================== 打开题目命令 ====================
	const openProblemDisposable = vscode.commands.registerCommand('leetcode.openProblem', async (question: Question) => {
		try {
			const data = await leetCodeApi.getQuestionContent(question.titleSlug);
			if (data && data.data && data.data.question) {
				const q = data.data.question;

				// 获取工作区文件夹
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					vscode.window.showErrorMessage('请先打开一个工作区文件夹');
					return;
				}
				const workspaceFolder = workspaceFolders[0].uri.fsPath;

				// 让用户选择编程语言
				const selectedLanguage = await selectLanguage(q.codeSnippets);
				if (!selectedLanguage) {
					return; // 用户取消了选择
				}

				const langSlug = selectedLanguage.langSlug;
				const ext = getExtension(langSlug);

				// 构建代码文件路径
				const leetcodeDir = vscode.Uri.file(`${workspaceFolder}/leetcode`);
				const fileName = `${q.questionFrontendId}_${q.titleSlug}.${ext}`;
				const fileUri = vscode.Uri.file(`${workspaceFolder}/leetcode/${fileName}`);

				// 确保leetcode目录存在
				try {
					await vscode.workspace.fs.stat(leetcodeDir);
				} catch {
					await vscode.workspace.fs.createDirectory(leetcodeDir);
				}

				// 检查文件是否已存在
				let fileExists = false;
				try {
					await vscode.workspace.fs.stat(fileUri);
					fileExists = true;
				} catch {
					fileExists = false;
				}

				// 如果文件不存在，创建并写入模板代码
				if (!fileExists) {
					const content = Buffer.from(selectedLanguage.code, 'utf8');
					await vscode.workspace.fs.writeFile(fileUri, content);
				}

				// 打开代码文件
				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

				// 存储当前题目信息用于提交
				context.workspaceState.update('currentProblem', {
					titleSlug: q.titleSlug,
					questionId: q.questionId,
					lang: langSlug,
					filePath: fileUri.fsPath,
					testCases: q.exampleTestcases || q.sampleTestCase
				});

				// 创建题目描述面板（使用中文内容）
				const panel = vscode.window.createWebviewPanel(
					'leetcodeProblem',
					`${q.questionFrontendId}. ${q.translatedTitle || q.title}`,
					vscode.ViewColumn.Two,
					{ enableScripts: true, localResourceRoots: [vscode.Uri.file(context.extensionPath), context.globalStorageUri] }
				);

				// 使用中文内容（translatedContent），如果没有则使用英文
				let questionContent = q.translatedContent || q.content;
				const title = q.translatedTitle || q.title;
				const difficultyMap: Record<string, string> = {
					'Easy': '简单',
					'Medium': '中等',
					'Hard': '困难'
				};
				const difficulty = difficultyMap[q.difficulty] || q.difficulty;

				// 生成带标签页的面板HTML
const generatePanelHtml = (activeTab: string, solutionContent: string = '') => {
						const playerFiles = getPlayerFiles(context);
						const playerView = playerFiles ? {
							css: panel.webview.asWebviewUri(vscode.Uri.file(playerFiles.apiCss)).toString(),
							apiJs: panel.webview.asWebviewUri(vscode.Uri.file(playerFiles.apiJs)).toString(),
							hlsJs: panel.webview.asWebviewUri(vscode.Uri.file(playerFiles.hlsJs)).toString()
						} : null;
						const playerAssetsJson = JSON.stringify(playerView ? {
							apiJs: playerView.apiJs,
							apiCss: playerView.css,
							hlsJs: playerView.hlsJs
						} : { apiJs: '', apiCss: '', hlsJs: '' });
						return `
						<!DOCTYPE html>
					<html lang="zh-CN">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>${q.questionFrontendId}. ${title}</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
								padding: 0;
								margin: 0;
								line-height: 1.6;
								color: var(--vscode-foreground);
								background-color: var(--vscode-editor-background);
							}
							.tabs {
								display: flex;
								background: var(--vscode-tab-inactiveBackground);
								border-bottom: 1px solid var(--vscode-panel-border);
								position: sticky;
								top: 0;
								z-index: 100;
							}
							.tab {
								padding: 12px 24px;
								cursor: pointer;
								border: none;
								background: transparent;
								color: var(--vscode-foreground);
								font-size: 14px;
								border-bottom: 2px solid transparent;
								transition: all 0.2s;
							}
							.tab:hover {
								background: var(--vscode-tab-hoverBackground);
							}
							.tab.active {
								background: var(--vscode-tab-activeBackground);
								border-bottom-color: var(--vscode-focusBorder);
								font-weight: bold;
							}
							.content-wrapper {
								padding: 20px;
							}
							h1 {
								font-size: 1.5em;
								margin-bottom: 10px;
							}
							.meta {
								margin-bottom: 20px;
								color: var(--vscode-descriptionForeground);
							}
							.difficulty-easy { color: #00b8a3; }
							.difficulty-medium { color: #ffc01e; }
							.difficulty-hard { color: #ff375f; }
							pre {
								background-color: var(--vscode-textBlockQuote-background);
								padding: 12px;
								border-radius: 4px;
								overflow-x: auto;
							}
							code {
								font-family: 'Fira Code', Consolas, monospace;
							}
							.problem-content img {
								max-width: 100%;
							}
							hr {
								border: none;
								border-top: 1px solid var(--vscode-panel-border);
								margin: 20px 0;
							}
							.loading {
								text-align: center;
								padding: 40px;
								color: var(--vscode-descriptionForeground);
							}
							.solution-section {
								margin-bottom: 30px;
								padding: 20px;
								background: var(--vscode-textBlockQuote-background);
								border-radius: 8px;
							}
							.solution-section h2 {
								color: var(--vscode-textLink-foreground);
								margin-top: 0;
							}
							.article-item {
								padding: 15px;
								background: var(--vscode-editor-background);
								border-radius: 6px;
								cursor: pointer;
								margin-bottom: 10px;
								border: 1px solid var(--vscode-panel-border);
							}
							.article-item:hover {
								background: var(--vscode-list-hoverBackground);
							}
							.article-title {
								font-weight: bold;
								margin-bottom: 5px;
							}
							.article-meta {
								font-size: 12px;
								color: var(--vscode-descriptionForeground);
							}
							.hidden { display: none; }
							/* 代码高亮样式 */
							.solution-content pre {
								position: relative;
								background: var(--vscode-textPreformat-background);
								padding: 16px;
								border-radius: 6px;
								overflow-x: auto;
								margin: 16px 0;
							}
							.solution-content pre code {
								font-family: 'Fira Code', Consolas, 'Courier New', monospace;
								font-size: 14px;
								line-height: 1.5;
							}
							.solution-content img {
								max-width: 100%;
								border-radius: 8px;
								margin: 16px 0;
							}
							.solution-content h2, .solution-content h3 {
								color: var(--vscode-textLink-foreground);
								margin-top: 24px;
							}
							.solution-content blockquote {
								border-left: 4px solid var(--vscode-textLink-foreground);
								margin: 16px 0;
								padding: 8px 16px;
								background: var(--vscode-textBlockQuote-background);
							}
.solution-content ul, .solution-content ol {
									padding-left: 24px;
								}
								.solution-content a {
									color: var(--vscode-textLink-foreground);
								}
								/* 代码块复制按钮（右上角） */
								.lc-copy {
									position: absolute;
									top: 6px;
									right: 8px;
									background: transparent;
									border: none;
									cursor: pointer;
									font-size: 14px;
									line-height: 1;
									padding: 4px 6px;
									border-radius: 4px;
									color: var(--vscode-descriptionForeground);
									opacity: 0.7;
								}
								.lc-copy:hover {
									opacity: 1;
									background: var(--vscode-tab-hoverBackground);
								}
							/* 代码块标签样式 */
							.code-tabs {
								display: flex;
								gap: 4px;
								margin-bottom: -1px;
								flex-wrap: wrap;
							}
							.code-tab {
								padding: 6px 12px;
								background: var(--vscode-tab-inactiveBackground);
								border: 1px solid var(--vscode-panel-border);
								border-bottom: none;
								border-radius: 4px 4px 0 0;
								cursor: pointer;
								font-size: 12px;
							}
							.code-tab.active {
								background: var(--vscode-textPreformat-background);
							}
							.code-block {
								display: none;
							}
							.code-block.active {
								display: block;
							}
							/* KaTeX数学公式样式 */
							.katex { font-size: 1.1em; }
							/* 语言标签组样式 */
							.lang-tabs {
								display: flex;
								flex-wrap: wrap;
								gap: 4px;
								margin-top: 16px;
								margin-bottom: 0;
							}
							.lang-tab {
								padding: 6px 14px;
								background: var(--vscode-tab-inactiveBackground);
								border: 1px solid var(--vscode-panel-border);
								border-bottom: none;
								border-radius: 6px 6px 0 0;
								cursor: pointer;
								font-size: 12px;
								color: var(--vscode-foreground);
							}
							.lang-tab:hover {
								background: var(--vscode-tab-hoverBackground);
							}
							.lang-tab.active {
								background: var(--vscode-textPreformat-background);
								font-weight: bold;
								border-bottom: 1px solid var(--vscode-textPreformat-background);
							}
							.lang-code-block {
								display: none;
								margin-top: -1px;
							}
							.lang-code-block.active {
								display: block;
							}
							.lang-code-block pre {
								margin-top: 0;
								border-radius: 0 6px 6px 6px;
							}
							.code-tabs-container {
								margin: 16px 0;
							}
							/* 代码语法高亮配色（GitHub 明/暗，由扩展端按 VSCode 主题在渲染时静态选择） */
							.solution-content pre code {
								color: #24292e;
							}
							.solution-content .hljs-keyword, .solution-content .hljs-literal, .solution-content .hljs-selector-tag, .solution-content .hljs-name {
								color: #d73a49;
							}
							.solution-content .hljs-string, .solution-content .hljs-regexp, .solution-content .hljs-addition, .solution-content .hljs-char.escape_ {
								color: #032f62;
							}
							.solution-content .hljs-comment, .solution-content .hljs-quote, .solution-content .hljs-meta, .solution-content .hljs-doctag {
								color: #6a737d;
							}
							.solution-content .hljs-title, .solution-content .hljs-title.class_, .solution-content .hljs-title.function_, .solution-content .hljs-section {
								color: #6f42c1;
							}
							.solution-content .hljs-number, .solution-content .hljs-symbol, .solution-content .hljs-attr, .solution-content .hljs-attribute, .solution-content .hljs-variable, .solution-content .hljs-template-variable {
								color: #005cc5;
							}
							.solution-content .hljs-built_in, .solution-content .hljs-type, .solution-content .hljs-params, .solution-content .hljs-variable.language_ {
								color: #e36209;
							}
							/* 暗色主题（GitHub Dark 配色） */
							.solution-content code.hljs-dark {
								color: #e6edf3;
							}
							.solution-content code.hljs-dark .hljs-keyword, .solution-content code.hljs-dark .hljs-literal, .solution-content code.hljs-dark .hljs-selector-tag, .solution-content code.hljs-dark .hljs-name {
								color: #ff7b72;
							}
							.solution-content code.hljs-dark .hljs-string, .solution-content code.hljs-dark .hljs-regexp, .solution-content code.hljs-dark .hljs-addition, .solution-content code.hljs-dark .hljs-char.escape_ {
								color: #a5d6ff;
							}
							.solution-content code.hljs-dark .hljs-comment, .solution-content code.hljs-dark .hljs-quote, .solution-content code.hljs-dark .hljs-meta, .solution-content code.hljs-dark .hljs-doctag {
								color: #8b949e;
							}
							.solution-content code.hljs-dark .hljs-title, .solution-content code.hljs-dark .hljs-title.class_, .solution-content code.hljs-dark .hljs-title.function_, .solution-content code.hljs-dark .hljs-section {
								color: #d2a8ff;
							}
							.solution-content code.hljs-dark .hljs-number, .solution-content code.hljs-dark .hljs-symbol, .solution-content code.hljs-dark .hljs-attr, .solution-content code.hljs-dark .hljs-attribute, .solution-content code.hljs-dark .hljs-variable, .solution-content code.hljs-dark .hljs-template-variable {
								color: #79c0ff;
							}
							.solution-content code.hljs-dark .hljs-built_in, .solution-content code.hljs-dark .hljs-type, .solution-content code.hljs-dark .hljs-params, .solution-content code.hljs-dark .hljs-variable.language_ {
								color: #ffa657;
							}
							video.article-video {
								max-width: 100%;
								border-radius: 8px;
								margin: 8px 0;
							}
							.article-video video {
								width: 100%;
								border-radius: 8px;
								background: #000;
								max-height: 480px;
							}
							.img-placeholder {
								color: var(--vscode-descriptionForeground);
							}
							.video-link {
								background: var(--vscode-button-background);
								color: var(--vscode-button-foreground);
								border: none;
								padding: 10px 20px;
								border-radius: 6px;
								cursor: pointer;
								font-size: 14px;
								margin: 8px 0;
							}
							.video-link:hover {
								background: var(--vscode-button-hoverBackground);
							}
							table {
								border-collapse: collapse;
								margin: 16px 0;
							}
							th, td {
								border: 1px solid var(--vscode-panel-border);
								padding: 6px 12px;
							}
							th {
								background: var(--vscode-tab-inactiveBackground);
							}
						</style>
<!-- 加载 KaTeX 用于数学公式渲染（可选增强，加载失败时公式保留原文） -->
							<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
							<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
							<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
							<!-- 视频播放资源（Aliplayer/hls.js，本地 vendor）在点击视频时按需加载，不进首屏 -->
							<!-- 代码语法高亮由扩展端渲染时完成（vendored highlight.js），webview 仅需配色变量 -->
					</head>
					<body>
						<div class="tabs">
							<button class="tab ${activeTab === 'problem' ? 'active' : ''}" onclick="switchTab('problem')">📝 题目描述</button>
							<button class="tab ${activeTab === 'solution' ? 'active' : ''}" onclick="switchTab('solution')">📖 题解</button>
						</div>
						
						<div class="content-wrapper">
							<div id="problem-tab" class="${activeTab === 'problem' ? '' : 'hidden'}">
								<h1>${q.questionFrontendId}. ${title}</h1>
								<div class="meta">
									<span class="difficulty-${q.difficulty.toLowerCase()}">${difficulty}</span>
									 | 👍 ${q.likes} | 👎 ${q.dislikes}
								</div>
								<hr/>
								<div class="problem-content">${questionContent}</div>
							</div>
							
							<div id="solution-tab" class="${activeTab === 'solution' ? '' : 'hidden'}">
								${solutionContent || '<div class="loading">点击"题解"标签加载题解内容...</div>'}
							</div>
						</div>
						
						<script>
							const vscode = acquireVsCodeApi();
							let solutionLoaded = false;
							
							function switchTab(tab) {
								document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
								document.querySelector('.tab:nth-child(' + (tab === 'problem' ? '1' : '2') + ')').classList.add('active');
								
								document.getElementById('problem-tab').classList.toggle('hidden', tab !== 'problem');
								document.getElementById('solution-tab').classList.toggle('hidden', tab !== 'solution');
								
								if (tab === 'solution' && !solutionLoaded) {
									solutionLoaded = true;
									vscode.postMessage({ type: 'loadSolution' });
								}
							}
							
							function openArticle(slug) {
								vscode.postMessage({ type: 'openArticle', slug: slug });
							}
function selectLangTab(btn) {
								var box = btn.closest('.code-tabs-container');
								var tabs = box.querySelectorAll('.lang-tab');
								var idx = Array.prototype.indexOf.call(tabs, btn);
								tabs.forEach(function(t) { t.classList.remove('active'); });
								box.querySelectorAll('.lang-code-block').forEach(function(b) { b.classList.remove('active'); });
								btn.classList.add('active');
								box.querySelectorAll('.lang-code-block')[idx].classList.add('active');
							}
							
							// 复制代码块内容（标签页组内复制当前激活语言；纯文本取自 textContent，不受高亮 span 影响）
							function copyCode(btn) {
								var container = btn.closest('.code-tabs-container');
								var code = null;
								if (container) {
									var active = container.querySelector('.lang-code-block.active code, .lang-code-block code');
									code = container.querySelector('.lang-code-block.active code') || active;
								}
								if (!code) {
									var pre = btn.closest('pre');
									code = pre ? pre.querySelector('code') : null;
								}
								if (code) {
									vscode.postMessage({ type: 'copyCode', text: code.textContent || '' });
								}
							}
							
							// 视频题解：请求扩展端查询阿里云 VOD playAuth 播放凭证，成功后用 Aliplayer 内嵌播放；
							// 失败时降级为浏览器播放入口
							function playArticleVideo(btn) {
								btn.setAttribute('data-loading', '1');
								btn.textContent = '⏳ 正在获取播放信息…';
								btn.disabled = true;
								vscode.postMessage({
									type: 'playVideo',
									uuid: btn.getAttribute('data-play-uuid'),
									pageUrl: btn.getAttribute('data-page-url')
								});
							}
							
							function makeVideoBrowserFallback(pageUrl) {
								var fb = document.createElement('button');
								fb.className = 'video-link';
								fb.textContent = '🎬 视频题解：在浏览器中播放';
								fb.onclick = function() { vscode.postMessage({ type: 'openExternal', url: pageUrl }); };
								return fb;
							}
							
							// 视频播放资源按需加载：仅在点击视频时注入 Aliplayer/hls.js，避免影响题解首屏渲染
							var LEETCODE_PLAYER_ASSETS = ${playerAssetsJson};
							function loadPlayerScript(src, cb) {
								if (!src) { cb(false); return; }
								var s = document.createElement('script');
								s.src = src;
								s.onload = function() { cb(true); };
								s.onerror = function() { cb(false); };
								document.head.appendChild(s);
							}
							function ensurePlayer(kind, cb) {
								if (kind === 'hls' && typeof Hls !== 'undefined') { cb(true); return; }
								if (kind === 'aliplayer' && typeof Aliplayer !== 'undefined') { cb(true); return; }
								loadPlayerScript(kind === 'hls' ? LEETCODE_PLAYER_ASSETS.hlsJs : LEETCODE_PLAYER_ASSETS.apiJs, cb);
							}
							function ensureAliplayerCss() {
								if (!LEETCODE_PLAYER_ASSETS.apiCss || document.querySelector('link[data-lc-aliplayer-css]')) return;
								var l = document.createElement('link');
								l.rel = 'stylesheet';
								l.href = LEETCODE_PLAYER_ASSETS.apiCss;
								l.setAttribute('data-lc-aliplayer-css', '1');
								document.head.appendChild(l);
							}
							
							function attachAliplayer(container, msg) {
								ensureAliplayerCss();
								ensurePlayer('aliplayer', function(ok) {
									if (!ok || typeof Aliplayer === 'undefined' || !msg.videoId || !msg.playAuth) {
										container.replaceWith(makeVideoBrowserFallback(msg.pageUrl));
										return;
									}
									try {
										new Aliplayer({
											id: container.id,
											vid: msg.videoId,
											playauth: msg.playAuth,
											cover: msg.coverUrl || '',
											width: '100%',
											height: '480px',
											autoplay: true,
											playsinline: true,
											preload: true
										});
									} catch (e) {
										container.replaceWith(makeVideoBrowserFallback(msg.pageUrl));
									}
								});
							}
							
							function setupVideoPlayer(container, msg) {
								function debug(info) { vscode.postMessage({ type: 'videoDebug', info: info }); }
								// 编解码能力检测（Electron 可能缺少 H.264/AAC 解码器）
								var probe = document.createElement('video');
								debug('codec.avc1=' + probe.canPlayType('video/mp4; codecs="avc1.42E01E"').toUpperCase() +
									' codec.hev1=' + probe.canPlayType('video/mp4; codecs="hev1.1.6.L93.90"').toUpperCase() +
									' h264Ts=' + probe.canPlayType('video/mp2t; codecs="avc1.42E01E"').toUpperCase());
								if (!msg.videoUrl) {
									attachAliplayer(container, msg);
									return;
								}
								var v = document.createElement('video');
								v.controls = true;
								v.autoplay = true;
								v.playsInline = true;
								v.poster = msg.coverUrl || '';
								container.appendChild(v);
								var isHls = (msg.videoUrl || '').indexOf('.m3u8') !== -1;
								var fallbackOnFail = function() { attachAliplayer(container, msg); };
								if (isHls) {
									ensurePlayer('hls', function(ok) {
										if (!ok || typeof Hls === 'undefined' || !Hls.isSupported()) {
											fallbackOnFail();
											return;
										}
										try {
											var hls = new Hls({ enableWorker: false });
											hls.loadSource(msg.videoUrl);
											hls.attachMedia(v);
											hls.on(Hls.Events.ERROR, function(evt, data) {
												debug('hls.' + (data && data.details) + ' fatal=' + (data && data.fatal) + ' network=' + (data && data.networkDetails) + ' err=' + (data && data.error));
												if (data && data.fatal) {
													try { hls.destroy(); } catch (e2) {}
													fallbackOnFail();
												}
											});
											v.play().catch(function() {});
										} catch (e) {
											debug('hls.new.' + e);
											fallbackOnFail();
										}
									});
									return;
								}
								v.addEventListener('error', fallbackOnFail);
								v.src = msg.videoUrl;
								v.play().catch(function() {});
							}
							
							window.addEventListener('message', function(ev) {
								var msg = ev.data;
								if (!msg || msg.type !== 'videoReady') return;
								var btn = document.querySelector('.video-link[data-loading="1"]');
								if (!btn) return;
								var container = document.createElement('div');
								container.className = 'article-video';
								container.id = 'lc-video-' + Date.now();
								btn.replaceWith(container);
								setupVideoPlayer(container, msg);
							});
							
							// 若 KaTeX 从 CDN 加载成功，则渲染 $$/$ 数学公式；失败时公式保留为原文
							try {
								if (typeof renderMathInElement !== 'undefined') {
									renderMathInElement(document.body, {
										delimiters: [
											{ left: '$$', right: '$$', display: true },
											{ left: '$', right: '$', display: false }
										],
										ignoredTags: ['pre', 'code', 'script', 'textarea'],
										throwOnError: false
									});
								}
							} catch (e) {}
					</script>
					</body>
</html>
					`;
					};

					// 题目内容中的外链图片下载到本地缓存（webview 直连外部图可能失败）
					questionContent = await localizeContentImages(questionContent, panel, context, leetCodeApi);
					panel.webview.html = generatePanelHtml('problem');

				// 处理消息（外层兜底：任何异常都提示用户，避免静默失败）
				panel.webview.onDidReceiveMessage(async (message) => {
					try {
						await handlePanelMessage(message, panel, q);
					} catch (error) {
						vscode.window.showErrorMessage(`处理操作失败: ${error instanceof Error ? error.message : String(error)}`);
					}
				});

				/**
				 * 题解面板消息处理（抽出来便于外层统一兜底错误提示）
				 */
				async function handlePanelMessage(message: any, panel: vscode.WebviewPanel, q: any) {
					if (message.type === 'loadSolution') {
						try {
							// 获取官方题解
							const officialData = await leetCodeApi.getOfficialSolution(q.titleSlug);
							const officialSolution = officialData?.data?.question?.solution;

							// 获取社区题解
							const communityData = await leetCodeApi.getSolutionArticles(q.titleSlug, 0, 10);
							const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];

								let solutionHtml = '';

								// 官方题解：question.solution 的 content 只有文字 + playground iframe，
								// 代码无法从 GraphQL 抓取且 iframe 会被整体移除；真正带代码的官方题解是
								// byLeetcode 标记的官方文章。优先拉取该文章并静态渲染其中的代码块。
const officialArticleEdge = communityArticles.find((e: any) => e.node?.byLeetcode === true);
								let officialArticleHtml = '';
								if (officialArticleEdge?.node?.slug) {
									try {
										const articleData = await leetCodeApi.getSolutionArticle(officialArticleEdge.node.slug);
										const article = articleData?.data?.solutionArticle;
										if (article && article.content) {
											const cleanedContent = sanitizeSolutionContent(article.content);
											// 文章页 URL 需要数字 topic.id（仅 slug 会被 SPA 跳回题解列表）
											const articleTopicId = officialArticleEdge.node?.topic?.id;
											const solutionPageUrl = articleTopicId
												? `https://leetcode.cn/problems/${q.titleSlug}/solutions/${articleTopicId}/${officialArticleEdge.node.slug}/`
												: `https://leetcode.cn/problems/${q.titleSlug}/solutions/${officialArticleEdge.node.slug}/`;
											officialArticleHtml = `
												<div class="solution-section">
													<h2>📖 官方题解</h2>
													<div class="article-meta" style="margin-bottom:12px;">👑 LeetCode 官方 | 👍 ${article.upvoteCount}</div>
													<div class="solution-content">${renderMarkdownToHtml(cleanedContent, 'all', true, solutionPageUrl)}</div>
												</div>
											`;
										}
									} catch (e) {
										// 官方文章拉取失败时静默跳过，回退到 question.solution 的文字内容
									}
								}

								if (officialArticleHtml) {
									solutionHtml += officialArticleHtml;
								} else if (officialSolution && officialSolution.content && officialSolution.canSeeDetail) {
									// 回退方案：官方文章不可用时，展示 question.solution 的文字题解（静态渲染，不含代码）
									// 清理内容中的 iframe 代码游玩区，避免 webview 中被重定向为登录页
									const cleanedContent = sanitizeSolutionContent(officialSolution.content);
									solutionHtml += `
										<div class="solution-section">
											<h2>📖 官方题解</h2>
											<p style="color:var(--vscode-descriptionForeground);">（文字题解，代码见官方文章）</p>
											<div class="solution-content">${renderMarkdownToHtml(cleanedContent, 'preferred')}</div>
										</div>
									`;
								} else if (officialSolution && !officialSolution.canSeeDetail) {
									solutionHtml += `
										<div class="solution-section">
											<h2>📖 官方题解</h2>
											<p>🔒 此题解为会员专享内容</p>
										</div>
									`;
								}

							// 社区题解
							if (communityArticles.length > 0) {
								const articleItems = communityArticles.map((edge: any) => {
									const article = edge.node;
									const author = article.author?.profile?.realName || article.author?.username || '匿名';
									const tags = article.byLeetcode ? '👑 官方 ' : '';
									return `
										<div class="article-item" onclick="openArticle('${article.slug}')">
											<div class="article-title">${article.title}</div>
											<div class="article-meta">${tags}👍 ${article.upvoteCount} | 作者: ${author}</div>
										</div>
									`;
								}).join('');

								solutionHtml += `
									<div class="solution-section">
										<h2>💡 社区热门题解</h2>
										${articleItems}
									</div>
								`;
							}

// 社区精选（含代码）：取高赞的非官方社区题解全文，完整渲染 Markdown，
									// 多语言代码块保留全部并生成标签页，与官方题解展示互补、不重复。
									const pickEdge = communityArticles.find((e: any) => e.node?.byLeetcode !== true);
									if (pickEdge?.node?.slug) {
										try {
											const topArticleData = await leetCodeApi.getSolutionArticle(pickEdge.node.slug);
											const topArticle = topArticleData?.data?.solutionArticle;
											if (topArticle && topArticle.content) {
												const cleanedTop = sanitizeSolutionContent(topArticle.content);
												const topAuthor = topArticle.author?.profile?.realName || topArticle.author?.username || '匿名';
												const topArticleHtml = renderMarkdownToHtml(cleanedTop, 'all');
											solutionHtml += `
												<div class="solution-section">
													<h2>⭐ 社区精选题解（含代码）</h2>
													<div class="article-meta" style="margin-bottom:12px;">👍 ${topArticle.upvoteCount} | 作者: ${topAuthor}</div>
													<div class="solution-content">${topArticleHtml}</div>
												</div>
											`;
										}
									} catch (e) {
										// 拉取精选题解失败时静默跳过，不影响其余内容
									}
								}

							if (!solutionHtml) {
								solutionHtml = '<div class="loading">暂无题解</div>';
							}

							solutionHtml = await localizeContentImages(solutionHtml, panel, context, leetCodeApi);
							panel.webview.html = generatePanelHtml('solution', solutionHtml);
						} catch (error) {
							panel.webview.html = generatePanelHtml('solution', `<div class="loading">加载题解失败: ${error}</div>`);
						}
					} else if (message.type === 'playVideo') {
						try {
							const uuid = typeof message.uuid === 'string' ? message.uuid.trim() : '';
							if (!/^[0-9a-fA-F-]{20,40}$/.test(uuid)) {
								throw new Error('无效的视频标识');
							}
const playHolder: { value: { videoUrl: string; videoId: string; coverUrl: string; playAuth: string } | null } = { value: null };
							await vscode.window.withProgress({
								location: vscode.ProgressLocation.Notification,
								title: '正在下载视频题解…（首次约 30MB，会缓存）',
								cancellable: false
							}, async () => {
								// 元数据用于 fallback 与缓存文件名
								const infoData = await leetCodeApi.getVideoInfo(uuid);
								const meta = infoData?.data?.videosVideoInfo;
								if (!meta?.videoInfo?.videoId || !meta?.playAuth) {
									throw new Error('未获取到播放凭证');
								}
								const dirUri = vscode.Uri.joinPath(context.globalStorageUri, 'video');
								await vscode.workspace.fs.createDirectory(dirUri);
								const mp4Uri = vscode.Uri.joinPath(dirUri, meta.videoInfo.videoId + '.mp4');
								const tsUri = vscode.Uri.joinPath(dirUri, meta.videoInfo.videoId + '.ts');
								let mp4Stat: vscode.FileStat | null = null;
								try {
									mp4Stat = await vscode.workspace.fs.stat(mp4Uri);
								} catch (e) {
									mp4Stat = null;
								}
								if (!mp4Stat || mp4Stat.size === 0) {
									// 1) 下载合并 HLS 分段为连续 TS
									const merged = await leetCodeApi.getVideoMergedTs(uuid);
									const tsBuf = Buffer.isBuffer(merged.buffer) ? merged.buffer : Buffer.from(merged.buffer);
									await vscode.workspace.fs.writeFile(tsUri, new Uint8Array(tsBuf));
									// 2) 扩展端 ffmpeg remux：TS → MP4（原生 <video> 可直接播放）
									const core = await getFfmpegCore(context);
									try {
										core.FS.writeFile('/in.ts', new Uint8Array(tsBuf));
										const rc = core.exec('-i', '/in.ts', '-c', 'copy', '-movflags', '+faststart', '/out.mp4');
										const out = core.FS.readFile('/out.mp4');
										try { core.FS.deleteFile('/in.ts'); core.FS.deleteFile('/out.mp4'); } catch (e2) { /* 忽略清理失败 */ }
										if (rc !== 0 || !out || out.length < 1024) {
											throw new Error('remux 返回码 ' + rc + ' 输出 ' + (out ? out.length : 0));
										}
										await vscode.workspace.fs.writeFile(mp4Uri, new Uint8Array(out));
									} catch (e) {
										throw new Error('视频转码失败: ' + (e instanceof Error ? e.message : String(e)));
									}
								}
								playHolder.value = {
									videoUrl: panel.webview.asWebviewUri(mp4Uri).toString(),
									videoId: meta.videoInfo.videoId,
									coverUrl: meta.videoInfo.coverUrl || '',
									playAuth: meta.playAuth
								};
							});
							const play = playHolder.value;
							if (!play) {
								throw new Error('获取视频失败');
							}
							panel.webview.postMessage({
								type: 'videoReady',
								videoUrl: play.videoUrl,
								videoId: play.videoId,
								playAuth: play.playAuth,
								coverUrl: play.coverUrl || '',
								pageUrl: message.pageUrl
							});
						} catch (error) {
							vscode.window.showWarningMessage(`视频题解加载失败：${error instanceof Error ? error.message : '未知错误'}`);
							panel.webview.postMessage({ type: 'videoReady', error: true, pageUrl: message.pageUrl });
						}
					} else if (message.type === 'videoDebug') {
							console.log('[videoDebug]', message.info);
							vscode.window.showInformationMessage(`视频调试: ${message.info}`);
						} else if (message.type === 'openExternal' && typeof message.url === 'string' && message.url.startsWith('https://leetcode.cn/')) {
							// 视频题解等无法在 webview 内播放的内容，交给系统默认浏览器打开
							vscode.env.openExternal(vscode.Uri.parse(message.url));
						} else if (message.type === 'copyCode') {
						await vscode.env.clipboard.writeText(String(message.text || ''));
						vscode.window.setStatusBarMessage('已复制代码', 2000);
					} else if (message.type === 'openArticle') {
						try {
							const articleData = await leetCodeApi.getSolutionArticle(message.slug);
							const article = articleData?.data?.solutionArticle;
							if (article) {
// 清理内容中的 iframe，避免 webview 中被重定向为登录页
									const cleanedArticle = sanitizeSolutionContent(article.content || '');
									let articleHtml = `
										<div class="solution-section">
											<button onclick="vscode.postMessage({type:'loadSolution'})" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-bottom:20px;">← 返回列表</button>
											<h2>${article.title}</h2>
											<div class="article-meta" style="margin-bottom:20px;">👍 ${article.upvoteCount} | 作者: ${article.author?.profile?.realName || article.author?.username || '匿名'}${article.byLeetcode ? ' | 👑 官方' : ''}</div>
											<div class="solution-content">${renderMarkdownToHtml(cleanedArticle, 'all')}</div>
										</div>
									`;
								articleHtml = await localizeContentImages(articleHtml, panel, context, leetCodeApi);
									panel.webview.html = generatePanelHtml('solution', articleHtml);
							}
						} catch (error) {
							vscode.window.showErrorMessage(`加载题解失败: ${error}`);
						}
					}
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`加载题目失败: ${error}`);
		}
	});

	// ==================== 运行测试命令 ====================
	const testDisposable = vscode.commands.registerCommand('leetcode.test', async () => {
		// 检查登录状态
		const isLoggedIn = await authManager.isLoggedIn();
		if (!isLoggedIn) {
			const login = await vscode.window.showWarningMessage(
				'您需要先登录才能运行测试',
				'登录'
			);
			if (login === '登录') {
				vscode.commands.executeCommand('leetcode.login');
			}
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('请先打开一道题目的代码文件');
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		// 保存文件
		await editor.document.save();
		const code = editor.document.getText();

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在运行测试...",
			cancellable: false
		}, async () => {
			try {
				const result = await leetCodeApi.runCode(
					currentProblem.titleSlug,
					currentProblem.questionId,
					currentProblem.lang,
					code,
					currentProblem.testCases || ''
				);

				const interpretId = result.interpret_id;
				if (!interpretId) {
					vscode.window.showErrorMessage('测试失败: ' + JSON.stringify(result));
					return;
				}

				// 轮询获取结果
				let attempts = 0;
				while (attempts < 15) {
					await new Promise(resolve => setTimeout(resolve, 2000));
					const check = await leetCodeApi.checkSubmission(interpretId);
					if (check.state === 'SUCCESS') {
						if (check.run_success) {
							const passed = check.correct_answer;
							if (passed) {
								vscode.window.showInformationMessage(
									` 测试通过！\n运行时间: ${check.status_runtime}\n输出: ${check.code_answer?.join(', ')}`
								);
							} else {
								vscode.window.showErrorMessage(
									`测试未通过\n期望: ${check.expected_code_answer?.join(', ')}\n实际: ${check.code_answer?.join(', ')}`
								);
							}
						} else {
							vscode.window.showErrorMessage(
								`运行错误\n${check.full_compile_error || check.full_runtime_error || check.status_msg}`
							);
						}
						return;
					}
					attempts++;
				}
				vscode.window.showWarningMessage('测试超时');
			} catch (error) {
				vscode.window.showErrorMessage(`测试出错: ${error}`);
			}
		});
	});

	// ==================== 提交代码命令 ====================
	const submitDisposable = vscode.commands.registerCommand('leetcode.submit', async () => {
		// 检查登录状态
		const isLoggedIn = await authManager.isLoggedIn();
		if (!isLoggedIn) {
			const login = await vscode.window.showWarningMessage(
				'您需要先登录才能提交代码',
				'登录'
			);
			if (login === '登录') {
				vscode.commands.executeCommand('leetcode.login');
			}
			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('请先打开一道题目的代码文件');
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		// 保存文件
		await editor.document.save();
		const code = editor.document.getText();

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在提交到 LeetCode...",
			cancellable: false
		}, async () => {
			try {
				const result = await leetCodeApi.submitCode(
					currentProblem.titleSlug,
					currentProblem.questionId,
					currentProblem.lang,
					code
				);

				const submissionId = result.submission_id;
				if (!submissionId) {
					vscode.window.showErrorMessage('提交失败: ' + JSON.stringify(result));
					return;
				}

				// 轮询获取结果
				let attempts = 0;
				while (attempts < 15) {
					await new Promise(resolve => setTimeout(resolve, 2000));
					const check = await leetCodeApi.checkSubmission(submissionId);
					if (check.state === 'SUCCESS') {
						if (check.status_msg === 'Accepted') {
							vscode.window.showInformationMessage(
								`通过！运行时间: ${check.status_runtime}, 内存: ${check.status_memory}`
							);
							// 刷新题目列表以更新状态
							hot100Provider.refresh();
						} else {
							vscode.window.showErrorMessage(
								`${check.status_msg}\n${check.full_compile_error || check.full_runtime_error || ''}`
							);
						}
						return;
					}
					attempts++;
				}
				vscode.window.showWarningMessage('提交超时，请在LeetCode网站查看结果');
			} catch (error) {
				vscode.window.showErrorMessage(`提交出错: ${error}`);
			}
		});
	});

	// ==================== 创建调试文件命令 ====================
	const debugDisposable = vscode.commands.registerCommand('leetcode.debug', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('请先打开一道题目的代码文件');
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		const filePath = editor.document.uri.fsPath;
		const dirPath = filePath.substring(0, filePath.lastIndexOf('\\') !== -1 ? filePath.lastIndexOf('\\') : filePath.lastIndexOf('/'));

		// 获取当前代码
		const userCode = editor.document.getText();

		// 生成调试文件
		const debugFile = generateDebugFile(
			currentProblem.lang,
			currentProblem.questionId || '0',
			currentProblem.titleSlug,
			currentProblem.testCases || '',
			userCode
		);

		if (!debugFile) {
			vscode.window.showWarningMessage(`暂不支持 ${currentProblem.lang} 的本地调试，目前仅支持 Python`);
			return;
		}

		// 写入调试文件
		const debugFilePath = `${dirPath}/${debugFile.fileName}`;
		const debugFileUri = vscode.Uri.file(debugFilePath);

		try {
			await vscode.workspace.fs.writeFile(debugFileUri, Buffer.from(debugFile.content, 'utf8'));

			// 打开调试文件
			const doc = await vscode.workspace.openTextDocument(debugFileUri);
			await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

			vscode.window.showInformationMessage(
				`调试文件已创建！\n运行方式: python ${debugFile.fileName}\n或直接按 F5 启动调试`
			);
		} catch (error) {
			vscode.window.showErrorMessage(`创建调试文件失败: ${error}`);
		}
	});

	// ==================== 运行当前文件命令 ====================
	const runDebugDisposable = vscode.commands.registerCommand('leetcode.runDebug', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('请先打开一个代码文件');
			return;
		}

		// 保存文件
		await editor.document.save();

		const filePath = editor.document.uri.fsPath;
		const fileName = filePath.substring(filePath.lastIndexOf('\\') + 1).replace(/\\/g, '/');
		const fileDir = filePath.substring(0, filePath.lastIndexOf('\\')).replace(/\\/g, '/');

		// 根据文件扩展名确定运行命令
		let runCommand: string | null = null;

		if (filePath.endsWith('.py')) {
			runCommand = `python "${filePath}"`;
		} else if (filePath.endsWith('.js')) {
			runCommand = `node "${filePath}"`;
		} else if (filePath.endsWith('.ts')) {
			runCommand = `npx ts-node "${filePath}"`;
		} else if (filePath.endsWith('.java')) {
			// Java需要先编译再运行
			const className = fileName.replace('.java', '');
			runCommand = `cd "${fileDir}" && javac "${fileName}" && java ${className}`;
		} else if (filePath.endsWith('.cpp')) {
			// C++需要先编译再运行
			const exeName = fileName.replace('.cpp', '');
			runCommand = `cd "${fileDir}" && g++ -std=c++17 -o "${exeName}" "${fileName}" && ./"${exeName}"`;
		} else if (filePath.endsWith('.go')) {
			runCommand = `go run "${filePath}"`;
		} else if (filePath.endsWith('.rs')) {
			// Rust需要先编译再运行
			const exeName = fileName.replace('.rs', '');
			runCommand = `cd "${fileDir}" && rustc "${fileName}" -o "${exeName}" && ./"${exeName}"`;
		} else if (filePath.endsWith('.c')) {
			// C需要先编译再运行
			const exeName = fileName.replace('.c', '');
			runCommand = `cd "${fileDir}" && gcc -o "${exeName}" "${fileName}" && ./"${exeName}"`;
		}

		if (!runCommand) {
			vscode.window.showWarningMessage('不支持运行此类型的文件');
			return;
		}

		// 创建或获取终端并运行命令
		let terminal = vscode.window.terminals.find(t => t.name === 'LeetCode');
		if (!terminal) {
			terminal = vscode.window.createTerminal('LeetCode');
		}
		terminal.show();
		terminal.sendText(runCommand);
	});

	// ==================== 查看题解命令 ====================
	const viewSolutionDisposable = vscode.commands.registerCommand('leetcode.viewSolution', async () => {
		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		const titleSlug = currentProblem.titleSlug;

		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在加载题解...",
			cancellable: false
		}, async () => {
			try {
				// 获取官方题解
				const officialData = await leetCodeApi.getOfficialSolution(titleSlug);
				const officialSolution = officialData?.data?.question?.solution;

				// 获取社区题解
				const communityData = await leetCodeApi.getSolutionArticles(titleSlug, 0, 10);
				const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];

				// 创建题解面板
				const panel = vscode.window.createWebviewPanel(
					'leetcodeSolution',
					`题解 - ${titleSlug}`,
					vscode.ViewColumn.Two,
					{ enableScripts: true }
				);

				// 构建官方题解HTML
				let officialHtml = '';
				if (officialSolution && officialSolution.content && !officialSolution.paidOnly) {
					officialHtml = `
						<div class="section">
							<h2>📖 官方题解</h2>
							<div class="solution-content">${officialSolution.content}</div>
						</div>
					`;
				} else if (officialSolution?.paidOnly) {
					officialHtml = `
						<div class="section">
							<h2>📖 官方题解</h2>
							<p class="paid-only">🔒 此题解为会员专享内容</p>
						</div>
					`;
				}

				// 构建社区题解列表HTML
				let communityHtml = '';
				if (communityArticles.length > 0) {
					const articleItems = communityArticles.map((edge: any) => {
						const article = edge.node;
						const author = article.author?.profile?.realName || article.author?.username || '匿名';
						const isOfficial = article.byLeetcode ? '👑 官方' : '';
						const isPick = article.isEditorsPick ? '⭐ 精选' : '';
						return `
							<div class="article-item" onclick="openArticle('${article.slug}')">
								<div class="article-title">${article.title}</div>
								<div class="article-meta">
									${isOfficial} ${isPick}
									<span>👍 ${article.upvoteCount}</span>
									<span>作者: ${author}</span>
								</div>
								<div class="article-summary">${article.summary || ''}</div>
							</div>
						`;
					}).join('');

					communityHtml = `
						<div class="section">
							<h2>💡 社区热门题解</h2>
							<div class="article-list">${articleItems}</div>
						</div>
					`;
				}

				panel.webview.html = `
					<!DOCTYPE html>
					<html lang="zh-CN">
					<head>
						<meta charset="UTF-8">
						<meta name="viewport" content="width=device-width, initial-scale=1.0">
						<title>题解</title>
						<style>
							body {
								font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
								padding: 20px;
								line-height: 1.6;
								color: var(--vscode-foreground);
								background-color: var(--vscode-editor-background);
							}
							h1 { color: var(--vscode-textLink-foreground); }
							h2 { color: var(--vscode-textLink-foreground); margin-top: 30px; }
							.section {
								margin-bottom: 30px;
								padding: 20px;
								background: var(--vscode-textBlockQuote-background);
								border-radius: 8px;
							}
							.solution-content {
								overflow-x: auto;
							}
							.solution-content pre {
								background: var(--vscode-textPreformat-background);
								padding: 12px;
								border-radius: 4px;
								overflow-x: auto;
							}
							.solution-content code {
								font-family: 'Fira Code', Consolas, monospace;
							}
							.solution-content img {
								max-width: 100%;
							}
							.paid-only {
								color: var(--vscode-errorForeground);
								font-style: italic;
							}
							.article-list {
								display: flex;
								flex-direction: column;
								gap: 12px;
							}
							.article-item {
								padding: 15px;
								background: var(--vscode-editor-background);
								border-radius: 6px;
								cursor: pointer;
								transition: background 0.2s;
								border: 1px solid var(--vscode-panel-border);
							}
							.article-item:hover {
								background: var(--vscode-list-hoverBackground);
							}
							.article-title {
								font-weight: bold;
								font-size: 14px;
								margin-bottom: 8px;
							}
							.article-meta {
								font-size: 12px;
								color: var(--vscode-descriptionForeground);
								margin-bottom: 8px;
							}
							.article-meta span {
								margin-right: 12px;
							}
							.article-summary {
								font-size: 13px;
								color: var(--vscode-descriptionForeground);
								overflow: hidden;
								text-overflow: ellipsis;
								display: -webkit-box;
								-webkit-line-clamp: 2;
								-webkit-box-orient: vertical;
							}
							.no-solution {
								text-align: center;
								padding: 40px;
								color: var(--vscode-descriptionForeground);
							}
						</style>
					</head>
					<body>
						<h1>📚 ${titleSlug} 题解</h1>
						
						${officialHtml || ''}
						${communityHtml || ''}
						
						${!officialHtml && !communityHtml ? '<div class="no-solution">暂无题解</div>' : ''}
						
						<script>
							const vscode = acquireVsCodeApi();
							function openArticle(slug) {
								vscode.postMessage({ type: 'openArticle', slug: slug });
							}
						</script>
					</body>
					</html>
				`;

				// 处理点击社区题解
				panel.webview.onDidReceiveMessage(async (message) => {
					if (message.type === 'openArticle') {
						try {
							const articleData = await leetCodeApi.getSolutionArticle(message.slug);
							const article = articleData?.data?.solutionArticle;
							if (article) {
								panel.webview.html = `
									<!DOCTYPE html>
									<html lang="zh-CN">
									<head>
										<meta charset="UTF-8">
										<style>
											body {
												font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
												padding: 20px;
												line-height: 1.6;
												color: var(--vscode-foreground);
												background-color: var(--vscode-editor-background);
											}
											h1 { color: var(--vscode-textLink-foreground); }
											.meta { color: var(--vscode-descriptionForeground); margin-bottom: 20px; }
											pre { background: var(--vscode-textPreformat-background); padding: 12px; border-radius: 4px; overflow-x: auto; }
											code { font-family: 'Fira Code', Consolas, monospace; }
											img { max-width: 100%; }
											.back-btn {
												background: var(--vscode-button-background);
												color: var(--vscode-button-foreground);
												border: none;
												padding: 8px 16px;
												border-radius: 4px;
												cursor: pointer;
												margin-bottom: 20px;
											}
										</style>
									</head>
									<body>
										<button class="back-btn" onclick="history.back()">← 返回列表</button>
										<h1>${article.title}</h1>
										<div class="meta">
											👍 ${article.upvoteCount} | 
											作者: ${article.author?.profile?.realName || article.author?.username || '匿名'}
											${article.byLeetcode ? ' | 👑 官方' : ''}
										</div>
										<div>${article.content}</div>
									</body>
									</html>
								`;
							}
						} catch (error) {
							vscode.window.showErrorMessage(`加载题解失败: ${error}`);
						}
					}
				});

			} catch (error) {
				vscode.window.showErrorMessage(`加载题解失败: ${error}`);
			}
		});
	});

	context.subscriptions.push(
		loginDisposable,
		logoutDisposable,
		refreshDisposable,
		openProblemDisposable,
		testDisposable,
		submitDisposable,
		debugDisposable,
		runDebugDisposable,
		viewSolutionDisposable
	);
}

/**
 * 更新状态栏显示
 */
async function updateStatusBar(authManager: AuthManager) {
	const isLoggedIn = await authManager.isLoggedIn();
	if (isLoggedIn) {
		statusBarItem.text = '$(account) LeetCode: 已登录';
		statusBarItem.tooltip = '点击管理登录状态';
	} else {
		statusBarItem.text = '$(account) LeetCode: 未登录';
		statusBarItem.tooltip = '点击登录';
	}
	statusBarItem.show();
}

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
