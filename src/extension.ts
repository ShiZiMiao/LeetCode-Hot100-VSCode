/**
 * LeetCode Hot100 Pro
 * VS Code 扩展入口文件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AuthManager } from './core/authManager';
import { LeetCodeApi, Question } from './core/leetcodeApi';
import { loginWithBrowser, pickChromiumChannel, detectDefaultBrowser } from './core/browserLogin';
import { spawnSync } from 'child_process';
import { Hot100Provider, GroupByMode } from './views/hot100Provider';
import { StatusFilter } from './utils/progressStats';
import { Hot100Question, HOT_100_LIST, categoryLabel } from './data/hot100Data';
import { DIFFICULTY_ZH, isDifficultyLevel } from './utils/difficultyGroups';
import { nextQuestion } from './utils/questionOrder';
import { pickDailyQuestion } from './utils/dailyQuestion';
import { isReviewDue, formatFailedAt, pickReviewCandidate } from './utils/wrongQueue';
import { localDateStr } from './utils/studyStats';
import { getExtension, SUPPORTED_LANGUAGES } from './utils/languageUtils';
import { selectLanguage } from './views/languageQuickPick';
import { generateDebugFile } from './utils/debugUtils';
import { JudgeCaseInfo } from './utils/judgeReport';
import { extractExampleInputs, extractExpectedOutputs, parseProblemFileName } from './utils/problemText';
import { buildLeetCodeCookie } from './utils/loginCookie';
import { escapeHtml, errMsg, formatArticleDate } from './utils/htmlUtil';
import { difficultyZhOf } from './utils/similarQuestions';
import { generatePanelHtml, renderMarkdownToHtml, sanitizeSolutionContent, localizeContentImages, initHighlightJs } from './views/problemPanel';
import { reportJudgeResult, showRawJudgeResponse, tryBeginJudge, pollJudgeResult, releaseJudge, getLastJudgeCases, oneLine, judgeOutputChannel, judgeStatusBar, errorDiagnostics, JUDGE_POLL_BUDGET_MS } from './judgeFeedback';
import { PanelToExtensionMessage, ExtensionToPanelMessage } from './shared/webviewMessages';


// 会话过期主动提示：服务端判定未登录（HTTP 401 / status_code 1002）时限频 toast，
// 避免过期会话把每个请求都弹一遍
let sessionExpiredNotifiedAt = 0;
function notifySessionExpired(): void {
	const now = Date.now();
	if (now - sessionExpiredNotifiedAt < 10 * 60 * 1000) {
		return;
	}
	sessionExpiredNotifiedAt = now;
	vscode.window.showWarningMessage('LeetCode 登录已过期（会话失效），请重新登录', '登录').then(choice => {
		if (choice === '登录') {
			vscode.commands.executeCommand('leetcode.login');
		}
	});
}

// 每题只允许打开一个页面：同一题的题面页/题解页复用现有面板（重复点击仅聚焦），key 为 titleSlug。
// pending 集合做**同步**占位：两次快速连点时去重检查都可能在各自异步阶段完成前执行，
// 仅靠 Map 存在性会竞态双开；命令入口同步登记后可拦住第二个调用
const problemPanels = new Map<string, vscode.WebviewPanel>();
const pendingProblemOpens = new Set<string>();

// 题解 HTML 会话内缓存（key 为 titleSlug）：刷新时先立即渲染缓存内容、后台重取，
// 网络波动/慢速时避免"加载题解中"长时间挂起（失败保留缓存，不覆盖）
const solutionHtmlCache = new Map<string, string>();

/** 包裹 Promise 并限制最长等待：超时拒绝并携带提示信息（内部流程不打断，晚到结果仍可自愈刷新页面） */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(label)), ms);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); }
		);
	});
}

/** 安全写入 webview html：面板被用户中途关闭后晚到结果不再抛 "Webview is disposed" */
function safeSetHtml(panel: vscode.WebviewPanel, html: string): void {
	try {
		panel.webview.html = html;
	} catch {
		// 面板已释放（dispose 与晚到结果的竞态）：丢弃本次渲染
	}
}

/** shell 双引号包裹 + 转义（终端命令拼路径用；引号/反引号/$ 防注入） */
function shellQ(s: string): string {
	return '"' + s.replace(/(["\\$`])/g, '\\$1') + '"';
}

/**
 * 取题解代码编辑器：焦点在真实文件编辑器（scheme === file）时直接使用；
 * 焦点在输出面板、题面 webview 等非代码视图时，回退到 currentProblem.filePath
 * 记录的题解文件——判题命令（测试/提交/本地调试）在"看完判题结果顺手再点运行"
 * 的操作流下，曾把输出面板内容当代码提交（LeetCode 报 SyntaxError: invalid
 * character '【'）。非文件编辑器一律不作为提交来源。
 */
async function getProblemCodeEditor(context: vscode.ExtensionContext): Promise<vscode.TextEditor | undefined> {
	const active = vscode.window.activeTextEditor;
	if (active && active.document.uri.scheme === 'file') {
		// 只接受受支持语言扩展名的文件：自定义用例文件（debug/customcase_*.txt）、
		// 备忘等旁路文件不作为代码/调试来源，回退到 currentProblem.filePath
		const extMatch = active.document.uri.fsPath.match(/\.([a-z0-9]+)$/i);
		const ext = extMatch ? extMatch[1].toLowerCase() : '';
		const codeExts = new Set(SUPPORTED_LANGUAGES.map(l => l.extension));
		if (codeExts.has(ext)) {
			return active;
		}
	}
	const currentProblem = context.workspaceState.get<any>('currentProblem');
	const filePath: string | undefined = currentProblem?.filePath;
	if (!filePath) {
		return undefined;
	}
	try {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
		return await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
	} catch {
		return undefined;
	}
}

/**
 * 用指定用例生成调试文件并启动调试（"本地调试"与"判题失败用例本地调试"共用）。
 * testCases / expectedOutputs 传入要写入驱动的用例输入与期望输出（失败用例调试时
 * 只比对该用例，不再拉题面提取示例期望）；customCaseSource 为 true 时非 Python
 * 模板提示文案注明用例需按模板适配（Java/C++/Go/Rust 模板本就不自动套用例）。
 */
async function runDebugWithCases(
	editor: vscode.TextEditor,
	problem: any,
	testCases: string,
	expectedOutputs: string[],
	customCaseSource: boolean,
	exampleInputs: unknown[][] = []
): Promise<void> {
	const filePath = editor.document.uri.fsPath;
	const dirPath = filePath.substring(0, filePath.lastIndexOf('\\') !== -1 ? filePath.lastIndexOf('\\') : filePath.lastIndexOf('/'));

	// 驱动（尤其 Python 的 importlib 方式）从磁盘读题解代码，先保存避免调试到旧代码
	await editor.document.save();
	const userCode = editor.document.getText();

	// 生成调试文件（Python 为 importlib 驱动，其他语言为自包含模板；统一放入 debug/ 目录）
	const debugFile = generateDebugFile(
		problem.lang,
		problem.questionId || '0',
		problem.titleSlug,
		testCases,
		userCode,
		filePath,
		expectedOutputs,
		customCaseSource ? [] : exampleInputs
	);

	if (!debugFile) {
		vscode.window.showWarningMessage(`暂不支持 ${problem.lang} 的本地调试，目前支持 Python3 / Java / C++ / JavaScript / TypeScript / Go / Rust`);
		return;
	}

	// 写入调试文件（debug/ 子目录，避免散落在题解文件旁）
	const debugDir = path.join(dirPath, 'debug');
	const debugFilePath = path.join(debugDir, debugFile.fileName);
	const debugFileUri = vscode.Uri.file(debugFilePath);

	try {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));
		await vscode.workspace.fs.writeFile(debugFileUri, Buffer.from(debugFile.content, 'utf8'));

		// Python：直接启动 VS Code 原生调试会话（等价于"Python Debugger: Debug Python File"）。
		// 驱动通过 importlib 加载题解代码文件，断点可以直接打在题解文件上，无需打开驱动文件
		if (debugFile.fileName.endsWith('.py')) {
			const pythonDebugger =
				vscode.extensions.getExtension('ms-python.debugpy') ||
				vscode.extensions.getExtension('ms-python.python');
			if (!pythonDebugger) {
				const choice = await vscode.window.showWarningMessage(
					'未检测到 Python 调试扩展，需要先安装 "Python Debugger"（ms-python.debugpy）才能使用 Python 本地调试',
					'安装扩展'
				);
				if (choice === '安装扩展') {
					// workbench.extensions.installExtension 自 VS Code 1.75 起可用，静默安装
					await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-python.debugpy');
					vscode.window.showInformationMessage('Python Debugger 已安装，请再次点击"本地调试"');
				}
				return;
			}
const started = await vscode.debug.startDebugging(resolveTargetWorkspaceFolder(dirPath), {
			type: 'python',
			name: 'LeetCode Hot 100 本地调试',
			request: 'launch',
			program: debugFilePath,
			cwd: resolveTargetWorkspaceFolder(dirPath)?.uri.fsPath ?? dirPath,
				console: 'internalConsole',
				// pydevd 文件过滤器（主通道；debugpy 后端在 debuggee 进程启动时读取）：
				// 命中的文件帧完全不 trace——断点不触发、单步直接穿过、调用栈隐藏。
				// 把驱动自身排除后，调试的停止点只出现在题解代码文件里（F10 步出函数
				// 不会停进 debug.py，而是直接跑到下一个断点/结束），与"断点打在题解文件"
				// 的 importlib 机制配套。绝对路径匹配为逐段 normcase + 盘符大小写不敏感。
				// 兜底通道：生成的驱动启动时自行向 pydevd 注册同一路径的排除规则
				// （debugUtils 的 _lc_exclude_debug_self），env 未传到时会在那里补上并
				// 在调试控制台打状态行。修改这两处后务必重载扩展主机，旧代码不会带过滤。
				env: {
					PYDEVD_FILTERS: JSON.stringify({ [debugFilePath]: true })
				}
			});
			if (!started) {
				vscode.window.showErrorMessage('调试会话启动失败，请检查 Python 解释器是否已配置（Python 扩展插件）');
			}
			return;
		}

		// 打开调试文件（非 Python 语言的模板需要用户补充测试代码）
		const doc = await vscode.workspace.openTextDocument(debugFileUri);
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

		const manualHint = customCaseSource && ['java', 'cpp', 'c++', 'golang', 'go', 'rust'].includes(problem.lang)
			? '（已带入该用例，但该语言模板需按注释在 main 中手动适配）'
			: '';
		vscode.window.showInformationMessage(
			`调试文件已创建：debug/${debugFile.fileName}${manualHint}\n修改测试参数后按 F5/运行 执行`
		);
	} catch (error) {
		vscode.window.showErrorMessage(`创建调试文件失败: ${errMsg(error)}`);
	}
}

// 自定义用例文件登记：路径 → { problem, solutionPath }（判题所需题目身份 + 题解文件路径），
// 供"保存即自动判题"与"再运行命令立即重跑"使用
const customCaseFiles = new Map<string, { problem: any; solutionPath: string }>();

/**
 * 以当前登记的用例文件内容在线判题（runCode 自定义 data_input）。
 * 题解代码从登记的题解文件读取：已打开且脏则先保存，再取内存内容。
 */
async function runCustomCaseWith(api: LeetCodeApi, problem: any, solutionPath: string, inputText: string): Promise<void> {
	const dataInput = inputText.replace(/\r\n?/g, '\n').trim();
	if (!dataInput) {
		vscode.window.showWarningMessage('自定义用例为空，请填写用例输入（每行一个参数值）后保存');
		return;
	}

	// 在途忙碌锁：判题发起前同步占位，防快速连点并发 runCode/覆盖判题详情
	if (!tryBeginJudge()) {
		return;
	}
	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: '正在运行自定义用例...',
		cancellable: false
	}, async () => {
		try {
			// 读题解代码：已打开则保存后用内存内容，否则读磁盘
			let code: string;
			const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === solutionPath);
			if (openDoc) {
				await openDoc.save();
				code = openDoc.getText();
			} else {
				code = (await vscode.workspace.openTextDocument(vscode.Uri.file(solutionPath))).getText();
			}

			const result = await api.runCode(
				problem.titleSlug,
				problem.questionId,
				problem.lang,
				code,
				dataInput
			);

			const interpretId = result.interpret_id;
			if (!interpretId) {
				// 只弹摘要，完整响应写输出通道（整段大 JSON 弹窗不可读）
				judgeOutputChannel.appendLine(`[自定义用例] 发起失败原始响应: ${JSON.stringify(result)}`);
				vscode.window.showErrorMessage('自定义用例测试失败: ' + oneLine(JSON.stringify(result), 160));
				return;
			}

			// 轮询获取结果（退避至预算上限，状态栏显示等待时长）
			const check = await pollJudgeResult(api, interpretId);
			if (check) {
				reportJudgeResult('自定义用例', check, {
					ok: !!check.run_success && !!check.correct_answer,
					fileUri: vscode.Uri.file(solutionPath),
					inputFallback: dataInput,
					titleSlug: problem.titleSlug
				});
			} else {
				vscode.window.showWarningMessage('自定义用例测试超时：判题未在 90 秒内返回，可稍后重试');
			}
		} catch (error) {
			vscode.window.showErrorMessage(`自定义用例测试出错: ${errMsg(error)}`);
		} finally {
			releaseJudge();
		}
	});
}

