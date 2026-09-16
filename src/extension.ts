/**
 * LeetCode Hot100 Pro
 * VS Code 扩展入口文件
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { createHash } from 'crypto';
import { AuthManager } from './core/authManager';
import { LeetCodeApi, Question } from './core/leetcodeApi';
import { loginWithBrowser, pickChromiumChannel, detectDefaultBrowser } from './core/browserLogin';
import { spawnSync } from 'child_process';
import { Hot100Provider } from './views/hot100Provider';
import { StatusFilter } from './utils/progressStats';
import { selectLanguage, getExtension, SUPPORTED_LANGUAGES } from './utils/languageUtils';
import { generateDebugFile } from './utils/debugUtils';
import { buildJudgeReport, collectJudgeCaseInfos, JudgeCaseInfo } from './utils/judgeReport';
import { extractExpectedOutputs, parseProblemFileName } from './utils/problemText';
import { buildLeetCodeCookie } from './utils/loginCookie';
import { escapeHtml, errMsg, formatArticleDate } from './utils/htmlUtil';
import { generatePanelHtml, renderMarkdownToHtml, sanitizeSolutionContent, localizeContentImages, getPlayerFiles, initHighlightJs } from './views/problemPanel';
import { reportJudgeResult, showRawJudgeResponse, tryBeginJudge, pollJudgeResult, releaseJudge, getLastJudgeCases, oneLine, judgeOutputChannel, judgeStatusBar, errorDiagnostics } from './judgeFeedback';
import { PanelToExtensionMessage, ExtensionToPanelMessage } from './shared/webviewMessages';

/**
 * 清理题解 Markdown 内容中的 <iframe> 代码游玩区。
 *
 * LeetCode 官方题解内容包含指向 https://leetcode.cn/playground/... 的跨域 iframe。
 * 在 VS Code 的 webview 中，这类跨域 iframe 无法携带用户会话 Cookie，会被
 * LeetCode 重定向成登录页，导致题解显示异常。此函数将其整块移除，
 * 同时保留题解中的文字、公式与代码块。题目自身的代码骨架由
 * codeSnippets 以代码块形式单独展示。
 */

/** HTML 转义，防止代码注入 */

/** LeetCode 题解文章 createdAt 为秒级时间戳，格式化为日期；无效值返回空串 */

/**
 * 提取干净的异常消息用于 toast/页面提示：直接 `${error}` 插值会带上裸 "Error:" 前缀，
 * 统一走这里，保持全部报错文案风格一致。
 */

// 代码运行/提交错误以 VS Code 原生方式呈现：诊断（编辑器波浪线 + 问题面板），而非长文本弹窗

/**
 * 把 LeetCode 运行/提交错误写入编辑器诊断，尽量定位到出错行。
 * 返回解析出的行号（1-based），未解析到时返回 null。
 */

// LeetCode 判题详情通道：每次测试/提交都把完整判题信息（输入、输出、预期结果、
// 错误信息）写进来；toast 只留一行简讯。Output 为纯文本视图，ANSI 颜色不可用，
// 通过/失败与各字段用图标（✅/❌/📥/📤/🎯 等）标识。

// 判题状态栏项：测试/提交的轮询等待期间显示已等待秒数（通知进度弹窗只有转圈没有时长感）
judgeStatusBar.command = 'leetcode.showRawJudge';
judgeStatusBar.tooltip = 'LeetCode 判题进行中（点击查看最近一次原始判题响应）';

// 判题在途忙碌锁：测试/提交共用一把。并发 runCode 会互相覆盖"最近一次判题响应"，
// 重复提交还会产生多条提交记录；命令入口同步占位、判题结束（成功/超时/异常）释放。

/**
 * 判题结果轮询：1s 起步 ×1.5 指数退避封顶 5s，总预算 ~90s（旧实现固定 2s×15=30s，
 * 慢题判题会假性超时）；期间状态栏显示已等待秒数。超时返回 undefined 由调用方提示。
 */

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
const solutionPanels = new Map<string, vscode.WebviewPanel>();
const pendingProblemOpens = new Set<string>();
const pendingSolutionOpens = new Set<string>();

// 最近一次判题的原始响应对象（JSON 编辑器按需展示用，支持折叠）

// 最近一次判题的逐用例信息（"用判题失败用例本地调试"入口用；携带 titleSlug 用于与当前文件比对防串题）

