/**
 * 判题反馈：在途忙碌锁、结果退避轮询、判题上报（输出通道 / 编辑器诊断 / 状态栏）
 */

import * as vscode from 'vscode';
import { buildJudgeReport, collectJudgeCaseInfos, JudgeCaseInfo } from './utils/judgeReport';
import { LeetCodeApi } from './core/leetcodeApi';

const errorDiagnostics = vscode.languages.createDiagnosticCollection('leetcode');

function showCodeError(fileUri: vscode.Uri, fullMessage: string): number | null {
	// Python 格式: "Line 5 in groupAnagrams (Solution.py)"；Java/JS 格式: "Solution.java:5" 或 "Solution.js:5:9"
	let lineNumber: number | null = null;
	const pyMatch = fullMessage.match(/Line\s+(\d+)/i);
	// C++/Java/JS 等文件名:行号[:列] 格式；行号后可能跟 "error:" 等后缀（如 main.cpp:3:5: error:），
	// 不再要求匹配到行尾
	const colonMatch = fullMessage.match(/:(\d+)(?::\d+)?(?=\s|:|\)|$)/m);
	if (pyMatch) {
		lineNumber = parseInt(pyMatch[1], 10);
	} else if (colonMatch) {
		lineNumber = parseInt(colonMatch[1], 10);
	}

	const lineIdx = lineNumber && lineNumber >= 1 ? lineNumber - 1 : 0;
	const diagnostic = new vscode.Diagnostic(
		new vscode.Range(lineIdx, 0, lineIdx, 0),
		fullMessage,
		vscode.DiagnosticSeverity.Error
	);
	errorDiagnostics.set(fileUri, [diagnostic]);
	return lineNumber;
}

const judgeOutputChannel = vscode.window.createOutputChannel('LeetCode 判题结果');

const judgeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);

let judgeInFlight = false;

export function tryBeginJudge(): boolean {
	if (judgeInFlight) {
		vscode.window.showWarningMessage('已有测试/提交在判题中，请等待结果后再操作');
		return false;
	}
	judgeInFlight = true;
	return true;
}

export async function pollJudgeResult(api: LeetCodeApi, judgeId: string): Promise<any | undefined> {
	const budgetMs = 90000;
	let waited = 0;
	let delay = 1000;
	judgeStatusBar.text = '$(sync~spin) LeetCode 判题中…';
	judgeStatusBar.show();
	try {
		while (waited < budgetMs) {
			await new Promise(resolve => setTimeout(resolve, delay));
			waited += delay;
			judgeStatusBar.text = `$(sync~spin) LeetCode 判题中… ${Math.round(waited / 1000)}s`;
			const check = await api.checkSubmission(judgeId);
			if (check.state === 'SUCCESS') {
				return check;
			}
			// 会话过期（status_code 1002）判题永远等不来，提前终止并报错（同时 onSessionExpired 会 toast）
			if (check?.status_code === 1002) {
				throw new Error('LeetCode 会话已过期，请重新登录后再试');
			}
			delay = Math.min(Math.round(delay * 1.5), 5000);
		}
		return undefined;
	} finally {
		judgeStatusBar.hide();
	}
}

let lastRawJudgeResponse: any;

let lastJudgeCases: { titleSlug?: string; cases: JudgeCaseInfo[] } | undefined;

export function oneLine(text: string, max: number): string {
	const flat = text.replace(/\n/g, ' ⏎ ').trim();
	return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

export async function showRawJudgeResponse(): Promise<void> {
	if (lastRawJudgeResponse === undefined) {
		vscode.window.showInformationMessage('暂无判题记录，运行测试或提交代码后可查看');
		return;
	}
	const doc = await vscode.workspace.openTextDocument({
		language: 'json',
		content: JSON.stringify(lastRawJudgeResponse, null, 2)
	});
	await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

export function reportJudgeResult(
	kind: '测试' | '提交' | '自定义用例',
	check: any,
	opts: { ok: boolean; fileUri: vscode.Uri; inputFallback?: string; submissionUrl?: string; titleSlug?: string }
): void {
	const report = buildJudgeReport(check, opts.inputFallback, opts.ok);
	lastRawJudgeResponse = check;
	lastJudgeCases = { titleSlug: opts.titleSlug, cases: collectJudgeCaseInfos(check, opts.inputFallback) };
	judgeOutputChannel.clear();
	// 行首图标标识操作类型（🧪测试/自定义用例，🚀提交），对错图标（✅/❌）在【判题结果】行
	judgeOutputChannel.appendLine(`${kind === '提交' ? '🚀' : '🧪'}【${kind}】 ${new Date().toLocaleString()}`);
	judgeOutputChannel.appendLine(report.detail);
	// 判题完成默认展开输出面板（preserveFocus：面板获得可见但不抢编辑器焦点，
	// toast 按钮与键位仍可用）
	judgeOutputChannel.show(true);

	const errorText = String(check.full_compile_error || check.full_runtime_error || '').trim();
	if (!opts.ok && errorText) {
		showCodeError(opts.fileUri, `${check.status_msg || '错误'}\n${errorText}`);
	}

	// 失败/成功都只保留有动作价值的按钮：提交可直达官方判题页；有可复现输入的失败用例
// 时提供一键本地调试。原始响应/详情走输出面板脚注与命令面板——按钮过多会换行遮挡。
const buttons: string[] = [];
	if (opts.submissionUrl) { buttons.push('在浏览器打开'); }
	const hasDebugCase = !opts.ok && !!lastJudgeCases?.cases.some(c => !c.passed && c.known && c.input);
	if (hasDebugCase) {
		buttons.push('本地调试失败用例');
	}
	const show = (message: string) => {
		const p = opts.ok
			? vscode.window.showInformationMessage(message, ...buttons)
			: vscode.window.showErrorMessage(message, ...buttons);
		p.then(selection => {
			if (selection === '在浏览器打开' && opts.submissionUrl) {
				vscode.env.openExternal(vscode.Uri.parse(opts.submissionUrl));
			} else if (selection === '本地调试失败用例') {
				vscode.commands.executeCommand('leetcode.debugFailedCase');
			}
		});
	};
	if (opts.ok) {
		const perf = [
			check.status_runtime && check.status_runtime !== 'N/A' ? `运行时间 ${check.status_runtime}` : '',
			check.status_memory && check.status_memory !== 'N/A' ? `内存 ${check.status_memory}` : ''
		].filter(Boolean).join('，');
		show(`✅ ${kind}通过！${perf ? ` ${perf}` : ''}（详情见输出 · LeetCode 判题结果）`);
	} else {
		const suffix = errorText ? '（编译/运行时错误已标注在编辑器）' : '';
		show(`❌ ${kind}未通过：${report.summary}${suffix}`);
	}
}

/** 最近一次判题的逐用例信息（"失败用例本地调试"入口读取，含 titleSlug 防串题校验） */
export function getLastJudgeCases(): { titleSlug?: string; cases: JudgeCaseInfo[] } | undefined {
	return lastJudgeCases;
}

/** 判题结束释放忙碌锁（judgeInFlight 归位，判题命令 finally 调用） */
export function releaseJudge(): void {
	judgeInFlight = false;
}

export { judgeOutputChannel, judgeStatusBar, errorDiagnostics };