/**
 * 以正在编辑的文件为准解析题目身份：扩展生成的题解文件名为 {题号}_{slug}.{ext}，
 * 调试驱动为 {题号}_{slug}_debug.{ext}。workspaceState 里的 currentProblem 只在
 * "打开题目"流程完整走完（选语言、建文件）后更新——语言选择被取消、窗口重启等
 * 场景会残留上一题状态，导致运行/调试/提交落到错误题目。文件名解析失败或与
 * currentProblem 一致时原样返回（零行为变化）；不一致时按文件名重新拉取题面，
 * 并同步更新 currentProblem，保证后续操作一致。拉取题面失败/返回空时提示并返回
 * null（调用方须中止——不能拿残留的 currentProblem 顶替，否则会把当前文件代码
 * 运行/提交到上一道题）。
 */
async function resolveProblemFromFile(
	api: LeetCodeApi,
	context: vscode.ExtensionContext,
	fileName: string,
	currentProblem: any
): Promise<any> {
	if (!currentProblem) {
		return currentProblem;
	}
	// 注意 py 必须映射 python3：leetcode.cn 的 'python' 是 Python 2 判题环境（官方模板
	// 为 class Solution(object) + docstring 注解），注解语法会直接 SyntaxError
	const langMap: Record<string, string> = {
		py: 'python3', js: 'javascript', ts: 'typescript', java: 'java',
		cpp: 'cpp', c: 'c', go: 'golang', rs: 'rust',
		cs: 'csharp', kt: 'kotlin', swift: 'swift', rb: 'ruby', scala: 'scala', php: 'php'
	};
	const extMatch = fileName.match(/\.([a-z0-9]+)$/i);
	const ext = extMatch ? extMatch[1].toLowerCase() : '';
	const parsed = parseProblemFileName(fileName);
	if (!parsed || parsed.titleSlug === currentProblem.titleSlug) {
		// 旧版本 langMap 曾把 .py 映射成 python（Python 2）并写入 state：lang 按当前文件
		// 扩展名归一（.py → python3；其他语言文件同样可以从脏值纠正），避免继续以错误语言提交
		const extLang = langMap[ext];
		if (currentProblem.lang === 'python' && extLang) {
			const healed = { ...currentProblem, lang: extLang };
			await context.workspaceState.update('currentProblem', healed);
			return healed;
		}
		return currentProblem;
	}
	// 文件名指向另一道题（非 Hot 100 的外部文件都在此路径）：必须按该题身份继续，
	// 拉取失败绝不能回退 currentProblem——否则会把当前文件代码运行/提交到上一题
	let data: any;
	try {
		data = await api.getQuestionContent(parsed.titleSlug);
	} catch (error) {
		vscode.window.showErrorMessage(
			`无法解析当前文件对应的题目（${parsed.titleSlug}：${errMsg(error)}），已中止本次操作，避免运行/提交到错误的题目`
		);
		return null;
	}
	const q = data?.data?.question;
	if (!q) {
		vscode.window.showErrorMessage(
			`无法解析当前文件对应的题目（${parsed.titleSlug}：接口未返回题面数据），已中止本次操作，避免运行/提交到错误的题目`
		);
		return null;
	}
	const problem = {
		titleSlug: q.titleSlug || parsed.titleSlug,
		questionId: q.questionId,
		lang: langMap[ext] || currentProblem.lang,
		testCases: q.exampleTestcases || q.sampleTestCase || currentProblem.testCases || ''
	};
	await context.workspaceState.update('currentProblem', problem);
	return problem;
}

/**
 * 把云端某次提交的代码恢复到本地题解文件（跨设备代码同步：A 机提交 → B 机登录同账号后恢复）。
 * 文件名沿用 {题号}_{slug}.{ext} 约定（解析/判题流程通用）；本地已有同题文件时询问覆盖/另存副本。
 * 恢复成功后同步更新 currentProblem，后续测试/提交直接作用于恢复出的文件。
 * 返回恢复写入的语言 slug（失败/取消返回 null，调用方可回退模板流程）。
 */
async function restoreSubmissionToLocal(
	context: vscode.ExtensionContext,
	api: LeetCodeApi,
	problem: any,
	wsHint: { filePath?: string },
	submission: { id: string; lang: string; statusDisplay: string }
): Promise<string | null> {
	const ext = getExtension(submission.lang);
	if (ext === 'txt') {
		vscode.window.showWarningMessage(`暂不支持恢复 ${submission.lang} 语言的代码（无文件扩展名映射）`);
		return null;
	}
	const detail = await api.getSubmissionDetail(submission.id);
	if (!detail || !detail.code) {
		vscode.window.showErrorMessage(`未能获取提交 ${submission.id} 的代码，请稍后重试`);
		return null;
	}
	const hotq = HOT_100_LIST.find(q => q.titleSlug === problem.titleSlug);
	const idPart = hotq?.frontendQuestionId || (problem.questionId ? String(problem.questionId) : '0');
	const ws = resolveTargetWorkspaceFolder(wsHint?.filePath);
	if (!ws) {
		vscode.window.showErrorMessage('请先打开一个工作区文件夹');
		return null;
	}
	const dir = vscode.Uri.joinPath(ws.uri, 'leetcode');
	try {
		await vscode.workspace.fs.createDirectory(dir);
	} catch {
		// 目录创建失败时由后续 writeFile 透出真实错误
	}
	const fileName = `${idPart}_${problem.titleSlug}.${ext}`;
	const fileUri = vscode.Uri.joinPath(dir, fileName);
	let exists = false;
	try {
		await vscode.workspace.fs.stat(fileUri);
		exists = true;
	} catch {
		exists = false;
	}
	let target = fileUri;
	if (exists) {
		const copyName = `${idPart}_${problem.titleSlug}_restored.${ext}`;
		const choice = await vscode.window.showQuickPick(
			[
				{ label: '覆盖现有文件', description: fileUri.fsPath },
				{ label: `另存为副本（${copyName}）`, description: '保留当前文件，副本仍可按同题运行/提交' }
			],
			{ title: '本地已有同题代码文件', placeHolder: '选择处理方式' }
		);
		if (!choice) {
			return null;
		}
		if (choice.label.startsWith('另存为副本')) {
			target = vscode.Uri.joinPath(dir, copyName);
		}
	}
	await vscode.workspace.fs.writeFile(target, Buffer.from(detail.code, 'utf8'));
	const doc = await vscode.workspace.openTextDocument(target);
	await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
	await context.workspaceState.update('currentProblem', {
		titleSlug: problem.titleSlug,
		questionId: problem.questionId,
		lang: detail.lang || submission.lang,
		filePath: target.fsPath,
		testCases: problem.testCases || ''
	});
	vscode.window.showInformationMessage(
		`已恢复 ${submission.statusDisplay || '提交'} 代码到 leetcode/${target.fsPath.split(/[\\/]/).pop() || fileName}`
	);
	return detail.lang || submission.lang;
}

/**
 * 打开题目时尝试跨设备同步：本机没有该题代码文件、云端却有历史提交时，
 * 询问是否从云端恢复代码（语言以云端提交为准，不再弹语言选择器）。
 * 返回恢复写入的语言 slug；无提交/未登录/用户选择模板或取消时返回 null（走模板流程）。
 */
