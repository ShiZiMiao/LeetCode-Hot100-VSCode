/**
 * LeetCode Hot 100 刷题助手
 * VS Code 扩展入口文件
 */

import * as vscode from 'vscode';
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

/**
 * 从题目 codeSnippets 中按语言优先级挑选一个代码骨架展示。
 *
 * 优先级：Python(python3/python) > C/C++(c/cpp) > Java(java)。
 * 若都不存在，则回退到第一个可用的代码骨架。
 */
function selectPreferredSnippet(snippets: any[]): any | undefined {
	if (!snippets || snippets.length === 0) {
		return undefined;
	}
	const priorityGroups = [
		['python3', 'python'],
		['c', 'cpp'],
		['java']
	];
	for (const group of priorityGroups) {
		const found = snippets.find((s: any) => group.includes((s.langSlug || '').toLowerCase()));
		if (found) {
			return found;
		}
	}
	return snippets[0];
}

// 状态栏项
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
	console.log('LeetCode Extension is now active!');

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
					{ enableScripts: true }
				);

				// 使用中文内容（translatedContent），如果没有则使用英文
				const questionContent = q.translatedContent || q.content;
				const title = q.translatedTitle || q.title;
				const difficultyMap: Record<string, string> = {
					'Easy': '简单',
					'Medium': '中等',
					'Hard': '困难'
				};
				const difficulty = difficultyMap[q.difficulty] || q.difficulty;

				// 生成带标签页的面板HTML
				const generatePanelHtml = (activeTab: string, solutionContent: string = '') => `
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
							.solution-tip {
								color: var(--vscode-descriptionForeground);
								font-size: 13px;
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
						</style>
						<!-- 加载 marked 库用于 Markdown 渲染 -->
						<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
						<!-- 加载 KaTeX 用于数学公式渲染 -->
						<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
						<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
						<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
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
							function processCodeTabs(c){
							var pres=Array.from(c.querySelectorAll('pre'));
							if(pres.length<2)return;
							
							// 推断代码语言
							function detectLang(code){
								var text=code.textContent||'';
								if(/class\\s+\\w+\\s*\\{/.test(text)&&/public\\s+(static\\s+)?\\w+/.test(text))return'Java';
								if(/^class Solution/.test(text.trim())&&/def\\s+\\w+\\(self/.test(text))return'Python';
								if(/vector<|#include|::/.test(text))return'C++';
								if(/func\\s+\\w+\\(.*\\).*\\{/.test(text))return'Go';
								if(/fn\\s+\\w+\\(/.test(text)&&/->/.test(text))return'Rust';
								if(/function\\s+\\w+\\(|const\\s+\\w+\\s*=\\s*function|=>/.test(text))return'JavaScript';
								if(/struct\\s+\\w+|HASH_/.test(text))return'C';
								var cls=code.className||'';
								var m=cls.match(/language-(\\w+)/i);
								return m?m[1]:'Code';
							}
							
							// 收集连续代码块
							var groups=[],cur=[];
							for(var i=0;i<pres.length;i++){
								var pre=pres[i],code=pre.querySelector('code');
								if(!code)continue;
								var lang=detectLang(code);
								cur.push({pre:pre,lang:lang});
								
								// 检查下一个是否相邻（允许2个节点间隔）
								var next=pres[i+1],isAdj=false;
								if(next){
									var sib=pre.nextElementSibling;
									for(var j=0;j<3&&sib;j++){
										if(sib===next){isAdj=true;break;}
										sib=sib.nextElementSibling;
									}
								}
								if(!next||!isAdj){
									if(cur.length>1)groups.push(cur.slice());
									cur=[];
								}
							}
							if(cur.length>1)groups.push(cur.slice());
							
							// 创建标签页
							groups.forEach(function(gr){
								var w=document.createElement('div');
								var t=document.createElement('div');t.className='lang-tabs';
								var cs=document.createElement('div');
								gr.forEach(function(item,idx){
									var tab=document.createElement('button');
									tab.className='lang-tab'+(idx===0?' active':'');
									tab.textContent=item.lang;
									tab.onclick=function(){
										t.querySelectorAll('.lang-tab').forEach(function(x){x.classList.remove('active');});
										cs.querySelectorAll('.lang-code-block').forEach(function(x){x.classList.remove('active');});
										tab.classList.add('active');cs.children[idx].classList.add('active');
									};
									t.appendChild(tab);
									var ct=document.createElement('div');
									ct.className='lang-code-block'+(idx===0?' active':'');
									ct.appendChild(item.pre.cloneNode(true));
									cs.appendChild(ct);
								});
								w.appendChild(t);w.appendChild(cs);
								gr[0].pre.parentNode.insertBefore(w,gr[0].pre);
								gr.forEach(function(item){item.pre.remove();});
							});
						}
					</script>
					</body>
					</html>
				`;

				panel.webview.html = generatePanelHtml('problem');

				// 处理消息
				panel.webview.onDidReceiveMessage(async (message) => {
					if (message.type === 'loadSolution') {
						try {
							// 获取官方题解
							const officialData = await leetCodeApi.getOfficialSolution(q.titleSlug);
							const officialSolution = officialData?.data?.question?.solution;

							// 获取社区题解
							const communityData = await leetCodeApi.getSolutionArticles(q.titleSlug, 0, 10);
							const communityArticles = communityData?.data?.questionSolutionArticles?.edges || [];

							let solutionHtml = '';

							// 官方题解 - Markdown内容需要用marked解析
							if (officialSolution && officialSolution.content && officialSolution.canSeeDetail) {
								// 清理内容中的 iframe 代码游玩区，避免 webview 中被重定向为登录页
								const cleanedContent = sanitizeSolutionContent(officialSolution.content);
								// 将Markdown内容进行JSON编码以安全传递
								const mdContent = JSON.stringify(cleanedContent);
								solutionHtml += `
									<div class="solution-section">
										<h2>📖 官方题解</h2>
										<div class="solution-content" id="official-solution-content"></div>
										<script>
											(function() {
												const md = ${mdContent};
												const el = document.getElementById('official-solution-content');
												if (typeof marked !== 'undefined') {
													// 配置marked处理代码块语言标签（如 Javascript []）
													const renderer = new marked.Renderer();
													renderer.code = function(code, lang) {
														// 移除语言后面的 [] 标记
														const cleanLang = lang ? lang.replace(/\\s*\\[.*\\]$/, '').trim() : '';
														const langClass = cleanLang ? 'language-' + cleanLang : '';
														return '<pre><code class="' + langClass + '">' + 
															(code.text || code).replace(/</g, '&lt;').replace(/>/g, '&gt;') + 
															'</code></pre>';
													};
													marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
													el.innerHTML = marked.parse(md);
													
													// 渲染LaTeX公式 - $$...$$ 作为行内公式
													if (typeof renderMathInElement !== 'undefined') {
														renderMathInElement(el, {
															delimiters: [
																{left: '$$', right: '$$', display: false},
																{left: '$', right: '$', display: false}
															],
															throwOnError: false
														});
													}
													// 处理多语言代码块
													if (typeof processCodeTabs === 'function') {
														processCodeTabs(el);
													}
												} else {
													el.innerHTML = md.replace(/\\n/g, '<br>');
												}
											})();
										</script>
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

							// 题目自带代码骨架（用代码块形式展示，替代无法抓取的 playground iframe）
							if (q.codeSnippets && q.codeSnippets.length > 0) {
								const preferred = selectPreferredSnippet(q.codeSnippets);
								const langLabel = preferred && preferred.lang ? preferred.lang : '代码';
								const langFence = preferred && preferred.langSlug ? preferred.langSlug : '';
								const codeSnippetMd = preferred
									? `\`\`\`${langFence}\n${preferred.code}\n\`\`\``
									: '';
								const snippetMdContent = JSON.stringify(codeSnippetMd);
								solutionHtml += `
									<div class="solution-section">
										<h2>💻 代码示例（${langLabel}）</h2>
										<p class="solution-tip">以下是该题的代码模板，可在编辑器里编写解题代码。</p>
										<div class="solution-content" id="code-snippets-content"></div>
										<script>
											(function() {
												const md = ${snippetMdContent};
												const el = document.getElementById('code-snippets-content');
												if (typeof marked !== 'undefined') {
													const renderer = new marked.Renderer();
													renderer.code = function(code, lang) {
														const cleanLang = lang ? lang.replace(/\\s*\\[.*\\]$/, '').trim() : '';
														const langClass = cleanLang ? 'language-' + cleanLang : '';
														return '<pre><code class="' + langClass + '">' +
															(code.text || code).replace(/</g, '&lt;').replace(/>/g, '&gt;') +
															'</code></pre>';
													};
													marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
													el.innerHTML = marked.parse(md);
													if (typeof processCodeTabs === 'function') {
														processCodeTabs(el);
													}
												} else {
													el.innerHTML = md.replace(/\\n/g, '<br>');
												}
											})();
										</script>
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

							if (!solutionHtml) {
								solutionHtml = '<div class="loading">暂无题解</div>';
							}

							panel.webview.html = generatePanelHtml('solution', solutionHtml);
						} catch (error) {
							panel.webview.html = generatePanelHtml('solution', `<div class="loading">加载题解失败: ${error}</div>`);
						}
					} else if (message.type === 'openArticle') {
						try {
							const articleData = await leetCodeApi.getSolutionArticle(message.slug);
							const article = articleData?.data?.solutionArticle;
							if (article) {
								// 清理内容中的 iframe，避免 webview 中被重定向为登录页
								const cleanedArticle = sanitizeSolutionContent(article.content || '');
								// 将Markdown内容进行JSON编码以安全传递
								const articleMdContent = JSON.stringify(cleanedArticle);
								const articleHtml = `
									<div class="solution-section">
										<button onclick="vscode.postMessage({type:'loadSolution'})" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-bottom:20px;">← 返回列表</button>
										<h2>${article.title}</h2>
										<div class="article-meta" style="margin-bottom:20px;">👍 ${article.upvoteCount} | 作者: ${article.author?.profile?.realName || article.author?.username || '匿名'}${article.byLeetcode ? ' | 👑 官方' : ''}</div>
										<div class="solution-content" id="article-solution-content"></div>
										<script>
											(function() {
												const md = ${articleMdContent};
												const el = document.getElementById('article-solution-content');
												if (typeof marked !== 'undefined') {
													const renderer = new marked.Renderer();
													renderer.code = function(code, lang) {
														const cleanLang = lang ? lang.replace(/\\s*\\[.*\\]$/, '').trim() : '';
														const langClass = cleanLang ? 'language-' + cleanLang : '';
														return '<pre><code class="' + langClass + '">' + 
															(code.text || code).replace(/</g, '&lt;').replace(/>/g, '&gt;') + 
															'</code></pre>';
													};
													marked.setOptions({ renderer: renderer, breaks: true, gfm: true });
													el.innerHTML = marked.parse(md);
													// 渲染LaTeX公式
													if (typeof renderMathInElement !== 'undefined') {
														renderMathInElement(el, {
															delimiters: [
																{left: '$$', right: '$$', display: false},
																{left: '$', right: '$', display: false}
															],
															throwOnError: false
														});
													}
													// 处理多语言代码块
													if (typeof processCodeTabs === 'function') {
														processCodeTabs(el);
													}
												} else {
													el.innerHTML = md.replace(/\\n/g, '<br>');
												}
											})();
										</script>
									</div>
								`;
								panel.webview.html = generatePanelHtml('solution', articleHtml);
							}
						} catch (error) {
							vscode.window.showErrorMessage(`加载题解失败: ${error}`);
						}
					}
				});
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