/** 把可能含换行的文本压成一行用于 QuickPick 展示（输入/期望超长截断） */

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
 * 以 JSON 编辑器打开最近一次原始判题响应：JSON 语言模式自带折叠，
 * 与 Output 纯文本不同，长对象可以逐级收起。
 */

/**
 * 判题结果的统一上报（通过与否都写）：完整详情写入输出通道（输入/输出/预期/
 * 运行时间/内存/错误信息 + 原始判题响应），右下角 toast 只留一行简讯，
 * 附"查看判题详情"，提交场景再附"在浏览器打开"直达官方判题页。
 * 编译/运行时错误文本同时写编辑器诊断（波浪线 + 问题面板）。
 */

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
	customCaseSource: boolean
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
		expectedOutputs
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
			const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
				type: 'python',
				name: 'LeetCode Hot 100 本地调试',
				request: 'launch',
				program: debugFilePath,
				cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? dirPath,
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
				vscode.window.showErrorMessage('自定义用例测试失败: ' + JSON.stringify(result));
				return;
			}

			// 轮询获取结果（退避至 ~90s，状态栏显示等待时长）
			const check = await pollJudgeResult(api, interpretId);
			if (check) {
				reportJudgeResult('自定义用例', check, {
					ok: check.run_success && !!check.correct_answer,
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
 * 并同步更新 currentProblem，保证后续操作一致。
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
	const parsed = parseProblemFileName(fileName);
	if (!parsed || parsed.titleSlug === currentProblem.titleSlug) {
		return currentProblem;
	}
	try {
		const data = await api.getQuestionContent(parsed.titleSlug);
		const q = data?.data?.question;
		if (!q) {
			return currentProblem;
		}
		const langMap: Record<string, string> = {
			py: 'python', js: 'javascript', ts: 'typescript', java: 'java',
			cpp: 'cpp', c: 'c', go: 'golang', rs: 'rust'
		};
		const extMatch = fileName.match(/\.([a-z]+)$/i);
		const ext = extMatch ? extMatch[1].toLowerCase() : '';
		const problem = {
			titleSlug: q.titleSlug || parsed.titleSlug,
			questionId: q.questionId,
			lang: langMap[ext] || currentProblem.lang,
			testCases: q.exampleTestcases || q.sampleTestCase || currentProblem.testCases || ''
		};
		context.workspaceState.update('currentProblem', problem);
		return problem;
	} catch {
		return currentProblem;
	}
}

/**
 * 把 HTML 中的 http(s) 图片下载到本地缓存，并替换为 webview 可访问的 asWebviewUri，
 * 避免 webview 加载外部图片失败（如 assets.leetcode.com 等域名）。
 */

/**
 * 把题解内容中少量内联 HTML 还原为 Markdown 文本，避免静态渲染时残留原始标签。
 * 只处理安全的常用标签；iframe 等占位区域由调用方在渲染前移除。
 */


/** 代码语言优先级：Python3/Python > C/C++ > 其他（官方题解每组只展示一种语言时使用） */

/** 语言名显示规范化：py → Python、cpp → C++、golang → Go 等（标签页与代码块标注用） */

/**
 * 行内 Markdown 渲染（图片/视频/链接/行内代码/粗体/斜体/删除线），文本先做 HTML 转义。
 * videoPageUrl 存在时，视频题解（![xxx.mp4](资产id)）渲染为可点击播放入口——
 * 视频在 LeetCode 内部 CDN 上且带防盗链，webview 无法直接内嵌播放。
 */


/** 官方题解标签页语言优先级：Python → C/C++ → Java → 其他（同优先级保持原文顺序） */

/**
 * 多语言代码块 → 语言标签页（保留全部语言，点击切换，类似网页版题解）。
 * preferredFirst 为 true 时按 Python → C/C++ → Java → 其他 的顺序排列（用于官方题解）。
 */

/** 相邻代码块组中，按优先级挑一种语言（Python3/Python → C/C++ → 其他首个） */

/**
 * 轻量级 Markdown → HTML 渲染器（扩展端静态渲染，不依赖 webview 的 CDN marked）。
 * 支持标题、段落、行内格式、图片/链接、列表、引用、分隔线、表格与围栏代码块。
 * codeMode:
 *   - 'preferred'：相邻的多语言代码块只保留一种（Python3/Python → C/C++ → 其他首个）；
 *   - 'all'：保留全部代码块并按语言生成标签页（preferredFirst 时优先语言排首位并默认选中，
 *     用于官方题解，接近网页版的多语言切换体验；社区题解保持原文顺序）。
 */

// 状态栏项
let statusBarItem: vscode.StatusBarItem;

// highlight.js 本地资源（vendor/ 随扩展打包，.vscodeignore 未排除），
// 在扩展端执行并直接产出高亮 HTML，webview 无需再运行任何高亮脚本


/** 在扩展端执行 vendored highlight.js（函数包裹避免 var 泄漏到全局），失败返回 null */

/** 语言标识 → highlight.js 语言名（py → python、cpp → cpp 等） */


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


export function activate(context: vscode.ExtensionContext) {
	console.log('LeetCode Extension is now active!');

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

	// 清空错题回顾队列
	context.subscriptions.push(vscode.commands.registerCommand('leetcode.clearWrongQueue', async () => {
		const choice = await vscode.window.showWarningMessage('清空错题回顾队列？', '清空');
		if (choice === '清空') {
			hot100Provider.clearWrongQueue();
		}
	}));

	// 服务端判定会话失效时主动提示重新登录（toast 内建限频，避免每个过期请求都弹）
	leetCodeApi.onSessionExpired = () => notifySessionExpired();

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
	context.subscriptions.push({ dispose: () => { problemPanels.forEach(p => p.dispose()); solutionPanels.forEach(p => p.dispose()); } });
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
	const openProblemDisposable = vscode.commands.registerCommand('leetcode.openProblem', async (question: Question) => {
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

				// 获取工作区文件夹
				const workspaceFolders = vscode.workspace.workspaceFolders;
				if (!workspaceFolders || workspaceFolders.length === 0) {
					vscode.window.showErrorMessage('请先打开一个工作区文件夹');
					return;
				}
				const workspaceFolder = workspaceFolders[0].uri.fsPath;

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
					const selectedLanguage = await selectLanguage(q.codeSnippets);
					if (!selectedLanguage) {
						return; // 用户取消了选择
					}
					langSlug = selectedLanguage.langSlug;
					snippetCode = selectedLanguage.code;
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
				context.workspaceState.update('currentProblem', {
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
				const difficultyMap: Record<string, string> = {
					'Easy': '简单',
					'Medium': '中等',
					'Hard': '困难'
				};
				const difficulty = difficultyMap[q.difficulty] || q.difficulty;

				// 生成带标签页的面板HTML

					// 题目内容中的外链图片下载到本地缓存（webview 直连外部图可能失败）
					questionContent = await localizeContentImages(questionContent, panel, context, leetCodeApi);
					panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem');

				// 处理消息（外层兜底：任何异常都提示用户，避免静默失败）
				panel.webview.onDidReceiveMessage(async (message: PanelToExtensionMessage) => {
					try {
						await handlePanelMessage(message, panel, q);
					} catch (error) {
						vscode.window.showErrorMessage(`处理操作失败: ${errMsg(error)}`);
					}
				});

				/**
				 * 题解面板消息处理（抽出来便于外层统一兜底错误提示）
				 */
				async function handlePanelMessage(message: PanelToExtensionMessage, panel: vscode.WebviewPanel, q: any) {
					if (message.type === 'loadSolution') {
						try {
// 官方题解与社区题解列表并行拉取，避免串行叠加等待
								const [officialData, communityData] = await Promise.all([
									leetCodeApi.getOfficialSolution(q.titleSlug),
									leetCodeApi.getSolutionArticles(q.titleSlug, 0, 10)
								]);
								const officialSolution = officialData?.data?.question?.solution;
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

							if (!solutionHtml) {
								solutionHtml = '<div class="loading">暂无题解</div>';
							}

							solutionHtml = await localizeContentImages(solutionHtml, panel, context, leetCodeApi);
							panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', solutionHtml);
						} catch (error) {
							panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', `<div class="loading">加载题解失败: ${escapeHtml(errMsg(error))}</div>`);
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
								panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem');
							} catch (error) {
								vscode.window.showErrorMessage(`刷新题目描述失败: ${errMsg(error)}`);
								panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'problem');
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
const mp4Uri = vscode.Uri.joinPath(dirUri, meta.videoInfo.videoId + '_v3.mp4');
									const mp3Uri = vscode.Uri.joinPath(dirUri, meta.videoInfo.videoId + '_v3.mp3');
									const tsUri = vscode.Uri.joinPath(dirUri, meta.videoInfo.videoId + '.ts');
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
											<h2>${article.title}</h2>
											<div class="article-meta" style="margin-bottom:20px;">👍 ${article.upvoteCount} | 作者: ${article.author?.profile?.realName || article.author?.username || '匿名'}${article.byLeetcode ? ' | 👑 官方' : ''}</div>
											<div class="solution-content">${renderMarkdownToHtml(cleanedArticle, 'all')}</div>
										</div>
									`;
								articleHtml = await localizeContentImages(articleHtml, panel, context, leetCodeApi);
									panel.webview.html = generatePanelHtml(q, title, difficulty, questionContent, context, panel, 'solution', articleHtml);
							}
						} catch (error) {
							vscode.window.showErrorMessage(`加载题解失败: ${errMsg(error)}`);
						}
					}
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`加载题目失败: ${errMsg(error)}`);
		} finally {
			pendingProblemOpens.delete(panelKey);
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

		// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态导致测试错题
		const problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);

		// 保存文件
		await editor.document.save();
		const code = editor.document.getText();
		// 重新运行时清除上一次的错误标注
		errorDiagnostics.delete(editor.document.uri);

		// 在途忙碌锁：判题发起前同步占位，防快速连点并发 runCode/覆盖判题详情
		if (!tryBeginJudge()) {
			return;
		}
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在运行测试...",
			cancellable: false
		}, async () => {
			try {
				const result = await leetCodeApi.runCode(
					problem.titleSlug,
					problem.questionId,
					problem.lang,
					code,
					problem.testCases || ''
				);

				const interpretId = result.interpret_id;
				if (!interpretId) {
					vscode.window.showErrorMessage('测试失败: ' + JSON.stringify(result));
					return;
				}

				// 轮询获取结果（退避至 ~90s，状态栏显示等待时长）
const check = await pollJudgeResult(leetCodeApi, interpretId);
					if (check) {
						reportJudgeResult('测试', check, {
							ok: check.run_success && !!check.correct_answer,
							fileUri: editor.document.uri,
							inputFallback: problem.testCases,
							titleSlug: problem.titleSlug
						});
						// 测试（含通过）只算"尝试过"，不算"已解决"（以提交结果为准）
						hot100Provider.recordJudgeResult(problem.titleSlug, { solved: false });
					} else {
					vscode.window.showWarningMessage('测试超时：判题未在 90 秒内返回，可稍后重试');
				}
			} catch (error) {
				vscode.window.showErrorMessage(`测试出错: ${errMsg(error)}`);
			} finally {
				releaseJudge();
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

		// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态导致提交错题
		const problem = await resolveProblemFromFile(leetCodeApi, context, path.basename(editor.document.uri.fsPath), currentProblem);

		// 保存文件
		await editor.document.save();
		const code = editor.document.getText();
		// 重新提交时清除上一次的错误标注
		errorDiagnostics.delete(editor.document.uri);

		// 在途忙碌锁：判题发起前同步占位，防快速连点重复提交
		if (!tryBeginJudge()) {
			return;
		}
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在提交到 LeetCode...",
			cancellable: false
		}, async () => {
			try {
				const result = await leetCodeApi.submitCode(
					problem.titleSlug,
					problem.questionId,
					problem.lang,
					code
				);

				const submissionId = result.submission_id;
				if (!submissionId) {
					vscode.window.showErrorMessage('提交失败: ' + JSON.stringify(result));
					return;
				}
				const submissionUrl = `https://leetcode.cn/problems/${problem.titleSlug}/submissions/${submissionId}/`;

				// 轮询获取结果（退避至 ~90s，状态栏显示等待时长）
				const check = await pollJudgeResult(leetCodeApi, submissionId);
// 提交代码后：更新侧栏状态（通过=已解决并移出错题队列，失败=尝试过并记录错题）
					if (check) {
							const accepted = check.status_msg === 'Accepted';
							reportJudgeResult('提交', check, {
								ok: accepted,
								fileUri: editor.document.uri,
								submissionUrl,
								titleSlug: problem.titleSlug
							});
							hot100Provider.recordJudgeResult(problem.titleSlug, {
								solved: accepted,
								reason: check.status_msg,
								recordWrong: true
							});
						} else {
					const choice = await vscode.window.showWarningMessage(
						'提交超时：判题未在 90 秒内返回，结果可在 LeetCode 提交页查看',
						'打开提交页'
					);
					if (choice === '打开提交页') {
						vscode.env.openExternal(vscode.Uri.parse(submissionUrl));
					}
				}
			} catch (error) {
				vscode.window.showErrorMessage(`提交出错: ${errMsg(error)}`);
			} finally {
				releaseJudge();
			}
		});
	});

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

		// 拉取题面以提取各示例的期望输出（本地运行/调试时逐示例比对）
		let expectedOutputs: string[] = [];
		try {
			const questionData = await leetCodeApi.getQuestionContent(problem.titleSlug);
			const question = questionData?.data?.question;
			expectedOutputs = extractExpectedOutputs(question?.translatedContent || question?.content || '');
		} catch {
			// 拿不到期望输出时仅运行不比对
		}

		await runDebugWithCases(editor, problem, problem.testCases || '', expectedOutputs, false);
	});

	// ==================== 用判题失败用例本地调试命令 ====================
	const debugFailedDisposable = vscode.commands.registerCommand('leetcode.debugFailedCase', async () => {
		const failedCases = getLastJudgeCases()?.cases?.filter(c => !c.passed && c.known && c.input) ?? [];
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
		// 失败用例来自上次判题的题目；当前文件是另一题时不能混用（防用例套错函数）
		const lastJudgeForCase = getLastJudgeCases();
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

		if (filePath.endsWith('.py')) {
			const currentProblem = context.workspaceState.get<any>('currentProblem');
			// 题解代码文件：生成并运行调试驱动（自动依赖注入 + 按签名解析用例）；
			// 本身就是驱动文件（debug/xxx_debug.py）时直接运行
			if (currentProblem && !fileName.endsWith('_debug.py')) {
				// 以当前文件为准解析题目身份，避免 currentProblem 残留上一题状态
				const problem = await resolveProblemFromFile(leetCodeApi, context, fileName, currentProblem);
				// 拉取题面以提取各示例的期望输出（与调试入口一致，便于逐示例比对）
				let expectedOutputs: string[] = [];
				try {
					const questionData = await leetCodeApi.getQuestionContent(problem.titleSlug);
					const question = questionData?.data?.question;
					expectedOutputs = extractExpectedOutputs(question?.translatedContent || question?.content || '');
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
					expectedOutputs
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

		// 题解面板：每题只允许一个。重复点击直接聚焦已有面板（同步判断，先于任何网络请求），
		// 再用同步占位拦住快速双击的第二个调用
		const earlyKey = String(currentProblem.titleSlug || '');
		const existingEarlyPanel = solutionPanels.get(earlyKey);
		if (existingEarlyPanel) {
			existingEarlyPanel.reveal(vscode.ViewColumn.Two);
			return;
		}
		if (pendingSolutionOpens.has(earlyKey)) {
			return;
		}
		pendingSolutionOpens.add(earlyKey);

		try {
		// 以当前编辑的文件为准解析题目（与运行/调试/测试/提交同一套防错题逻辑）
		const activeFileName = path.basename(vscode.window.activeTextEditor?.document.uri.fsPath || '');
		const problem = await resolveProblemFromFile(leetCodeApi, context, activeFileName, currentProblem);
		const titleSlug = problem.titleSlug;

		const solutionKey = String(titleSlug);
		const existingSolutionPanel = solutionPanels.get(solutionKey);
		if (existingSolutionPanel) {
			existingSolutionPanel.reveal(vscode.ViewColumn.Two);
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "正在加载题解...",
			cancellable: false
		}, async () => {
			try {
// 官方题解与社区题解列表并行拉取，避免串行叠加等待
					const [officialData, communityData] = await Promise.all([
						leetCodeApi.getOfficialSolution(titleSlug),
						leetCodeApi.getSolutionArticles(titleSlug, 0, 10)
					]);
					const officialSolution = officialData?.data?.question?.solution;
					const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];

				const panel = vscode.window.createWebviewPanel(
					'leetcodeSolution',
					`题解 - ${titleSlug}`,
					vscode.ViewColumn.Two,
					{ enableScripts: true }
				);
				solutionPanels.set(solutionKey, panel);
				panel.onDidDispose(() => solutionPanels.delete(solutionKey));

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
				panel.webview.onDidReceiveMessage(async (message: PanelToExtensionMessage) => {
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
							vscode.window.showErrorMessage(`加载题解失败: ${errMsg(error)}`);
						}
					}
				});

			} catch (error) {
				vscode.window.showErrorMessage(`加载题解失败: ${errMsg(error)}`);
			}
		});
		} finally {
			pendingSolutionOpens.delete(earlyKey);
		}
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

export function deactivate() {
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}