async function tryRestoreOnOpen(
	context: vscode.ExtensionContext,
	api: LeetCodeApi,
	q: { titleSlug: string; questionId: string; exampleTestcases?: string; sampleTestCase?: string },
	workspaceFolder: string
): Promise<string | null> {
	let subs: Awaited<ReturnType<LeetCodeApi['getSubmissions']>>;
	try {
		subs = await api.getSubmissions(q.titleSlug, SUBMISSION_LIST_LIMIT);
	} catch {
		return null; // 未登录/网络异常：静默回退模板流程
	}
	if (subs.length === 0) {
		return null;
	}
	const problem = {
		titleSlug: q.titleSlug,
		questionId: q.questionId,
		testCases: q.exampleTestcases || q.sampleTestCase || ''
	};
	// 固定把恢复写进 openProblem 已解析的目标工作区（多根工作区时与模板文件同目录）
	const currentProblemForWs = { filePath: `${workspaceFolder}/leetcode` };
	const latestAc = subs.find(s => s.statusDisplay === 'Accepted');
	const options: (vscode.QuickPickItem & { sub?: (typeof subs)[number] })[] = [];
	if (latestAc) {
		options.push({
			label: `📥 恢复最近通过的提交（${langDisplayName(latestAc.lang)}）`,
			description: latestAc.timestamp ? formatFailedAt(latestAc.timestamp * 1000) : '',
			sub: latestAc
		});
	}
	options.push({ label: '📥 从提交历史中选择恢复…' });
	options.push({ label: '使用官方模板新建（本次不恢复）' });
	const pick = await vscode.window.showQuickPick(options, {
		title: `本机无「${q.titleSlug}」的代码文件${latestAc ? '，云端有已通过的提交' : '，云端有历史提交'}`,
		placeHolder: '是否从云端恢复代码（跨设备同步）？'
	});
	if (!pick) {
		return null; // Esc 与「使用模板」同义
	}
	let chosen = pick.sub;
	if (!chosen) {
		if (!pick.label.startsWith('📥')) {
			return null; // 使用官方模板新建
		}
		const historyItems = subs.map(s => ({
			label: `${SUBMISSION_STATUS_ZH[s.statusDisplay] || s.statusDisplay || '未知'} · ${langDisplayName(s.lang)}`,
			description: s.timestamp ? formatFailedAt(s.timestamp * 1000) : '',
			sub: s
		}));
		const historyPick = await vscode.window.showQuickPick(historyItems, {
			title: `${q.titleSlug} 提交历史`,
			placeHolder: '选择要恢复到本地的提交'
		});
		if (!historyPick) {
			return null;
		}
		chosen = historyPick.sub;
	}
	const restoredLang = await restoreSubmissionToLocal(context, api, problem, currentProblemForWs, chosen);
	return restoredLang ?? null;
}

// 状态栏项
let statusBarItem: vscode.StatusBarItem;

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

/** 提交历史拉取条数 */
const SUBMISSION_LIST_LIMIT = 20;

/** 提交状态显示名（submissionList 的 statusDisplay 为英文枚举） */
const SUBMISSION_STATUS_ZH: Record<string, string> = {
	'Accepted': '通过',
	'Wrong Answer': '答案错误',
	'Time Limit Exceeded': '超时',
	'Memory Limit Exceeded': '内存超限',
	'Output Limit Exceeded': '输出超限',
	'Compile Error': '编译错误',
	'Compiled Error': '编译错误',
	'Runtime Error': '运行时错误',
	'Presentation Error': '输出格式错误',
	'Internal Error': '内部错误'
};

/** 判题语言 slug → 显示名（提交历史用；leetcode.cn 用 golang 而非 go） */
function langDisplayName(lang: string): string {
	const alias: Record<string, string> = { golang: 'Go', c: 'C' };
	const found = SUPPORTED_LANGUAGES.find(l => l.slug === lang);
	return found ? found.displayName : alias[lang] || lang;
}

/** 静态数据题目 → openProblem 命令参数 */
function buildQuestion(q: Hot100Question): Question {
	return {
		frontendQuestionId: q.frontendQuestionId,
		title: q.titleCn,
		titleSlug: q.titleSlug,
		difficulty: q.difficulty,
		status: null
	};
}

/**
 * 解析目标工作区：优先 relatedPath（当前题解/笔记文件等）所在的工作区，
 * 其次当前活动编辑器所在的工作区（多根工作区时写入"当前正在做"的目录），
 * 均无匹配时回退第一个工作区；无工作区返回 undefined
 */
function resolveTargetWorkspaceFolder(relatedPath?: string): vscode.WorkspaceFolder | undefined {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) {
		return undefined;
	}
	const candidates: string[] = [];
	if (typeof relatedPath === 'string' && relatedPath) {
		candidates.push(relatedPath);
	}
	const activePath = vscode.window.activeTextEditor?.document.uri.fsPath;
	if (activePath) {
		candidates.push(activePath);
	}
	// Windows 路径大小写不敏感：盘符/目录大小写差异（d:\ vs D:\）需归一后再比较，
	// 否则匹配失败会错误回退到第一个工作区（符号链接/映射盘仍无法完美区分，属残余限制）
	const normalize = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s).replace(/[\\/]+$/, '');
	for (const p of candidates) {
		const np = normalize(p);
		const match = folders.find(f => {
			const root = normalize(f.uri.fsPath);
			return np === root || np.startsWith(root + '\\') || np.startsWith(root + '/');
		});
		if (match) {
			return match;
		}
	}
	return folders[0];
}

