/**
 * 题面/题解 webview 面板：静态 HTML 生成（Markdown 渲染器、代码高亮、官方动画播放器、
 * KaTeX 公式、视频/音频接入）、题面图片本地化、播放器资源准备
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createHash } from 'crypto';
import { LeetCodeApi } from '../core/leetcodeApi';
import { escapeHtml, formatArticleDate } from '../utils/htmlUtil';

export function sanitizeSolutionContent(content: string): string {
	if (!content) {
		return content;
	}
	return content.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
}

export async function localizeContentImages(html: string, panel: vscode.WebviewPanel, context: vscode.ExtensionContext, api: LeetCodeApi): Promise<string> {
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
	s = s.replace(/<!(\[)/g, '!$1'); // 部分文章正文带 <![img](...) 包裹，还原为 ![img](...)
	return s;
}

interface MarkdownCodeBlock {
	lang: string;
	code: string;
}

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

function displayLangName(lang: string): string {
	const map: Record<string, string> = {
		'py': 'Python', 'python': 'Python', 'python3': 'Python3',
		'java': 'Java', 'cpp': 'C++', 'c++': 'C++', 'c': 'C',
		'go': 'Go', 'golang': 'Go', 'js': 'JavaScript', 'javascript': 'JavaScript',
		'rust': 'Rust', 'ts': 'TypeScript', 'typescript': 'TypeScript'
	};
	return map[lang.toLowerCase()] || lang;
}

function renderInlineMarkdown(text: string, videoPageUrl?: string): string {
	let s = escapeHtml(text);
	// 数学公式（$...$ / $$...$$）先整体剥离为占位符，避免行内规则（* 斜体等）误伤公式
	// 内的乘号星号：否则公式被 <em> 打断成多个文本节点，webview 的 KaTeX auto-render
	// 无法跨节点匹配 $ 配对，公式会连原始 LaTeX 一起无法渲染
	const mathParts: string[] = [];
	s = s.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*?\$/g, (m) => {
		mathParts.push(m);
		return `@@MATH${mathParts.length - 1}@@`;
	});
	// LeetCode 官方文章动画帧序列：![1200](url),![1200](url),...（alt=该帧停留毫秒数），
	// 渲染为与官网一致的帧播放器（黑条控件：播放/暂停、上一帧、下一帧、页码），
	// 帧增删由 webview 脚本按 data-interval 轮播；同时吞掉 <![...]> 包裹符残留的 >
	s = s.replace(/!\[(\d+)\]\(([^)\s]+)\)(?:,!\[(\d+)\]\(([^)\s]+)\))+&gt;?/g, (m) => {
		const frames = m.replace(/&gt;?$/, '').split(',').map((seg) => {
			const fm = seg.match(/!\[(\d+)\]\(([^)\s]+)\)/);
			return { ms: Number(fm![1]), url: fm![2] };
		});
		const interval = frames[0].ms || 1200;
		return `<span class="lc-anim" data-interval="${interval}" data-frames="${frames.map(f => escapeHtml(f.url)).join('|')}">`
			+ `<span class="lc-anim-stage"><img src="${escapeHtml(frames[0].url)}" alt="" loading="lazy" /></span>`
			+ `<span class="lc-anim-bar"><button class="lc-anim-play" title="播放/暂停">▶</button>`
			+ `<span class="lc-anim-nav"><button class="lc-anim-prev" title="上一帧">◀</button>`
			+ `<span class="lc-anim-page">1 / ${frames.length}</span>`
			+ `<button class="lc-anim-next" title="下一帧">▶</button></span></span></span>`;
	});
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
	// 还原数学公式（原文原样，$ 分隔符与 LaTeX 命令均保留，交给 Webview 端 KaTeX 渲染）
	s = s.replace(/@@MATH(\d+)@@/g, (_, idx) => mathParts[Number(idx)] ?? '');
	return s;
}

function renderCodeBlockHtml(block: MarkdownCodeBlock): string {
	const cls = block.lang ? `language-${escapeHtml(block.lang)}` : '';
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
	// 主题配色由 CSS @media (prefers-color-scheme) 自动跟随 VS Code 主题，渲染侧不固化任何主题类
	return `<pre class="lc-pre"><button class="lc-copy" title="复制代码" onclick="copyCode(this)">⧉</button><code class="${cls}">${inner}</code></pre>`;
}

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

export function renderMarkdownToHtml(md: string, codeMode: 'preferred' | 'all' = 'preferred', preferredFirst: boolean = false, videoPageUrl?: string): string {
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

let hljsRuntime: any = null;

let highlightJsContent: string | null = null;

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

const HLJS_LANG_MAP: Record<string, string> = {
	python3: 'python', python: 'python', py: 'python',
	golang: 'go', go: 'go', 'c++': 'cpp', cpp: 'cpp', c: 'c',
	java: 'java', javascript: 'javascript', js: 'javascript',
	rust: 'rust', typescript: 'typescript', ts: 'typescript'
};

function highlightLangName(lang: string): string | null {
	return HLJS_LANG_MAP[lang.toLowerCase()] || null;
}

let playerFiles: { apiJs: string; apiCss: string; hlsJs: string } | null = null;

export function getPlayerFiles(context: vscode.ExtensionContext): { apiJs: string; apiCss: string; hlsJs: string } | null {
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

export const generatePanelHtml = (
	q: any,
	title: string,
	difficulty: string,
	questionContent: string,
	context: vscode.ExtensionContext,
	panel: vscode.WebviewPanel,
	activeTab: string,
	solutionContent: string = ''
): string => {
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
							/* 仅题目描述的"输入/输出"示例块（<pre>）保留背景，其余区域（提示等）无背景 */
							.problem-content pre {
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
								/* 高亮 token 一律透明背景，避免文字后出现难看的底色条 */
								.solution-content pre code span,
								.solution-content pre code .hljs-keyword,
								.solution-content pre code .hljs-string,
								.solution-content pre code .hljs-comment,
								.solution-content pre code .hljs-title,
								.solution-content pre code .hljs-number,
								.solution-content pre code .hljs-built_in,
								.solution-content pre code .hljs-literal,
								.solution-content pre code .hljs-attr,
								.solution-content pre code .hljs-type,
								.solution-content pre code .hljs-params,
								.solution-content pre code .hljs-variable,
								.solution-content pre code .hljs-symbol,
								.solution-content pre code .hljs-meta,
								.solution-content pre code .hljs-regexp,
								.solution-content pre code .hljs-quote,
								.solution-content pre code .hljs-addition,
								.solution-content pre code .hljs-doctag,
								.solution-content pre code .hljs-selector-tag,
								.solution-content pre code .hljs-name,
								.solution-content pre code .hljs-attribute,
								.solution-content pre code .hljs-template-variable,
								.solution-content pre code .hljs-variable.language_ {
									background: transparent !important;
									box-shadow: none !important;
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
							/* 官方题解动画帧播放器（仿网页版黑色控件条） */
							.lc-anim {
								display: block;
								margin: 12px 0;
							}
							.lc-anim-stage {
								display: block;
								padding: 8px;
								background: var(--vscode-editor-background);
								border: 1px solid var(--vscode-panel-border);
							}
							.lc-anim-stage img {
								display: block;
								max-width: 100%;
								margin: 0 auto;
							}
							.lc-anim-bar {
								display: flex;
								align-items: center;
								justify-content: space-between;
								background: #000;
								color: #fff;
								padding: 5px 10px;
							}
							.lc-anim-bar button {
								background: none;
								border: none;
								color: #fff;
								font-size: 13px;
								cursor: pointer;
								padding: 3px 10px;
							}
							.lc-anim-bar button:hover {
								opacity: .8;
							}
							.lc-anim-nav {
								display: flex;
								align-items: center;
								gap: 6px;
								font-size: 12px;
							}
							/* 题解文章作者行（仿网页版文章头） */
							.article-head {
								display: flex;
								align-items: center;
								gap: 8px;
								margin: 0 0 12px;
								flex-wrap: wrap;
								font-size: 13px;
								color: var(--vscode-descriptionForeground);
							}
							.article-head img.article-avatar {
								width: 24px;
								height: 24px;
								border-radius: 50%;
								background: var(--vscode-editor-background);
							}
							.article-badge {
								padding: 1px 8px;
								border-radius: 10px;
								font-size: 12px;
								background: var(--vscode-badge-background);
								color: var(--vscode-badge-foreground);
							}
							/* 题目标签 chips（仿网页版题目标签） */
							.tag-chips {
								display: flex;
								flex-wrap: wrap;
								gap: 6px;
								margin: 8px 0 12px;
							}
							.tag-chip {
								padding: 2px 10px;
								border-radius: 12px;
								font-size: 12px;
								background: var(--vscode-tab-inactiveBackground);
								border: 1px solid var(--vscode-panel-border);
							}
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
							/* 代码语法高亮配色：默认 GitHub Light（:root 变量），深色由 @media prefers-color-scheme 覆盖 */
							.solution-content pre code {
								color: var(--lc-base, #24292e);
							}
							.solution-content .hljs-keyword, .solution-content .hljs-literal, .solution-content .hljs-selector-tag, .solution-content .hljs-name {
								color: var(--lc-keyword, #d73a49);
							}
							.solution-content .hljs-string, .solution-content .hljs-regexp, .solution-content .hljs-addition, .solution-content .hljs-char.escape_ {
								color: var(--lc-string, #032f62);
							}
							.solution-content .hljs-comment, .solution-content .hljs-quote, .solution-content .hljs-meta, .solution-content .hljs-doctag {
								color: var(--lc-comment, #6a737d);
							}
							.solution-content .hljs-title, .solution-content .hljs-title.class_, .solution-content .hljs-title.function_, .solution-content .hljs-section {
								color: var(--lc-title, #6f42c1);
							}
							.solution-content .hljs-number, .solution-content .hljs-symbol, .solution-content .hljs-attr, .solution-content .hljs-attribute, .solution-content .hljs-variable, .solution-content .hljs-template-variable {
								color: var(--lc-number, #005cc5);
							}
							.solution-content .hljs-built_in, .solution-content .hljs-type, .solution-content .hljs-params, .solution-content .hljs-variable.language_ {
								color: var(--lc-built, #e36209);
							}
							:root {
								--lc-base: #24292e;
								--lc-keyword: #d73a49;
								--lc-string: #032f62;
								--lc-comment: #6a737d;
								--lc-title: #6f42c1;
								--lc-number: #005cc5;
								--lc-built: #e36209;
							}
							body[data-lc-theme="dark"],
								body[data-vscode-theme-kind="vscode-dark"],
								body[data-vscode-theme-kind="vscode-high-contrast-dark"],
								body[data-vscode-theme-kind="vscode-high-contrast"] {
								--lc-base: #e6edf3;
								--lc-keyword: #ff7b72;
								--lc-string: #a5d6ff;
								--lc-comment: #8b949e;
								--lc-title: #d2a8ff;
								--lc-number: #79c0ff;
								--lc-built: #ffa657;
							}
							/* 兜底：任何主题下 token 背景一律透明 */
							.solution-content pre code span,
							.solution-content pre code .hljs-keyword,
							.solution-content pre code .hljs-string,
							.solution-content pre code .hljs-comment,
							.solution-content pre code .hljs-title,
							.solution-content pre code .hljs-number,
							.solution-content pre code .hljs-built_in,
							.solution-content pre code .hljs-literal,
							.solution-content pre code .hljs-attr,
							.solution-content pre code .hljs-type,
							.solution-content pre code .hljs-params,
							.solution-content pre code .hljs-variable,
							.solution-content pre code .hljs-symbol,
							.solution-content pre code .hljs-meta,
							.solution-content pre code .hljs-regexp,
							.solution-content pre code .hljs-quote,
							.solution-content pre code .hljs-addition,
							.solution-content pre code .hljs-doctag,
							.solution-content pre code .hljs-selector-tag,
							.solution-content pre code .hljs-name,
							.solution-content pre code .hljs-attribute,
							.solution-content pre code .hljs-template-variable,
							.solution-content pre code .hljs-variable.language_ {
								background: transparent !important;
								box-shadow: none !important;
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
							/* 视频题解：容器相对定位供音量弹层定位；VS Code webview 禁原生全屏，用 CSS 全屏替代 */
							.article-video {
								position: relative;
							}
							.article-video.lc-video-expanded {
								position: fixed;
								inset: 0;
								z-index: 9999;
								background: #000;
								padding: 24px 6%;
								margin: 0;
							}
							.article-video.lc-video-expanded video,
							.article-video.lc-video-expanded .prism-player {
								width: 100% !important;
								height: 100% !important;
								max-height: none;
								object-fit: contain;
							}
							/* 屏蔽 Aliplayer 自带的 hover 音量滑杆（其按钮交互在 webview 中不可用），统一用弹层 */
							.prism-volume-control {
								display: none !important;
							}
							/* Aliplayer 在 webview 中检测不到原生全屏后会把音量/全屏按钮置灰
							   （.disabled: pointer-events:none），点击事件不派发；强制恢复可点击，
							   实际功能由页面脚本的 document capture 拦截接管 */
							.article-video .prism-player .prism-fullscreen-btn,
							.article-video .prism-player .prism-fullscreen-btn.disabled,
							.article-video .prism-player .prism-volume,
							.article-video .prism-player .prism-volume.disabled,
							.article-video .prism-player .volume-icon,
							.article-video .prism-player .volume-icon.disabled {
								pointer-events: auto !important;
								opacity: 1 !important;
								cursor: pointer;
							}
							.lc-volume-pop {
								display: none;
							}
							/* 自绘视频控制栏（webview 中原生 video 控件与 Aliplayer 按钮均不可靠） */
							.lc-video-controls {
								position: absolute;
								left: 0;
								right: 0;
								bottom: 0;
								padding: 24px 12px 8px;
								background: linear-gradient(transparent, rgba(0, 0, 0, .75));
								color: #fff;
								font-size: 13px;
								opacity: 0;
								transition: opacity .25s;
								pointer-events: none;
							}
							.lc-video-controls.show {
								opacity: 1;
								pointer-events: auto;
							}
							.lc-vc-progress {
								height: 4px;
								background: rgba(255, 255, 255, .3);
								border-radius: 2px;
								cursor: pointer;
								margin-bottom: 8px;
							}
							.lc-vc-progress-fill {
								height: 100%;
								width: 0;
								background: #0a84ff;
								border-radius: 2px;
							}
							.lc-vc-row {
								display: flex;
								align-items: center;
								gap: 10px;
							}
							.lc-vc-flex {
								flex: 1;
							}
							.lc-video-controls button {
								background: none;
								border: none;
								color: #fff;
								font-size: 14px;
								cursor: pointer;
								padding: 2px 6px;
							}
							.lc-vc-vol {
								display: flex;
								align-items: center;
								gap: 6px;
							}
							.lc-vc-vol input[type=range] {
								width: 72px;
							}
							.lc-vc-time {
								font-size: 12px;
								white-space: nowrap;
							}
							/* 首帧播放遮罩：点击播放（真实用户手势），确保视频有声输出 */
							.lc-video-overlay {
								position: absolute;
								inset: 0;
								display: flex;
								align-items: center;
								justify-content: center;
								background: rgba(0, 0, 0, .35);
								cursor: pointer;
								z-index: 2;
							}
							.lc-video-overlay-play {
								width: 64px;
								height: 64px;
								border-radius: 50%;
								background: rgba(0, 0, 0, .6);
								border: 2px solid rgba(255, 255, 255, .85);
								color: #fff;
								font-size: 26px;
								display: flex;
								align-items: center;
								justify-content: center;
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
							.tab.refresh-tab {
								margin-left: auto;
								display: flex;
								align-items: center;
								gap: 4px;
								font-size: 13px;
								color: var(--vscode-descriptionForeground);
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
								<button class="tab refresh-tab" onclick="refreshCurrent()" title="刷新当前标签">🔄 刷新</button>
							</div>
						
						<div class="content-wrapper">
<div id="problem-tab" class="${activeTab === 'problem' ? '' : 'hidden'}">
									<h1>${q.questionFrontendId}. ${title}</h1>
									<div class="meta">
										<span class="difficulty-${q.difficulty.toLowerCase()}">${difficulty}</span>
										 | 👍 ${q.likes} | 👎 ${q.dislikes}
									</div>
									<div class="tag-chips">${(q.topicTags || []).map((t: any) => `<span class="tag-chip">${escapeHtml(t.translatedName || t.name)}</span>`).join('')}</div>
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
									let currentTab = '${activeTab}';
									
									// 代码主题判定：直接读代码块 pre 的准确背景（--vscode-textPreformat-background 已生效），
									// 并把明/暗色板变量直接写入 :root 内联样式——不依赖选择器、属性或探针
									(function() {
										var LC_VARS = {
											light: { base: '#24292e', keyword: '#d73a49', string: '#032f62', comment: '#6a737d', title: '#6f42c1', number: '#005cc5', built: '#e36209' },
											dark: { base: '#e6edf3', keyword: '#ff7b72', string: '#a5d6ff', comment: '#8b949e', title: '#d2a8ff', number: '#79c0ff', built: '#ffa657' }
										};
										function readBg() {
											var pre = document.querySelector('.solution-content pre, .problem-content pre');
											if (pre) {
												var c = getComputedStyle(pre).backgroundColor;
												if (c && c !== 'transparent' && c.indexOf('rgba(0, 0, 0, 0)') !== 0) { return c; }
											}
											var sec = document.querySelector('.solution-section');
											if (sec) {
												var s = getComputedStyle(sec).backgroundColor;
												if (s && s !== 'transparent') { return s; }
											}
											return '';
										}
										function applyLcTheme() {
											var c = readBg();
											var m = c.match(/\d+/g);
											var dark = false;
											if (m) {
												var lum = 0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2]);
												dark = lum < 160;
											}
											var vars = dark ? LC_VARS.dark : LC_VARS.light;
											document.documentElement.style.setProperty('--lc-base', vars.base);
											document.documentElement.style.setProperty('--lc-keyword', vars.keyword);
											document.documentElement.style.setProperty('--lc-string', vars.string);
											document.documentElement.style.setProperty('--lc-comment', vars.comment);
											document.documentElement.style.setProperty('--lc-title', vars.title);
											document.documentElement.style.setProperty('--lc-number', vars.number);
document.documentElement.style.setProperty('--lc-built', vars.built);
												document.body.setAttribute('data-lc-theme', dark ? 'dark' : 'light');
											}
											applyLcTheme();
										setTimeout(function() { applyLcTheme(); }, 500);
										setTimeout(function() { applyLcTheme(); }, 2500);
										var lastVal = '';
										setInterval(function() {
											var v = readBg();
											if (v !== lastVal) {
												lastVal = v;
												applyLcTheme();
											}
										}, 1000);
									})();

								
function switchTab(tab) {
									currentTab = tab;
									document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
								document.querySelector('.tab:nth-child(' + (tab === 'problem' ? '1' : '2') + ')').classList.add('active');
								
								document.getElementById('problem-tab').classList.toggle('hidden', tab !== 'problem');
								document.getElementById('solution-tab').classList.toggle('hidden', tab !== 'solution');
								
								if (tab === 'solution' && !solutionLoaded) {
									solutionLoaded = true;
									vscode.postMessage({ type: 'loadSolution' });
								}
							}

							// 刷新当前活动标签：题目描述 → 重新拉取并重建；题解 → 重新加载题解
							function refreshCurrent() {
								if (currentTab === 'solution') {
									document.getElementById('solution-tab').innerHTML = '<div class="loading">加载题解中...</div>';
									vscode.postMessage({ type: 'loadSolution' });
								} else {
									vscode.postMessage({ type: 'reloadProblem' });
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
							
// 自绘视频控制栏：Electron webview 中浏览器原生 <video controls> 的音量/全屏按钮不可用，
								// 且原生全屏被 webview 平台禁止（document.fullscreenEnabled 恒为 false）。
								// 主路径（扩展端 remux 的本地 MP4 原生 <video>）与 Aliplayer 兜底路径统一
								// 使用自绘控制栏：播放/暂停、进度拖动跳转、时间显示、音量滑杆、CSS 全屏。
								function attachCustomControls(container, v, msg) {
									if (container.querySelector('.lc-video-controls')) { return; }
									// 扩展端转码的 MP3（base64）——声音的唯一来源（fetch/video 音频管道均不可靠）
									var audioData = msg && msg.audioData ? (function() {
										try { return Uint8Array.from(atob(msg.audioData), function(c) { return c.charCodeAt(0); }); } catch (e) { return null; }
									})() : null;
									var wrap = document.createElement('div');
									wrap.className = 'lc-video-controls';
									wrap.innerHTML = '<div class="lc-vc-progress"><div class="lc-vc-progress-fill"></div></div>'
										+ '<div class="lc-vc-row"><button class="lc-vc-play" title="播放/暂停">▶</button>'
										+ '<span class="lc-vc-time">0:00 / 0:00</span><span class="lc-vc-flex"></span>'
										+ '<div class="lc-vc-vol"><button class="lc-vc-mute" title="静音/取消静音">🔊</button>'
										+ '<input type="range" min="0" max="100" step="1" value="100" title="音量" /></div>'
										+ '<button class="lc-vc-fs" title="全屏">⛶</button></div>';
									container.appendChild(wrap);
									// 首帧播放遮罩：autoplay（无用户手势）会被 Electron/Chromium 静音，
									// 点击播放是真实用户手势，可确保视频声音正常输出
									var overlay = document.createElement('div');
									overlay.className = 'lc-video-overlay';
									overlay.innerHTML = '<span class="lc-video-overlay-play">▶</span>';
									container.appendChild(overlay);
									// VS Code 主窗口 webPreferences 设了 autoplayPolicy: user-gesture-required，Chromium 对
									// <video> 的音频解码管道静默抑制（webkitAudioDecodedByteCount 恒 0，属性级
									// muted/volume 补偿无效）。声音改由 WebAudio 独立解码播放（fetch 音频 →
									// decodeAudioData → GainNode 输出，用户手势内 resume），画面仍由 <video> 承担
									var audioCtx = null;
									var audioGain = null;
									var audioBuf = null;
									var audioSrc = null;
									var audioReady = false;
									var audioFailed = false;
									var audioPending = false;
									var audioSrcStartedAt = 0;
									var audioSrcOffset = 0;
									function createAudioCtx() {
										try {
											var AC = window.AudioContext || window.webkitAudioContext;
											if (!AC) { audioFailed = true; return; }
											if (!audioCtx) {
												audioCtx = new AC();
												audioGain = audioCtx.createGain();
												audioGain.connect(audioCtx.destination);
											}
											if (audioCtx.state === 'suspended') {
												audioCtx.resume().catch(function() {});
											}
										} catch (e) { audioFailed = true; }
									}
									function loadAudio() {
										if (audioReady || audioFailed || audioPending || !audioCtx) { return; }
										if (!audioData) { audioFailed = true; return; }
										// decodeAudioData 会 detach 传入的 buffer：播放路径多处调用 loadAudio，
										// 必须加 in-flight 锁，否则并发二次解码同一个 buffer 会误报 decode 失败
										audioPending = true;
										audioCtx.decodeAudioData(audioData.buffer).then(function(buf) {
											audioBuf = buf;
											audioReady = true;
											if (!v.paused) { audioStart(); }
										}).catch(function() {
											audioFailed = true;
											vscode.postMessage({ type: 'videoDebug', info: 'AUDIO_DIAG decode-failed' });
										});
									}
									function audioStart() {
										if (!audioReady || !audioCtx) { return; }
										audioStop();
										var offset = Math.min(Math.max(v.currentTime, 0), Math.max(audioBuf.duration - 0.1, 0));
										audioSrc = audioCtx.createBufferSource();
										audioSrc.buffer = audioBuf;
										audioSrc.connect(audioGain);
										audioSrcStartedAt = audioCtx.currentTime;
										audioSrcOffset = offset;
										audioSrc.start(0, offset);
									}
									function audioStop() {
										if (audioSrc) { try { audioSrc.stop(); } catch (e) {} audioSrc = null; }
									}
									function applyVolume() {
										if (audioGain) {
											audioGain.gain.value = (v.muted || v.volume === 0) ? 0 : v.volume;
										}
										refresh();
									}
									// 主时钟为 <video>：play/pause/seek 事件驱动音轨起停与重对齐
									v.addEventListener('play', function() { createAudioCtx(); loadAudio(); audioStart(); });
									v.addEventListener('pause', audioStop);
									v.addEventListener('seeking', audioStop);
									v.addEventListener('seeked', function() { if (!v.paused) { audioStart(); } });
									v.addEventListener('volumechange', applyVolume);
									// 音轨由 AudioBuffer 时钟控制，周期性与 video 时间对齐（>0.8s 才重对齐避免咔哒）
									setInterval(function() {
										if (!audioReady || !audioSrc || !audioCtx || v.paused) { return; }
										var audioPos = (audioCtx.currentTime - audioSrcStartedAt) + audioSrcOffset;
										if (Math.abs(audioPos - v.currentTime) > 0.8) { audioStart(); }
									}, 10000);
									function startPlay() {
										if (overlay.parentNode) { overlay.remove(); }
										// 手势栈内：唤醒 AudioContext + 启动音频加载
										createAudioCtx();
										loadAudio();
										if (v.muted) { v.muted = false; }
										if (v.volume === 0) { v.volume = 1; }
										if (v.paused) {
											v.play().catch(function(err) {
												if (err && err.name === 'NotAllowedError') {
													vscode.postMessage({ type: 'videoDebug', info: 'AUDIO_DIAG play-rejected' });
												}
											});
										}
									}
									overlay.addEventListener('click', function(e) {
										e.stopPropagation();
										startPlay();
									});
									var playBtn = wrap.querySelector('.lc-vc-play');
									var timeEl = wrap.querySelector('.lc-vc-time');
									var fill = wrap.querySelector('.lc-vc-progress-fill');
									var muteBtn = wrap.querySelector('.lc-vc-mute');
									var volInput = wrap.querySelector('.lc-vc-vol input');
									var fsBtn = wrap.querySelector('.lc-vc-fs');
									var progressEl = wrap.querySelector('.lc-vc-progress');
									function fmt(t) {
										if (!isFinite(t) || t < 0) { return '0:00'; }
										var m = Math.floor(t / 60), s = Math.floor(t % 60);
										return m + ':' + (s < 10 ? '0' : '') + s;
									}
									function refresh() {
										timeEl.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
										fill.style.width = (v.duration ? (v.currentTime / v.duration * 100) : 0) + '%';
										playBtn.textContent = v.paused ? '▶' : '⏸';
										volInput.value = String(Math.round((v.muted ? 0 : v.volume) * 100));
										muteBtn.textContent = (v.muted || v.volume === 0) ? '🔇' : '🔊';
									}
									['timeupdate', 'durationchange', 'play', 'pause', 'volumechange', 'ended'].forEach(function(ev) {
										v.addEventListener(ev, refresh);
									});
									playBtn.addEventListener('click', function(e) {
										e.stopPropagation();
										if (overlay.parentNode) { overlay.remove(); }
										createAudioCtx();
										loadAudio();
										if (v.muted) { v.muted = false; }
										if (v.volume === 0) { v.volume = 1; }
										if (v.paused) { v.play().catch(function() {}); } else { v.pause(); }
									});
									muteBtn.addEventListener('click', function(e) {
										e.stopPropagation();
										v.muted = !v.muted;
										applyVolume();
									});
									volInput.addEventListener('input', function() {
										var val = Number(volInput.value) / 100;
										v.muted = val === 0;
										v.volume = val;
										applyVolume();
									});
									fsBtn.addEventListener('click', function(e) {
										e.stopPropagation();
										toggleVideoFullscreen(container);
									});
									var dragging = false;
									function seekFromEvent(e) {
										if (!isFinite(v.duration) || v.duration <= 0) { return; }
										var rect = progressEl.getBoundingClientRect();
										var ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
										v.currentTime = ratio * v.duration;
									}
									progressEl.addEventListener('mousedown', function(e) {
										dragging = true;
										seekFromEvent(e);
										e.preventDefault();
										e.stopPropagation();
									});
									document.addEventListener('mousemove', function(e) { if (dragging) { seekFromEvent(e); } });
									document.addEventListener('mouseup', function() { dragging = false; });
									// 点击画面播放/暂停
									v.addEventListener('click', function() {
										createAudioCtx();
										loadAudio();
										if (v.paused) { v.play().catch(function() {}); } else { v.pause(); }
									});
									// 鼠标活动显示控制栏，2.5s 无操作自动隐藏
									var hideTimer = null;
									function scheduleHide() {
										clearTimeout(hideTimer);
										hideTimer = setTimeout(function() { wrap.classList.remove('show'); }, 2500);
									}
									container.addEventListener('mousemove', function() {
										wrap.classList.add('show');
										scheduleHide();
									});
									container.addEventListener('mouseleave', function() {
										wrap.classList.remove('show');
										clearTimeout(hideTimer);
									});
									wrap.classList.add('show');
									scheduleHide();
									refresh();
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
												autoplay: false,
												playsinline: true,
												preload: true,
												controls: false
											});
											// Aliplayer 的 video 元素稍后就绪，就绪后接自绘控制栏（该路径无 MP3 音频数据，声音仍走 Aliplayer 自身）
											(function retry(i) {
												var av = container.querySelector('video');
												if (av) {
													attachCustomControls(container, av, msg);
												} else if (i < 10) {
													setTimeout(function() { retry(i + 1); }, 200);
												}
											})(0);
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
									v.playsInline = true;
									v.poster = msg.coverUrl || '';
									container.appendChild(v);
									attachCustomControls(container, v, msg);
									// 音轨探测：Chromium 若解析失败会静默丢弃音轨（audioTracks 为空），
									// 命中时通知用户便于后续诊断
									v.addEventListener('loadedmetadata', function() {
										var atN = (typeof v.audioTracks !== 'undefined' && v.audioTracks) ? v.audioTracks.length : -1;
										console.log('[lc-video] audioTracks=' + atN + ' videoTracks=' + ((v.videoTracks && v.videoTracks.length) || 0));
										if (atN === 0) {
											vscode.postMessage({ type: 'videoDebug', info: 'AUDIO_PROBLEM 未解析到音频轨' });
										}
									});
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
												// 播放由首帧遮罩用户点击触发（autoplay 会被静音）
										} catch (e) {
											debug('hls.new.' + e);
											fallbackOnFail();
										}
									});
									return;
								}
v.addEventListener('error', fallbackOnFail);
									v.src = msg.videoUrl;
									// 播放由首帧遮罩用户点击触发（autoplay 会被 Chromium/Electron 静音）
							}
							
							// VS Code webview 不支持原生全屏（document.fullscreenEnabled 恒为 false），
								// 视频全屏统一为 CSS 全屏（容器铺满 webview 视口，ESC 退出）
								function toggleVideoFullscreen(wrap) {
									var expanded = wrap.classList.toggle('lc-video-expanded');
									if (expanded) {
										document.addEventListener('keydown', function esc(ev) {
											if (ev.key === 'Escape' || ev.keyCode === 27) {
												wrap.classList.remove('lc-video-expanded');
												document.removeEventListener('keydown', esc);
											}
										});
									}
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
							
							// 官方题解动画帧播放器：data-frames 为 | 分隔的帧 URL，data-interval 为每帧毫秒数；
								// 点击 ▶ 自动播放（可暂停），手动切帧自动暂停，页码循环
								document.querySelectorAll('.lc-anim').forEach(function(anim) {
									var frames = (anim.getAttribute('data-frames') || '').split('|').filter(Boolean);
									var img = anim.querySelector('img');
									var playBtn = anim.querySelector('.lc-anim-play');
									var pageEl = anim.querySelector('.lc-anim-page');
									if (!img || !playBtn || !pageEl || frames.length < 2) { return; }
									var idx = 0;
									var timer = null;
									var interval = parseInt(anim.getAttribute('data-interval'), 10) || 1200;
									var show = function(i) {
										idx = (i + frames.length) % frames.length;
										img.src = frames[idx];
										pageEl.textContent = (idx + 1) + ' / ' + frames.length;
									};
									var stop = function() {
										if (timer) { clearInterval(timer); timer = null; }
										playBtn.textContent = '▶';
									};
									var play = function() {
										stop();
										playBtn.textContent = '⏸';
										timer = setInterval(function() { show(idx + 1); }, interval);
									};
									playBtn.addEventListener('click', function() { timer ? stop() : play(); });
									anim.querySelector('.lc-anim-prev').addEventListener('click', function() { stop(); show(idx - 1); });
									anim.querySelector('.lc-anim-next').addEventListener('click', function() { stop(); show(idx + 1); });
									show(0);
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

/** 初始化模块内 highlight.js 运行时（扩展 activate 时调用一次） */
export function initHighlightJs(context: vscode.ExtensionContext): void {
	hljsRuntime = loadHljsRuntime(context);
}
