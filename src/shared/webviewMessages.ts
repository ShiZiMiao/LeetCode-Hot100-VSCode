/**
 * 题解/题面面板 webview ↔ 扩展 消息协议（类型化）
 *
 * 注意：webview 端脚本以字符串模板内嵌（generatePanelHtml），无法引用此处的 TS 类型；
 * 类型承担扩展端 handler 的负载校验与协议文档职责，webview 端 postMessage 的字段
 * 以此处定义为准（模板内 `vscode.postMessage({ type: ... })` 需与下列联合保持同步）。
 */

/** webview（题面/题解面板）→ 扩展 */
export type PanelToExtensionMessage =
	| { type: 'loadSolution' }
	| { type: 'showCachedSolution' }
	| { type: 'reloadProblem' }
	| { type: 'tabChanged'; tab: 'problem' | 'solution' }
	| { type: 'playVideo'; requestId: number; uuid: string; pageUrl: string }
	| { type: 'videoDebug'; info: string }
	| { type: 'openExternal'; url: string }
	| { type: 'copyCode'; text: string }
	| { type: 'openArticle'; slug: string }
	| { type: 'openSimilarProblem'; titleSlug: string; title: string; difficulty: string };

/** 扩展 → webview（题面/题解面板） */
export type ExtensionToPanelMessage =
	| {
			type: 'videoReady';
			/** 关联发起点击的按钮（多视频并发/页面重建时定位播放器挂载点） */
			requestId?: number;
			videoUrl: string;
			videoId: string;
			playAuth: string;
			coverUrl: string;
			/** 扩展端转码的 MP3 音频（base64），声音 WebAudio 解码播放 */
			audioData?: string;
			pageUrl: string;
	  }
	| { type: 'videoReady'; requestId?: number; error: true; pageUrl: string }
	| { type: 'navigate'; tab: 'problem' | 'solution' };