export function activate(context: vscode.ExtensionContext) {
	// 在扩展端加载 vendored highlight.js，题解代码高亮不依赖网络与 webview 脚本
	initHighlightJs(context);

	const authManager = new AuthManager(context);
	const leetCodeApi = new LeetCodeApi(authManager);
	const hot100Provider = new Hot100Provider(leetCodeApi, context.globalState);

	// 侧栏状态筛选（未做/已解决/尝试过），点击总进度行或命令面板均可触发
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.setStatusFilter', async () => {
		const FILTERS: { label: string; description: string; value: StatusFilter }[] = [
			{ label: '全部', description: '取消筛选，显示所有题目', value: 'all' },
			{ label: '未做', description: '尚未尝试过的题目', value: 'not_started' },
			{ label: '尝试过', description: '运行/提交未通过', value: 'attempted' },
			{ label: '已解决', description: '提交通过（AC）', value: 'solved' }
		];
		const pick = await vscode.window.showQuickPick(FILTERS, { title: '状态筛选' });
		if (pick) {
			hot100Provider.setStatusFilter(pick.value);
		}
	}));

	// 侧栏分组方式（按分类/按难度），点击侧栏标题按钮或命令面板均可触发；选择持久化
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.setGroupBy', async () => {
		const current = hot100Provider.currentGroupBy;
		const GROUPS: { label: string; description: string; value: GroupByMode }[] = [
			{ label: '按分类', description: '官网默认：哈希 / 链表 / 动态规划等', value: 'category' },
			{ label: '按难度', description: '简单 / 中等 / 困难，同难度按题号升序', value: 'difficulty' }
		];
		const pick = await vscode.window.showQuickPick(GROUPS, {
			title: `侧栏分组方式（当前：${current === 'difficulty' ? '按难度' : '按分类'}）`
		});
		if (pick) {
			hot100Provider.setGroupBy(pick.value);
		}
	}));

	// 搜索题目：题号/中文名/英文名/分类模糊检索，回车打开
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.searchProblem', async () => {
		const items = hot100Provider.allWithMeta().map(m => ({
			label: `${m.paidOnly ? '🔒' : ''}${m.isFavorite ? '⭐' : ''}[${m.q.frontendQuestionId} · ${m.difficulty ? DIFFICULTY_ZH[m.difficulty] : ''}] ${m.q.titleCn}`,
			description: `${m.q.titleEn} · ${categoryLabel(m.q.category)}`,
			detail: m.status === 'ac' ? '已解决' : m.status === 'notac' ? '尝试过' : '未做',
			q: m.q
		}));
		const pick = await vscode.window.showQuickPick(items, {
			title: '搜索 Hot 100 题目',
			placeHolder: '输入题号 / 中文名 / 英文名 / 分类（如 两数之和、two-sum、哈希）',
			matchOnDescription: true,
			matchOnDetail: true
		});
		if (pick) {
			await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(pick.q));
		}
	}));

	// 随机抽题：全部 / 未做优先 / 按难度 / 随机错题
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.randomProblem', async () => {
		const MODES = [
			{ label: '随机一题（全部 100 题）', value: 'all' },
			{ label: '随机一题（未做优先）', value: 'not_started' },
			{ label: '随机简单题', value: 'EASY' },
			{ label: '随机中等题', value: 'MEDIUM' },
			{ label: '随机困难题', value: 'HARD' },
			{ label: '随机错题（错题回顾队列，到期的优先）', value: 'wrong' }
		];
		const mode = await vscode.window.showQuickPick(MODES, { title: '随机抽题' });
		if (!mode) {
			return;
		}
		if (mode.value === 'wrong') {
			const wrongs = hot100Provider.currentWrongList();
			if (wrongs.length === 0) {
				vscode.window.showInformationMessage('错题回顾队列为空，先去提交几道题吧');
				return;
			}
			const now = Date.now();
			let due = wrongs.filter(w => isReviewDue(w, now));
			if (due.length === 0) {
				due = wrongs;
			}
			const entry = due[Math.floor(Math.random() * due.length)];
			const q = HOT_100_LIST.find(x => x.titleSlug === entry.titleSlug);
			if (!q) {
				return;
			}
			await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(q));
			return;
		}
		const meta = hot100Provider.allWithMeta();
		let pool = meta;
		if (mode.value === 'not_started') {
			pool = meta.filter(m => m.status === null);
		} else if (mode.value !== 'all') {
			pool = meta.filter(m => m.difficulty === mode.value);
		}
		if (pool.length === 0) {
			vscode.window.showInformationMessage('没有符合条件的题目');
			return;
		}
		const chosen = pool[Math.floor(Math.random() * pool.length)].q;
		await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(chosen));
	}));

	// 每日一题：按日期从 Hot 100 中确定性随机抽一题（每天固定一题、跨天轮换，
	// 无需登录/网络；不再用官网今日题目，避免抽到 Hot 100 之外的题）
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.dailyQuestion', async () => {
		const daily = pickDailyQuestion(localDateStr());
		vscode.window.showInformationMessage(
			`每日一题（Hot 100 随机）：${daily.frontendQuestionId}. ${daily.titleCn}（${isDifficultyLevel(daily.difficulty) ? DIFFICULTY_ZH[daily.difficulty] : daily.difficulty}）`
		);
		await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(daily));
	}));

	// 提交历史：最近 20 条，选中后可恢复代码到本地（跨设备同步）或在浏览器打开提交页
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.viewSubmissions', async () => {
		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表打开一道题目，再查看提交历史');
			return;
		}
		let problem = currentProblem;
		const editor = await getProblemCodeEditor(context);
		if (editor) {
			problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);
		}
		if (!problem) {
			return;
		}
		try {
			const subs = await leetCodeApi.getSubmissions(problem.titleSlug, SUBMISSION_LIST_LIMIT);
			if (subs.length === 0) {
				vscode.window.showInformationMessage('该题暂无提交记录（在线提交过的代码会保存在云端，换设备登录后可恢复）');
				return;
			}
			const items = subs.map(s => ({
				label: `${SUBMISSION_STATUS_ZH[s.statusDisplay] || s.statusDisplay || '未知'} · ${langDisplayName(s.lang)}`,
				description: s.timestamp ? formatFailedAt(s.timestamp * 1000) : '',
				detail: [s.runtime, s.memory].filter(Boolean).join(' · ') || undefined,
				sub: { id: s.id, lang: s.lang, url: s.url, statusDisplay: s.statusDisplay }
			}));
			const pick = await vscode.window.showQuickPick(items, {
				title: `${problem.titleSlug} 提交历史（最近 ${subs.length} 条）`,
				placeHolder: '选择一次提交：可恢复代码到本地或打开浏览器'
			});
			if (!pick) {
				return;
			}
			const action = await vscode.window.showQuickPick(
				[
					{
						label: '📥 恢复代码到本地文件',
						description: `保存为 leetcode/${(HOT_100_LIST.find(q => q.titleSlug === problem.titleSlug)?.frontendQuestionId || problem.questionId || '0')}_${problem.titleSlug}.${getExtension(pick.sub.lang)}`
					},
					{ label: '🌐 在浏览器打开提交详情', description: '默认提交页' }
				],
				{ title: `提交 ${pick.sub.id} · ${pick.label.split(' · ')[0]}`, placeHolder: '选择操作' }
			);
			if (!action) {
				return;
			}
			if (!action.label.startsWith('📥')) {
				if (pick.sub.url && pick.sub.url.startsWith('http')) {
					vscode.env.openExternal(vscode.Uri.parse(pick.sub.url));
				}
				return;
			}
			await restoreSubmissionToLocal(context, leetCodeApi, problem, currentProblem, pick.sub);
		} catch (error) {
			vscode.window.showErrorMessage(`获取提交历史失败: ${errMsg(error)}`);
		}
	}));

	// 下一题：按当前分组方式的顺序前进（难度模式下即同难度题号升序的后一题），
	// 已打开非 Hot 100 题（如外部导入的同格式题解文件）时回到第一题
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.nextProblem', async () => {
		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showInformationMessage('请先从题目列表打开一道题目，再使用"下一题"');
			return;
		}
		let problem = currentProblem;
		const editor = await getProblemCodeEditor(context);
		if (editor) {
			problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);
		}
		if (!problem) {
			return;
		}
		const ordered = hot100Provider.ordered();
		const cur = ordered.find(q => q.titleSlug === problem.titleSlug);
		const next = nextQuestion(ordered, cur?.frontendQuestionId ?? '');
		if (!next) {
			vscode.window.showInformationMessage('这已是当前分组顺序的最后一题');
			return;
		}
		await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(next));
	}));

	// 每日刷题目标设置（刷题统计节点"今日目标"行也可点击进入）
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.setDailyGoal', async () => {
		const cfg = vscode.workspace.getConfiguration('leetcode');
		const current = cfg.get<number>('dailyGoal', 3);
		const input = await vscode.window.showInputBox({
			title: '每日刷题目标',
			prompt: '每日通过的题数目标（1-50 的整数）',
			value: String(current),
			validateInput: value => {
				const n = Number(value);
				return Number.isInteger(n) && n >= 1 && n <= 50 ? undefined : '请输入 1-50 之间的整数';
			}
		});
		if (input === undefined) {
			return;
		}
		await cfg.update('dailyGoal', Number(input), vscode.ConfigurationTarget.Global);
		hot100Provider.rerender();
	}));

	// 收藏/取消收藏（本地收藏，右键题目行或命令面板；命令面板时按当前题目解析）
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.toggleFavorite', async (item?: any) => {
		let id: string | undefined = item?.question?.frontendQuestionId;
		if (!id) {
			const currentProblem = context.workspaceState.get<any>('currentProblem');
			if (currentProblem) {
				let problem = currentProblem;
				const editor = await getProblemCodeEditor(context);
				if (editor) {
					problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);
				}
				if (!problem) {
					return;
				}
				id = HOT_100_LIST.find(q => q.titleSlug === problem.titleSlug)?.frontendQuestionId;
			}
		}
		if (!id) {
			vscode.window.showInformationMessage('请先从题目列表打开一道题目，再收藏/取消收藏');
			return;
		}
		const fav = hot100Provider.toggleFavorite(id);
		const q = HOT_100_LIST.find(x => x.frontendQuestionId === id);
		vscode.window.showInformationMessage(`${q ? q.titleCn : '题目'}${fav ? ' ⭐ 已收藏' : ' 已取消收藏'}`);
	}));

	// 题目笔记：leetcode/notes/{题号}_{slug}.md，不存在时生成模板（思路/复杂度/备注）
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.openNote', async (item?: any) => {
		const currentProblem = context.workspaceState.get<any>('currentProblem');
		let frontendQuestionId: string | undefined = item?.question?.frontendQuestionId;
		let titleSlug: string | undefined = item?.question?.titleSlug;
		let difficulty: string = item?.question?.difficulty || '';
		if (!titleSlug) {
			if (!currentProblem) {
				vscode.window.showInformationMessage('请先从题目列表打开一道题目，或在题目行右键「打开笔记」');
				return;
			}
			let problem = currentProblem;
			const editor = await getProblemCodeEditor(context);
			if (editor) {
				problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);
			}
			if (!problem) {
				return;
			}
			const q = HOT_100_LIST.find(x => x.titleSlug === problem.titleSlug);
			frontendQuestionId = q?.frontendQuestionId;
			titleSlug = problem.titleSlug;
			difficulty = q?.difficulty || '';
		}
		if (!titleSlug) {
			return;
		}
		const ws = resolveTargetWorkspaceFolder();
		if (!ws) {
			vscode.window.showErrorMessage('请先打开一个工作区文件夹');
			return;
		}
		const idPart = frontendQuestionId ? `${frontendQuestionId}_` : '';
		const notesDir = vscode.Uri.joinPath(ws.uri, 'leetcode', 'notes');
		const noteUri = vscode.Uri.joinPath(notesDir, `${idPart}${titleSlug}.md`);
		try {
			await vscode.workspace.fs.createDirectory(notesDir);
			let exists = true;
			try {
				await vscode.workspace.fs.stat(noteUri);
			} catch (e) {
				exists = false;
			}
			if (!exists) {
				const q = HOT_100_LIST.find(x => x.titleSlug === titleSlug);
				const diffZh = isDifficultyLevel(difficulty) ? DIFFICULTY_ZH[difficulty] : difficulty || '';
				const heading = q ? `${q.frontendQuestionId}. ${q.titleCn}（${diffZh}）` : titleSlug;
				const template = `# ${heading}\n\n<!-- 思路、复杂度、踩坑记录 -->\n\n## 思路\n\n\n## 复杂度\n\n- 时间：\n- 空间：\n\n## 备注\n\n`;
				await vscode.workspace.fs.writeFile(noteUri, Buffer.from(template, 'utf8'));
			}
			const doc = await vscode.workspace.openTextDocument(noteUri);
			await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
		} catch (error) {
			vscode.window.showErrorMessage(`打开笔记失败: ${errMsg(error)}`);
		}
	}));

	// 复习错题：按到期顺序逐题打开（到期的优先），今日已复习记录跨会话保存（按日期重置），全部复习完提示
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.reviewWrong', async () => {
		const wrongs = hot100Provider.currentWrongList();
		if (wrongs.length === 0) {
			vscode.window.showInformationMessage('错题回顾队列为空，提交失败后会自动记录');
			return;
		}
		const REVIEW_KEY = 'hot100ReviewedToday';
		let rec = context.globalState.get<{ date: string; slugs: string[] }>(REVIEW_KEY, { date: '', slugs: [] });
		if (!Array.isArray(rec?.slugs) || rec.date !== localDateStr()) {
			rec = { date: localDateStr(), slugs: [] };
		}
		const res = pickReviewCandidate(wrongs, rec.slugs);
		const entry = res.entry;
		if (!entry) {
			if (res.reviewedCount >= res.total) {
				vscode.window.showInformationMessage(`今日错题已全部复习完成 🎉（共 ${res.total} 题）`);
			} else {
				vscode.window.showInformationMessage(`暂无到期待复习的错题（今日已复习 ${res.reviewedCount}/${res.total}，其余未到期）`);
			}
			return;
		}
		rec.slugs = [...rec.slugs, entry.titleSlug];
		// 今日已复习记录为 best-effort 缓存：写入失败不阻断复习流（题目照常打开）
		try {
			await context.globalState.update(REVIEW_KEY, rec);
		} catch (e) {
			console.error(`[reviewWrong] 记录今日复习进度失败: ${errMsg(e)}`);
		}
		const q = HOT_100_LIST.find(x => x.titleSlug === entry.titleSlug);
		if (q) {
			await vscode.commands.executeCommand('leetcode.openProblem', buildQuestion(q));
		} else {
			vscode.window.showWarningMessage(`错题「${entry.title}」不在 Hot 100 列表中，无法直接打开`);
			return;
		}
		vscode.window.showInformationMessage(`复习错题：${q.titleCn}（今日第 ${res.reviewedCount + 1}/${res.total} 题）`);
	}));

	// 清空错题回顾队列
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.clearWrongQueue', async () => {
		const choice = await vscode.window.showWarningMessage('清空错题回顾队列？', '清空');
		if (choice === '清空') {
			hot100Provider.clearWrongQueue();
		}
	}));

	// 服务端判定会话失效时主动提示重新登录（toast 内建限频，避免每个过期请求都弹）
	leetCodeApi.onSessionExpired(() => notifySessionExpired());

	// 已存 Cookie 时后台校验一次会话有效性：覆盖"上次存的 Cookie 本次启动已过期、
	// 但用户还没触发任何需要登录的操作"的空窗（校验失败/网络异常静默，不打扰）
	void (async () => {
		if (!(await authManager.isLoggedIn())) {
			return;
		}
		try {
			const profile = await leetCodeApi.getUserProfile();
			if (!profile?.data?.userStatus?.isSignedIn) {
				notifySessionExpired();
			}
		} catch {
			/* 网络异常或未登录提示已给，静默 */
		}
	})();

	vscode.window.registerTreeDataProvider('leetcode-hot100', hot100Provider);

	// 创建状态栏项显示登录状态
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.command = 'leetcode.login';
	context.subscriptions.push(statusBarItem);
	context.subscriptions.push(errorDiagnostics);
	context.subscriptions.push(judgeOutputChannel);
	context.subscriptions.push(judgeStatusBar);
	// 扩展停用时关闭已打开的题面/题解面板（Map 里只保留活跃面板的语义靠 onDidDispose 维护）
	context.subscriptions.push({ dispose: () => { problemPanels.forEach(p => p.dispose()); } });
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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;">
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
					<strong>浏览器一键登录（推荐）</strong>
					<div class="hint">将用系统的 Edge/Chrome 打开 LeetCode 登录窗口——一个全新的<strong>隔离临时配置</strong>，仅用于本次登录，完成后立即删除；插件不经手你的账号密码，也不读取日常浏览器数据，登录完成后仅读取 leetcode.cn 的两条会话 Cookie。</div>
					<div class="hint">提示：若页面出现"安全验证失败"，推荐在登录窗口内改用<strong>扫码登录</strong>（LeetCode App 扫一扫，不走滑块验证）。</div>
					<button id="autoBtn" onclick="autoLogin()">🌐 打开浏览器自动登录</button>
					<div id="autoStatus"></div>
				</div>

				<details id="manualArea">
					<summary><strong>手动粘贴 Cookie 登录</strong>（自动登录不可用时的兜底）</summary>

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
						<input type="text" id="sessionInput" placeholder="粘贴 LEETCODE_SESSION 的值（一长串字符），或整段 Cookie" />
						<div class="hint">这是一个很长的字符串，通常以 eyJ 开头；也可以把浏览器里整段 Cookie（含 LEETCODE_SESSION= 与 csrftoken=）直接粘到任一输入框，自动拆分</div>

						<label for="csrfInput">csrftoken 的值：</label>
						<input type="text" id="csrfInput" placeholder="粘贴 csrftoken 的值（已整段粘贴则可留空）" />
						<div class="hint">这是一个较短的字符串</div>

						<br>
						<button onclick="submitCookie()">确认登录</button>
						<div id="message"></div>
					</div>
				</details>

				<script>
					const vscode = acquireVsCodeApi();

					function autoLogin() {
						document.getElementById('autoBtn').disabled = true;
						setAutoStatus('正在启动浏览器…', 'hint');
						vscode.postMessage({ type: 'autoLogin' });
					}

					function setAutoStatus(html, cls) {
						document.getElementById('autoStatus').innerHTML = '<span class="' + cls + '">' + html + '</span>';
					}

					function openLeetCode() {
						vscode.postMessage({ type: 'openBrowser' });
					}

					function submitCookie() {
						const session = document.getElementById('sessionInput').value.trim();
						const csrf = document.getElementById('csrfInput').value.trim();

						if (!session && !csrf) {
							document.getElementById('message').innerHTML = '<span class="error">请粘贴 LEETCODE_SESSION 与 csrftoken 的值（或整段 Cookie）</span>';
							return;
						}
						// 原样传给扩展端统一解析：裸值两列照常组装；
						// 整段 Cookie 粘贴（含 KEY=VALUE）由扩展端按键名自动拆分
						document.getElementById('message').innerHTML = '<span class="success">正在验证...</span>';
						vscode.postMessage({ type: 'login', session: session, csrf: csrf });
					}

					// 扩展端回推的自动登录状态
					window.addEventListener('message', (event) => {
						const msg = event.data;
						if (!msg || msg.type !== 'autoStatus') {
							return;
						}
						setAutoStatus(msg.text, msg.kind || 'hint');
						document.getElementById('autoBtn').disabled = (msg.state === 'running');
						if (msg.openManual) {
							document.getElementById('manualArea').open = true;
						}
					});
				</script>
			</body>
			</html>
		`;

		// 共享登录收尾（自动/手动两条路径复用）：存 Cookie → 服务端校验 → 成功关面板/失败清态
		const completeLogin = async (cookie: string): Promise<boolean> => {
			try {
				await authManager.setCookie(cookie);
				const profile = await leetCodeApi.getUserProfile();
				// 适配新的 userStatus API 响应
				if (profile && profile.data && profile.data.userStatus && profile.data.userStatus.isSignedIn) {
					const user = profile.data.userStatus;
					vscode.window.showInformationMessage(`登录成功！欢迎 ${user.realName || user.username}`);
					panel.dispose();
					return true;
				}
				vscode.window.showErrorMessage('登录失败：Cookie 无效或已过期，请重新获取');
				await authManager.logout();
				return false;
			} catch (error) {
				vscode.window.showErrorMessage(`登录失败: ${errMsg(error)}`);
				await authManager.logout();
				return false;
			}
		};

		// 自动登录并发保护 + 面板关闭联动（用户关掉登录面板 → 终止等待并关闭浏览器窗口）
		let autoLoginRunning = false;
		let loginPanelDisposed = false;
		panel.onDidDispose(() => { loginPanelDisposed = true; });

		// 处理Webview消息
		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'openBrowser') {
				vscode.env.openExternal(vscode.Uri.parse('https://leetcode.cn/accounts/login/'));
			} else if (message.type === 'login') {
				// 两列裸值照常组装；整段 Cookie 粘贴（含 KEY=VALUE）自动按键名拆分
				const cookie = buildLeetCodeCookie(message.session || '', message.csrf || '');
				if (!cookie) {
					vscode.window.showWarningMessage('未能从粘贴内容解析出 LEETCODE_SESSION 与 csrftoken，请分别粘贴两个值，或把整段 Cookie 粘到任一输入框');
					return;
				}
				await completeLogin(cookie);
			} else if (message.type === 'autoLogin') {
				if (autoLoginRunning) {
					return;
				}
				autoLoginRunning = true;
				const post = (state: 'running' | 'idle', text: string, kind?: string, openManual?: boolean) => {
					void panel.webview.postMessage({ type: 'autoStatus', state, text, kind, openManual });
				};
				try {
					// 优先用系统默认浏览器（仅 Edge/Chrome 可被驱动接管）；默认是 Firefox/其他
					// Chromium 分支（Tabbit/Opera 等）时回退到已装的标准 Edge/Chrome 并提示原因
					const def = detectDefaultBrowser((cmd, args) => {
						const r = spawnSync(cmd, args, { encoding: 'utf8' });
						return { status: r.status, stdout: r.stdout || '' };
					});
					const channel = def.kind === 'chromium' ? def.channel : pickChromiumChannel(fs.existsSync, process.platform, process.env);
					if (!channel) {
						post('idle', '未检测到 Microsoft Edge 或 Google Chrome，无法自动打开登录窗口，请使用下方手动粘贴方式。', 'error', true);
						return;
					}
					if (def.kind === 'other') {
						post('running', `默认浏览器（${def.hint}）无法被自动接管，改用系统 ${channel === 'msedge' ? 'Edge' : 'Chrome'} 打开登录窗口…`);
					} else {
						post('running', def.kind === 'chromium' ? `正在用默认浏览器（${channel === 'msedge' ? 'Edge' : 'Chrome'}）启动登录窗口…` : '正在启动浏览器…');
					}
					const result = await loginWithBrowser({
						channel,
						// vendor 副本随扩展打包（vsce 带 --no-dependencies，不用 node_modules），
						// 仅登录时按需加载，不影响扩展激活耗时
						requirePlaywright: () => require(path.join(context.extensionPath, 'vendor/playwright-core')),
						onStatus: (s) => {
							if (s === 'launching') {
								// 渠道来源文案（默认浏览器/回退）已在启动前发过，此处不覆盖
							} else if (s === 'waiting-login') {
								post('running', '浏览器窗口已打开，请在窗口中完成登录（支持密码/扫码/第三方）。若提示"安全验证失败"，建议点登录框下方的二维码图标改用 App 扫码登录（不经过滑块验证）…');
							} else {
								post('running', '已获取登录信息，正在收尾…', 'success');
							}
						},
						isAborted: () => loginPanelDisposed
					});
					if (result.status === 'success' && result.cookie) {
						const ok = await completeLogin(result.cookie);
						if (!ok && !loginPanelDisposed) {
							post('idle', '登录校验未通过，可重试自动登录，或使用手动粘贴方式。', 'error', true);
						}
					} else if (result.status === 'canceled') {
						post('idle', '自动登录已取消（登录窗口被关闭）。可重试，或使用手动粘贴方式。', 'hint', true);
					} else if (result.status === 'timeout') {
						post('idle', '等待登录超时（10 分钟）。可重试，或使用手动粘贴方式。', 'error', true);
					} else {
						post('idle', '启动浏览器失败：' + (result.message || '未知错误') + '。请使用手动粘贴方式。', 'error', true);
					}
				} finally {
					autoLoginRunning = false;
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
	const openProblemDisposable = vscode.commands.registerCommand('leetcode.openProblem', async (question: Question, opts?: { tab?: 'problem' | 'solution' }) => {
		const initialTab: 'problem' | 'solution' = opts?.tab === 'solution' ? 'solution' : 'problem';
		// 每题只允许一个题面页：已有面板直接聚焦（同步判断，先于任何网络请求），
		// 再用同步占位拦住快速双击的第二个调用
		const panelKey = String(question.titleSlug);
		const existingPanel = problemPanels.get(panelKey);
		if (existingPanel) {
			existingPanel.reveal(vscode.ViewColumn.Two);
			return;
		}
		if (pendingProblemOpens.has(panelKey)) {
			return;
		}
		pendingProblemOpens.add(panelKey);
		try {
			const data = await leetCodeApi.getQuestionContent(question.titleSlug);
			if (data && data.data && data.data.question) {
				const q = data.data.question;

// 获取目标工作区（多根工作区时优先当前活动编辑器所在目录，避免写错目录）
					const targetWorkspace = resolveTargetWorkspaceFolder();
					if (!targetWorkspace) {
						vscode.window.showErrorMessage('请先打开一个工作区文件夹');
						return;
					}
					const workspaceFolder = targetWorkspace.uri.fsPath;

				// 已存在题解文件（如 1_two-sum.py）时跳过语言选择器，直接按已有的文件继续；
				// 没有任何语言的文件时才让用户选语言（首次做题）
				const preferredLangs = ['python3', 'java', 'cpp', 'javascript', 'typescript', 'go', 'rust', 'c'];
				let langSlug: string | null = null;
				let snippetCode = '';
				for (const lang of preferredLangs) {
					const candidate = vscode.Uri.file(`${workspaceFolder}/leetcode/${q.questionFrontendId}_${q.titleSlug}.${getExtension(lang)}`);
					try {
						await vscode.workspace.fs.stat(candidate);
						langSlug = lang;
						break;
					} catch {
						// 该语言的文件不存在，检查下一种
					}
				}
				if (langSlug === null) {
					// 跨设备同步：本机无该题代码文件、云端有历史提交时先询问是否恢复
					const restoredLang = await tryRestoreOnOpen(context, leetCodeApi, q, workspaceFolder);
					if (restoredLang) {
						langSlug = restoredLang;
					} else {
						const selectedLanguage = await selectLanguage(q.codeSnippets);
						if (!selectedLanguage) {
							return; // 用户取消了选择
						}
						langSlug = selectedLanguage.langSlug;
						snippetCode = selectedLanguage.code;
					}
				}

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
					const content = Buffer.from(snippetCode, 'utf8');
					await vscode.workspace.fs.writeFile(fileUri, content);
				}

				// 打开代码文件
				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

				// 存储当前题目信息用于提交
				await context.workspaceState.update('currentProblem', {
					titleSlug: q.titleSlug,
					questionId: q.questionId,
					lang: langSlug,
					filePath: fileUri.fsPath,
					testCases: q.exampleTestcases || q.sampleTestCase
				});

				// 创建题目描述面板（每题唯一，key 为命令入口登记的 titleSlug）
				const panel = vscode.window.createWebviewPanel(
					'leetcodeProblem',
					`${q.questionFrontendId}. ${q.translatedTitle || q.title}`,
					vscode.ViewColumn.Two,
					{ enableScripts: true, localResourceRoots: [vscode.Uri.file(context.extensionPath), context.globalStorageUri] }
				);
				problemPanels.set(panelKey, panel);
				panel.onDidDispose(() => problemPanels.delete(panelKey));

				// 使用中文内容（translatedContent），如果没有则使用英文
				let questionContent = q.translatedContent || q.content;
				const title = q.translatedTitle || q.title;
				const difficulty = difficultyZhOf(String(q.difficulty || '')) || q.difficulty;

				// 生成带标签页的面板HTML

					// 题目内容中的外链图片下载到本地缓存（webview 直连外部图可能失败）
					questionContent = await localizeContentImages(questionContent, panel, context, leetCodeApi);
					safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem'));

				// 处理消息（外层兜底：任何异常都提示用户，避免静默失败）
				panel.webview.onDidReceiveMessage(async (message: PanelToExtensionMessage) => {
					try {
						await handlePanelMessage(message, panel, q);
					} catch (error) {
						vscode.window.showErrorMessage(`处理操作失败: ${errMsg(error)}`);
					}
				});

				// viewSolution 入口直达题解页：面板就绪后立即触发一次题解加载（与面板内消息同款流程）
				if (initialTab === 'solution') {
					void handlePanelMessage({ type: 'loadSolution' } as PanelToExtensionMessage, panel, q);
				}

				/**
				 * 面板消息统一分发（题面/题解合一面板的全部消息；抽出便于外层统一兜底错误提示）
				 */
				async function handlePanelMessage(message: PanelToExtensionMessage, panel: vscode.WebviewPanel, q: any) {
					if (message.type === 'loadSolution') {
						// 刷新：先立即渲染缓存内容，后台重取；网络慢/波动时不再长时间挂在"加载题解中"
						const cachedSolution = solutionHtmlCache.get(q.titleSlug);
						if (cachedSolution) {
							safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', cachedSolution));
						}
						const loadStart = Date.now();
						const stepLog = (label: string) => { console.log(`[loadSolution ${q.titleSlug}] ${label}: ${Date.now() - loadStart}ms`); };
						try {
								await withTimeout((async () => {
// 官方题解与社区题解列表并行拉取，避免串行叠加等待
								const [officialData, communityData] = await Promise.all([
									leetCodeApi.getOfficialSolution(q.titleSlug),
									leetCodeApi.getSolutionArticles(q.titleSlug, 0, 10)
								]);
								const officialSolution = officialData?.data?.question?.solution;
								const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];
								stepLog('fetch list');

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
												const articleAuthor = article.author?.profile?.realName || article.author?.username || 'LeetCode';
												const articleAvatar = article.author?.profile?.userAvatar || '';
												const articleDate = article.createdAt ? formatArticleDate(article.createdAt) : '';
												officialArticleHtml = `
													<div class="solution-section">
														<h2>📖 官方题解</h2>
														<div class="article-head">
															${articleAvatar ? `<img class="article-avatar" src="${escapeHtml(articleAvatar)}" alt="" onerror="this.remove()" />` : ''}
															<span>${escapeHtml(articleAuthor)}</span>
															<span class="article-badge">👑 官方</span>
															${articleDate ? `<span>${articleDate}</span>` : ''}
															<span>👍 ${article.upvoteCount}</span>
														</div>
														<div class="solution-content">${renderMarkdownToHtml(cleanedContent, 'all', true, solutionPageUrl)}</div>
													</div>
												`;
										}
									} catch (e) {
										// 官方文章拉取失败时静默跳过，回退到 question.solution 的文字内容
									}
								}
								stepLog('official article');

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
										<div class="article-item" data-slug="${escapeHtml(article.slug)}">
											<div class="article-title">${escapeHtml(article.title)}</div>
											<div class="article-meta">${tags}👍 ${escapeHtml(String(article.upvoteCount ?? ''))} | 作者: ${escapeHtml(author)}</div>
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
													const topAvatar = topArticle.author?.profile?.userAvatar || '';
													const topDate = topArticle.createdAt ? formatArticleDate(topArticle.createdAt) : '';
													const topArticleHtml = renderMarkdownToHtml(cleanedTop, 'all');
												solutionHtml += `
													<div class="solution-section">
														<h2>⭐ 社区精选题解（含代码）</h2>
														<div class="article-head">
															${topAvatar ? `<img class="article-avatar" src="${escapeHtml(topAvatar)}" alt="" onerror="this.remove()" />` : ''}
															<span>${escapeHtml(topAuthor)}</span>
															${topDate ? `<span>${topDate}</span>` : ''}
															<span>👍 ${topArticle.upvoteCount}</span>
														</div>
														<div class="solution-content">${topArticleHtml}</div>
													</div>
												`;
										}
									} catch (e) {
										// 拉取精选题解失败时静默跳过，不影响其余内容
									}
								}
								stepLog('community pick');

								if (!solutionHtml) {
									solutionHtml = '<div class="loading">暂无题解</div>';
								}

								solutionHtml = await localizeContentImages(solutionHtml, panel, context, leetCodeApi);
								stepLog('localize');
								// 内容与缓存一致时跳过二次赋值（首个赋值已带 nonce 渲染缓存），避免连续两次全页刷新闪烁
								if (solutionHtml === cachedSolution) {
									stepLog('same content, page already shown');
								} else {
									solutionHtmlCache.set(q.titleSlug, solutionHtml);
									safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', solutionHtml));
								}
								stepLog('done');
							})(), 60000, '题解加载超时（60 秒）');
						} catch (error) {
							// 有缓存：保留缓存内容并提示；无缓存：展示错误页（错误页生成再失败则退回最小页面）
							const failMsg = errMsg(error);
							if (cachedSolution) {
								vscode.window.showWarningMessage(`题解刷新失败，已保留上次内容：${failMsg}`);
								return;
							}
							console.error(`[loadSolution ${q.titleSlug}] FAILED:`, error);
							try {
								safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', `<div class="loading">加载题解失败: ${escapeHtml(failMsg)}</div>`));
							} catch (e2) {
								safeSetHtml(panel, `<!DOCTYPE html><html><body><div class="loading">加载题解失败: ${escapeHtml(failMsg)}</div></body></html>`);
							}
						}
} else if (message.type === 'reloadProblem') {
							// 右键刷新题目描述：重新拉取题目内容（KaTeX/CDN 加载失败时重建页面即可恢复）
							try {
								const freshData = await leetCodeApi.getQuestionContent(q.titleSlug);
								const fresh = freshData?.data?.question;
								if (fresh) {
									Object.assign(q, fresh);
									questionContent = fresh.translatedContent || fresh.content;
								}
								safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem'));
							} catch (error) {
								vscode.window.showErrorMessage(`刷新题目描述失败: ${errMsg(error)}`);
								safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem'));
							}
						} else if (message.type === 'playVideo') {
							try {
								const uuid = typeof message.uuid === 'string' ? message.uuid.trim() : '';
								if (!/^[0-9a-fA-F-]{20,40}$/.test(uuid)) {
									throw new Error('无效的视频标识');
								}
const playHolder: { value: { videoUrl: string; videoId: string; coverUrl: string; playAuth: string; audioB64?: string } | null } = { value: null };
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
								// 缓存文件名用的 videoId 加白名单（防路径穿越；接口值不直接信任）
								const videoId = String(meta.videoInfo.videoId).replace(/[^A-Za-z0-9_-]/g, '');
								if (!videoId) {
									throw new Error('无效的视频标识');
								}
const mp4Uri = vscode.Uri.joinPath(dirUri, videoId + '_v3.mp4');
									const mp3Uri = vscode.Uri.joinPath(dirUri, videoId + '_v3.mp3');
									const tsUri = vscode.Uri.joinPath(dirUri, videoId + '.ts');
								let mp4Stat: vscode.FileStat | null = null;
								let mp3Stat: vscode.FileStat | null = null;
								try {
									mp4Stat = await vscode.workspace.fs.stat(mp4Uri);
								} catch (e) {
									mp4Stat = null;
								}
								try {
									mp3Stat = await vscode.workspace.fs.stat(mp3Uri);
								} catch (e) {
									mp3Stat = null;
								}
								if (!mp4Stat || mp4Stat.size === 0 || !mp3Stat || mp3Stat.size === 0) {
									// 1) 取原始 TS：优先已缓存，否则下载合并 HLS 分段
									let tsBuf: Buffer | null = null;
									try {
										tsBuf = Buffer.from(await vscode.workspace.fs.readFile(tsUri));
									} catch (e) {
										tsBuf = null;
									}
									if (!tsBuf || tsBuf.length === 0) {
										const merged = await leetCodeApi.getVideoMergedTs(uuid);
										tsBuf = Buffer.isBuffer(merged.buffer) ? merged.buffer : Buffer.from(merged.buffer);
										await vscode.workspace.fs.writeFile(tsUri, new Uint8Array(tsBuf));
									}
	// 2) 扩展端 ffmpeg 转码。画面：MP4 仅视频流（-an）；声音：MP3 提取——Chromium 对
									// <video> 音频输出在 VS Code autoplayPolicy 下静默（none-decoded），声音统一
									// 改由 webview WebAudio 解码播放（decodeAudioData 对 mp3 100% 支持，
									// 且经 postMessage base64 传输，不依赖 fetch/CORS）
									const core = await getFfmpegCore(context);
									try {
										core.FS.writeFile('/in.ts', new Uint8Array(tsBuf));
										if (!mp4Stat || mp4Stat.size === 0) {
											const rc1 = core.exec('-i', '/in.ts', '-c:v', 'copy', '-an', '-movflags', '+faststart', '/out.mp4');
											const out1 = core.FS.readFile('/out.mp4');
											try { core.FS.deleteFile('/out.mp4'); } catch (e2) { /* 忽略清理失败 */ }
											if (rc1 !== 0 || !out1 || out1.length < 1024) {
												throw new Error('画面转码返回码 ' + rc1 + ' 输出 ' + (out1 ? out1.length : 0));
											}
											await vscode.workspace.fs.writeFile(mp4Uri, new Uint8Array(out1));
										}
										if (!mp3Stat || mp3Stat.size === 0) {
											const rc2 = core.exec('-i', '/in.ts', '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-ac', '2', '/out.mp3');
											const out2 = core.FS.readFile('/out.mp3');
											try { core.FS.deleteFile('/out.mp3'); } catch (e2) { /* 忽略清理失败 */ }
											if (rc2 !== 0 || !out2 || out2.length < 1024) {
												throw new Error('音频转码返回码 ' + rc2 + ' 输出 ' + (out2 ? out2.length : 0));
											}
											await vscode.workspace.fs.writeFile(mp3Uri, new Uint8Array(out2));
										}
										try { core.FS.deleteFile('/in.ts'); } catch (e2) { /* 忽略清理失败 */ }
									} catch (e) {
										throw new Error('视频转码失败: ' + (e instanceof Error ? e.message : String(e)));
									}
								}
								let audioB64: string | undefined;
								try {
									audioB64 = Buffer.from(await vscode.workspace.fs.readFile(mp3Uri)).toString('base64');
								} catch (e) {
									audioB64 = undefined;
								}
								playHolder.value = {
									videoUrl: panel.webview.asWebviewUri(mp4Uri).toString(),
									videoId: meta.videoInfo.videoId,
									coverUrl: meta.videoInfo.coverUrl || '',
									playAuth: meta.playAuth,
									audioB64
								};
							});
							const play = playHolder.value;
							if (!play) {
								throw new Error('获取视频失败');
							}
							const readyMsg: ExtensionToPanelMessage = {
								type: 'videoReady',
								videoUrl: play.videoUrl,
								videoId: play.videoId,
								playAuth: play.playAuth,
								coverUrl: play.coverUrl || '',
								audioData: play.audioB64,
								pageUrl: message.pageUrl
							};
							panel.webview.postMessage(readyMsg);
						} catch (error) {
							vscode.window.showWarningMessage(`视频题解加载失败：${errMsg(error) || '未知错误'}`);
							panel.webview.postMessage({ type: 'videoReady', error: true, pageUrl: message.pageUrl } satisfies ExtensionToPanelMessage);
						}
					} else if (message.type === 'videoDebug') {
							console.log('[videoDebug]', message.info);
							if (typeof message.info === 'string' && message.info.indexOf('AUDIO_PROBLEM') !== -1) {
								vscode.window.showWarningMessage('视频音频轨解析失败，请反馈此问题');
							} else if (typeof message.info === 'string' && message.info.indexOf('AUDIO_DIAG') !== -1) {
								vscode.window.showWarningMessage('视频无声诊断: ' + message.info);
							}
						} else if (message.type === 'openExternal' && typeof message.url === 'string' && message.url.startsWith('https://leetcode.cn/')) {
							// 视频题解等无法在 webview 内播放的内容，交给系统默认浏览器打开
							vscode.env.openExternal(vscode.Uri.parse(message.url));
						} else if (message.type === 'copyCode') {
						await vscode.env.clipboard.writeText(String(message.text || ''));
						vscode.window.showInformationMessage('已复制代码');
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
											<h2>${escapeHtml(article.title)}</h2>
											<div class="article-meta" style="margin-bottom:20px;">👍 ${article.upvoteCount} | 作者: ${escapeHtml(article.author?.profile?.realName || article.author?.username || '匿名')}${article.byLeetcode ? ' | 👑 官方' : ''}</div>
											<div class="solution-content">${renderMarkdownToHtml(cleanedArticle, 'all')}</div>
										</div>
									`;
								articleHtml = await localizeContentImages(articleHtml, panel, context, leetCodeApi);
									safeSetHtml(panel, generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', articleHtml));
							}
						} catch (error) {
							vscode.window.showErrorMessage(`加载题解失败: ${errMsg(error)}`);
						}
					} else if (message.type === 'openSimilarProblem') {
						// 相似题目（可能不在 Hot 100）：复用 openProblem 通用流程（题面/语言/判题均可）
						if (!message.titleSlug) {
							return;
						}
						await vscode.commands.executeCommand('leetcode.openProblem', {
							frontendQuestionId: '',
							title: message.title || '',
							titleSlug: message.titleSlug,
							difficulty: message.difficulty || '',
							status: null
						} as Question);
					}
				}
				} else {
					vscode.window.showErrorMessage('未获取到题面数据（接口返回为空），请稍后重试');
				}
			} catch (error) {
				vscode.window.showErrorMessage(`加载题目失败: ${errMsg(error)}`);
			} finally {
				pendingProblemOpens.delete(panelKey);
			}
	});

	// ==================== 测试 / 提交（共用判题流程） ====================
	// 测试与提交共用：登录检查→按当前文件解析题目→保存→清诊断→占锁→轮询→上报
	async function runJudgeFlow(kind: '测试' | '提交'): Promise<void> {
		const isLoggedIn = await authManager.isLoggedIn();
		if (!isLoggedIn) {
			const login = await vscode.window.showWarningMessage(`您需要先登录才能${kind === '提交' ? '提交代码' : '运行测试'}`, '登录');
			if (login === '登录') {
				vscode.commands.executeCommand('leetcode.login');
			}
			return;
		}
		const editor = await getProblemCodeEditor(context);
		if (!editor) {
			vscode.window.showErrorMessage('请先从题目列表打开一道题目，或聚焦题解代码文件后再试');
			return;
		}
		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}
		// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态导致判题错题
		const problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);
		// 解析失败（返回 null）时已提示：直接中止，防止把当前文件代码判题到错误的题目
		if (!problem) {
			return;
		}
		await editor.document.save();
		const code = editor.document.getText();
		// 重新运行时清除上一次的错误标注
		errorDiagnostics.delete(editor.document.uri);
		// 在途忙碌锁：判题发起前同步占位，防快速连点并发 runCode/重复提交
		if (!tryBeginJudge()) {
			return;
		}
		const budgetSec = Math.round(JUDGE_POLL_BUDGET_MS / 1000);
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: kind === '提交' ? '正在提交到 LeetCode...' : '正在运行测试...',
			cancellable: false
		}, async () => {
			try {
				const result = kind === '提交'
					? await leetCodeApi.submitCode(problem.titleSlug, problem.questionId, problem.lang, code)
					: await leetCodeApi.runCode(problem.titleSlug, problem.questionId, problem.lang, code, problem.testCases || '');
				const judgeId = kind === '提交' ? result.submission_id : result.interpret_id;
				if (!judgeId) {
					// 只弹摘要，完整响应写输出通道（整段大 JSON 弹窗不可读）
					judgeOutputChannel.appendLine(`[${kind}] 发起失败原始响应: ${JSON.stringify(result)}`);
					vscode.window.showErrorMessage(`${kind}失败: ` + oneLine(JSON.stringify(result), 160));
					return;
				}
				const submissionUrl = kind === '提交'
					? `https://leetcode.cn/problems/${problem.titleSlug}/submissions/${judgeId}/`
					: undefined;
				// 轮询获取结果（退避至预算上限，状态栏显示等待时长）
				const check = await pollJudgeResult(leetCodeApi, judgeId);
				if (check) {
					const accepted = kind === '提交'
						? check.status_msg === 'Accepted'
						: !!check.run_success && !!check.correct_answer;
					reportJudgeResult(kind, check, {
						ok: accepted,
						fileUri: editor.document.uri,
						inputFallback: kind === '测试' ? problem.testCases : undefined,
						submissionUrl,
						titleSlug: problem.titleSlug
					});
					if (kind === '提交') {
						// 提交后更新侧栏状态（通过=已解决并移出错题队列，失败=尝试过并记录错题）
						hot100Provider.recordJudgeResult(problem.titleSlug, {
							solved: accepted,
							reason: check.status_msg,
							recordWrong: true
						});
					} else {
						// 测试（含通过）只算"尝试过"，不算"已解决"（以提交结果为准）
						hot100Provider.recordJudgeResult(problem.titleSlug, { solved: false });
					}
				} else if (kind === '提交' && submissionUrl) {
					const choice = await vscode.window.showWarningMessage(
						`提交超时：判题未在 ${budgetSec} 秒内返回，结果可在 LeetCode 提交页查看`,
						'打开提交页'
					);
					if (choice === '打开提交页') {
						vscode.env.openExternal(vscode.Uri.parse(submissionUrl));
					}
				} else {
					vscode.window.showWarningMessage(`测试超时：判题未在 ${budgetSec} 秒内返回，可稍后重试`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`${kind}出错: ${errMsg(error)}`);
			} finally {
				releaseJudge();
			}
		});
	}

	const testDisposable = vscode.commands.registerCommand('leetcode.test', () => runJudgeFlow('测试'));
	const submitDisposable = vscode.commands.registerCommand('leetcode.submit', () => runJudgeFlow('提交'));

	// ==================== 创建调试文件命令 ====================
	const debugDisposable = vscode.commands.registerCommand('leetcode.debug', async () => {
		const editor = await getProblemCodeEditor(context);
		if (!editor) {
			vscode.window.showErrorMessage('请先从题目列表打开一道题目，或聚焦题解代码文件后再试');
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态导致驱动错题
		const problem = await resolveProblemFromFile(
			leetCodeApi,
			context,
			path.basename(editor.document.uri.fsPath),
			currentProblem
		);
		if (!problem) {
			return;
		}

		// 拉取题面以提取各示例的期望输出（本地运行/调试时逐示例比对）
		let expectedOutputs: string[] = [];
		let exampleInputs: unknown[][] = [];
		try {
			const questionData = await leetCodeApi.getQuestionContent(problem.titleSlug);
			const question = questionData?.data?.question;
			const content = question?.translatedContent || question?.content || '';
			expectedOutputs = extractExpectedOutputs(content);
			exampleInputs = extractExampleInputs(content);
		} catch {
			// 拿不到期望输出时仅运行不比对
		}

		await runDebugWithCases(editor, problem, problem.testCases || '', expectedOutputs, false, exampleInputs);
	});

	// ==================== 用判题失败用例本地调试命令 ====================
	const debugFailedDisposable = vscode.commands.registerCommand('leetcode.debugFailedCase', async () => {
		// 读一次判题快照复用（两次读取之间可能插入新判题，导致失败用例与防串题校验来自不同轮）
		const lastJudgeForCase = getLastJudgeCases();
		const failedCases = lastJudgeForCase?.cases?.filter(c => !c.passed && c.known && c.input) ?? [];
		if (failedCases.length === 0) {
			const choice = await vscode.window.showInformationMessage(
				'暂无可用判题失败用例。先运行测试/提交触发失败，或自定义用例测试失败后，可把用例带入本地调试',
				'自定义用例测试'
			);
			if (choice === '自定义用例测试') {
				vscode.commands.executeCommand('leetcode.customTest');
			}
			return;
		}

		const editor = await getProblemCodeEditor(context);
		if (!editor) {
			vscode.window.showErrorMessage('请先从题目列表打开一道题目，或聚焦题解代码文件后再试');
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		const problem = await resolveProblemFromFile(
			leetCodeApi,
			context,
			path.basename(editor.document.uri.fsPath),
			currentProblem
		);
		if (!problem) {
			return;
		}
		// 失败用例来自上次判题的题目；当前文件是另一题时不能混用（防用例套错函数）
		if (lastJudgeForCase?.titleSlug && lastJudgeForCase.titleSlug !== problem.titleSlug) {
			vscode.window.showWarningMessage(
				`上次判题是「${lastJudgeForCase.titleSlug}」，与当前文件的「${problem.titleSlug}」不是同一题，请先打开对应题解文件`
			);
			return;
		}

		let chosen: JudgeCaseInfo;
		if (failedCases.length === 1) {
			chosen = failedCases[0];
		} else {
			const options = failedCases.map(c => ({
				label: `用例 ${c.index}｜输入: ${oneLine(c.input, 60)}`,
				description: c.expected ? `期望: ${oneLine(c.expected, 40)}` : undefined,
				info: c
			}));
			const pick = await vscode.window.showQuickPick(options, { placeHolder: '选择要代入本地调试的失败用例' });
			if (!pick) {
				return;
			}
			chosen = pick.info;
		}

		// 只比对该失败用例的期望值（题面示例期望与自定义用例不按索引对齐，不掺入）
		await runDebugWithCases(editor, problem, chosen.input, chosen.expected ? [chosen.expected] : [], true);
	});

	// ==================== 自定义用例测试命令 ====================
	const customTestDisposable = vscode.commands.registerCommand('leetcode.customTest', async () => {
		// 检查登录状态
		const isLoggedIn = await authManager.isLoggedIn();
		if (!isLoggedIn) {
			const login = await vscode.window.showWarningMessage(
				'您需要先登录才能运行自定义用例测试',
				'登录'
			);
			if (login === '登录') {
				vscode.commands.executeCommand('leetcode.login');
			}
			return;
		}

		// 当前文件就是本命令打开的用例文件：立即以当前内容重跑（编辑保存会自动跑，
		// 想在不改动的情况下再跑一次时用本命令）
		const active = vscode.window.activeTextEditor;
		const activeEntry = active ? customCaseFiles.get(active.document.uri.fsPath) : undefined;
		if (active && activeEntry) {
			await runCustomCaseWith(leetCodeApi, activeEntry.problem, activeEntry.solutionPath, active.document.getText());
			return;
		}

		const currentProblem = context.workspaceState.get<any>('currentProblem');
		if (!currentProblem) {
			vscode.window.showErrorMessage('请先从题目列表中打开一道题目');
			return;
		}

		let problem = currentProblem;
		let solutionPath: string | undefined = currentProblem.filePath;
		const editor = await getProblemCodeEditor(context);
		if (editor) {
			solutionPath = editor.document.uri.fsPath;
			// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态导致用例套错题
			problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(solutionPath), currentProblem);
		}
		if (!problem) {
			return;
		}
		if (!solutionPath) {
			vscode.window.showErrorMessage('请先从题目列表打开一道题目，或聚焦题解代码文件后再试');
			return;
		}

		const dirPath = solutionPath.substring(0, solutionPath.lastIndexOf('\\') !== -1 ? solutionPath.lastIndexOf('\\') : solutionPath.lastIndexOf('/'));
		// 用例文件名以字母开头（customcase_ 前缀），parseProblemFileName 不会误解析它；
		// 每个题目一个文件，复用上次编辑的用例
		const caseDir = path.join(dirPath, 'debug');
		const casePath = path.join(caseDir, `customcase_${problem.questionId || '0'}_${problem.titleSlug}.txt`);

		try {
			await vscode.workspace.fs.createDirectory(vscode.Uri.file(caseDir));
			if (!fs.existsSync(casePath)) {
				// 新建：预填最近一次同题失败用例输入（无则官方示例），用户可直接保存运行
				const lastJudgeForCase = getLastJudgeCases();
				const failedSame = lastJudgeForCase && lastJudgeForCase.titleSlug === problem.titleSlug
					? lastJudgeForCase.cases.filter(c => !c.passed && c.known && c.input)
					: [];
				const prefill = failedSame.length > 0 ? failedSame[0].input : (problem.testCases || '');
				await vscode.workspace.fs.writeFile(vscode.Uri.file(casePath), Buffer.from(prefill, 'utf8'));
			}
			customCaseFiles.set(casePath, { problem, solutionPath });
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(casePath));
			await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
			vscode.window.showInformationMessage(
				'自定义用例文件已就绪（每行一个参数值：如两数之和分两行 [2,7,11,15] 与 9）。\n修改后 Ctrl+S 保存即自动在线判题；再运行本命令可立即重跑'
			);
		} catch (error) {
			vscode.window.showErrorMessage(`创建自定义用例文件失败: ${errMsg(error)}`);
		}
	});

	// ==================== 运行当前文件命令 ====================
	const runDebugDisposable = vscode.commands.registerCommand('leetcode.runDebug', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== 'file') {
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
		let runSteps: string[] = [];

		if (filePath.endsWith('.py')) {
			const currentProblem = context.workspaceState.get<any>('currentProblem');
			// 题解代码文件：生成并运行调试驱动（自动依赖注入 + 按签名解析用例）；
			// 本身就是驱动文件（debug/xxx_debug.py）时直接运行
			if (currentProblem && !fileName.endsWith('_debug.py')) {
				// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态
				const problem = await resolveProblemFromFile(leetCodeApi, context, fileName, currentProblem);
				if (!problem) {
					return;
				}
				// 拉取题面以提取各示例的期望输出（与调试入口一致，便于逐示例比对）
				let expectedOutputs: string[] = [];
				let exampleInputs: unknown[][] = [];
				try {
					const questionData = await leetCodeApi.getQuestionContent(problem.titleSlug);
					const question = questionData?.data?.question;
					const content = question?.translatedContent || question?.content || '';
					expectedOutputs = extractExpectedOutputs(content);
					exampleInputs = extractExampleInputs(content);
				} catch {
					// 拿不到期望输出时仅运行不比对
				}
				const debugDriver = generateDebugFile(
					problem.lang,
					problem.questionId || '0',
					problem.titleSlug,
					problem.testCases || '',
					editor.document.getText(),
					filePath,
					expectedOutputs,
					exampleInputs
				);
				if (debugDriver) {
					const driverPath = path.join(fileDir, 'debug', debugDriver.fileName);
					try {
						await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(fileDir, 'debug')));
						await vscode.workspace.fs.writeFile(vscode.Uri.file(driverPath), Buffer.from(debugDriver.content, 'utf8'));
						runCommand = `python "${driverPath}"`;
					} catch {
						runCommand = `python "${filePath}"`;
					}
				} else {
					runCommand = `python "${filePath}"`;
				}
			} else {
				runCommand = `python "${filePath}"`;
			}
		} else if (filePath.endsWith('.js')) {
			runCommand = `node "${filePath}"`;
		} else if (filePath.endsWith('.ts')) {
			runCommand = `npx ts-node "${filePath}"`;
		} else if (filePath.endsWith('.java')) {
			// Java需先编译再运行；命令拆多条逐条发送：Windows 默认 PowerShell 5.1 不支持 &&，
			// 单条 sendText 逐行执行在 cmd/PowerShell/bash 下都成立
			const className = fileName.replace('.java', '');
			runSteps = [`cd "${fileDir}"`, `javac "${fileName}"`, `java "${className}"`];
		} else if (filePath.endsWith('.cpp')) {
			// C++需先编译再运行
			const exeName = fileName.replace('.cpp', '');
			const exe = process.platform === 'win32' ? `.\\"${exeName}"` : `./"${exeName}"`;
			runSteps = [`cd "${fileDir}"`, `g++ -std=c++17 -o "${exeName}" "${fileName}"`, exe];
		} else if (filePath.endsWith('.go')) {
			runCommand = `go run "${filePath}"`;
		} else if (filePath.endsWith('.rs')) {
			// Rust需先编译再运行
			const exeName = fileName.replace('.rs', '');
			const exe = process.platform === 'win32' ? `.\\"${exeName}"` : `./"${exeName}"`;
			runSteps = [`cd "${fileDir}"`, `rustc "${fileName}" -o "${exeName}"`, exe];
		} else if (filePath.endsWith('.c')) {
			// C需先编译再运行
			const exeName = fileName.replace('.c', '');
			const exe = process.platform === 'win32' ? `.\\"${exeName}"` : `./"${exeName}"`;
			runSteps = [`cd "${fileDir}"`, `gcc -o "${exeName}" "${fileName}"`, exe];
		}

		if (!runCommand && runSteps.length === 0) {
			vscode.window.showWarningMessage('不支持运行此类型的文件');
			return;
		}

		// 创建或获取终端并运行命令（多步重建：逐条发送，先 cd 再编译再运行）
		let terminal = vscode.window.terminals.find(t => t.name === 'LeetCode');
		if (!terminal) {
			terminal = vscode.window.createTerminal('LeetCode');
		}
		terminal.show();
		if (runCommand) {
			terminal.sendText(runCommand);
		}
		for (const step of runSteps) {
			terminal.sendText(step);
		}
	});

// ==================== 查看题解命令 ====================
		// 历史遗留的独立题解面板已移除（无 CSP + 原始 HTML 直插 + slug 未转义 + 与面板内置
		// 题解管线双实现漂移）：命令改为打开题目面板并直接进入题解页，统一走渲染管线
		const viewSolutionDisposable = vscode.commands.registerCommand('leetcode.viewSolution', async (item?: any) => {
			const currentProblem = context.workspaceState.get<any>('currentProblem');
			const titleSlug: string | undefined = item?.question?.titleSlug || currentProblem?.titleSlug;
			if (!titleSlug) {
				vscode.window.showErrorMessage('请先从题目列表打开一道题目');
				return;
			}
			await vscode.commands.executeCommand('leetcode.openProblem', {
				frontendQuestionId: item?.question?.frontendQuestionId || '',
				title: item?.question?.title || currentProblem?.title || '',
				titleSlug,
				difficulty: '',
				status: null
			} as Question, { tab: 'solution' });
		});

// ==================== 查看最近一次原始判题响应（JSON 编辑器，可折叠） ====================
		const showRawJudgeDisposable = vscode.commands.registerCommand('leetcode.showRawJudge', () => showRawJudgeResponse());

		// 自定义用例文件保存即自动在线判题（仅命中本扩展创建/打开的用例文件，不影响其他文件保存）
		const customCaseSaveDisposable = vscode.workspace.onDidSaveTextDocument((doc) => {
			const entry = customCaseFiles.get(doc.uri.fsPath);
			if (entry) {
				void runCustomCaseWith(leetCodeApi, entry.problem, entry.solutionPath, doc.getText());
			}
		});

		context.subscriptions.push(
			showRawJudgeDisposable,
			loginDisposable,
			logoutDisposable,
			refreshDisposable,
			openProblemDisposable,
			testDisposable,
			submitDisposable,
			debugDisposable,
			debugFailedDisposable,
			customTestDisposable,
			customCaseSaveDisposable,
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

