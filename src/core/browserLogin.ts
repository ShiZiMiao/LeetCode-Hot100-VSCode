/**
 * 浏览器自动登录：用系统已装的 Edge/Chrome 开一个**独立临时 profile** 的真实登录窗口，
 * 用户在窗口内完成登录（密码/扫码/第三方 OAuth 均可，全程真实 https 域名，
 * 账号密码不经过插件）；插件轮询读取浏览器上下文里 leetcode.cn 的
 * LEETCODE_SESSION 与 csrftoken，齐了即组装 Cookie 返回，并销毁临时 profile。
 *
 * 不读浏览器本地 Cookie 数据库：Windows 上 Edge/Chrome 127+ 的 Cookie 值均为
 * v20 App-Bound 加密，第三方进程解密已被系统性封堵（也属恶意软件技术，不可为）。
 *
 * playwright-core 通过 vendor/ 副本按需加载（require 由调用方注入，便于测试与
 * 避免非登录场景的固定开销）。纯函数（Cookie 提取、浏览器探测）单独导出供单测。
 */
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export type ChromiumChannel = 'msedge' | 'chrome';

export interface BrowserLoginResult {
	status: 'success' | 'canceled' | 'timeout' | 'error';
	cookie?: string;
	message?: string;
}

/**
 * 从 Cookie 列表提取两条会话值并组装 Cookie 串；两项未齐返回 null（视为尚未登录完成）。
 * 用数组 find 精确匹配 name，不做正则，天然免疫值里的 '=' / ';' 等字符。
 */
export function extractLeetCodeCookie(cookies: { name: string; value: string }[]): string | null {
	const session = cookies.find(c => c.name === 'LEETCODE_SESSION')?.value;
	const csrf = cookies.find(c => c.name === 'csrftoken')?.value;
	if (!session || !csrf) {
		return null;
	}
	return `LEETCODE_SESSION=${session}; csrftoken=${csrf}`;
}

/**
 * 各平台 Edge/Chrome 可执行文件的常见安装位置（按优先级：Edge 在前——
 * Windows 默认装机自带；channel 参数仍由 playwright 二次解析注册表，
 * 这里探测只为快速给出"未安装"的明确信号，避免弹浏览器才报错）。
 */
export function candidateChromiumPaths(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { channel: ChromiumChannel; exe: string }[] {
	if (platform === 'win32') {
		const roots = [
			env['PROGRAMFILES(X86)'],
			env['PROGRAMFILES'],
			env['LOCALAPPDATA']
		].filter((x): x is string => !!x);
		const list: { channel: ChromiumChannel; exe: string }[] = [];
		for (const root of roots) {
			list.push({ channel: 'msedge', exe: path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe') });
		}
		for (const root of roots) {
			list.push({ channel: 'chrome', exe: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') });
		}
		return list;
	}
	if (platform === 'darwin') {
		return [
			{ channel: 'msedge', exe: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
			{ channel: 'chrome', exe: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }
		];
	}
	// linux：playwright 的 channel 名对应发行版包名可执行文件
	return [
		{ channel: 'msedge', exe: '/usr/bin/microsoft-edge' },
		{ channel: 'chrome', exe: '/usr/bin/google-chrome' }
	];
}

/** 在候选路径里挑第一个存在的可执行文件对应 channel；均不存在返回 null */
export function pickChromiumChannel(existsSync: (p: string) => boolean, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ChromiumChannel | null {
	for (const c of candidateChromiumPaths(platform, env)) {
		try {
			if (existsSync(c.exe)) {
				return c.channel;
			}
		} catch {
			/* 权限异常按不存在处理 */
		}
	}
	return null;
}

/** 系统默认浏览器的判定结果：可驱动 channel / 已知不可驱动（Firefox 等）/ 未知（探测失败，按已装顺序回退） */
export type DefaultBrowserSignal =
	| { kind: 'chromium'; channel: ChromiumChannel }
	| { kind: 'other'; hint: string }
	| { kind: 'unknown' };

/**
 * 把默认浏览器标识（Windows ProgId 如 MSEdgeHTM/ChromeHTML，或 linux 桌面文件名
 * 如 google-chrome.desktop）分类为可驱动 channel。
 * 注意 Tabbit/Opera/Vivaldi 等 Chromium 分支不在 playwright channel 支持列表里，
 * 归为 other（回退到标准 Edge/Chrome）。
 */
export function classifyDefaultBrowser(raw: string | null): DefaultBrowserSignal {
	if (!raw) {
		return { kind: 'unknown' };
	}
	const s = raw.toLowerCase();
	// Windows ProgId（msedgehtm*）与 linux 桌面名（microsoft-edge*.desktop）两种形态
	if (s.includes('msedge') || s.includes('microsoft-edge')) {
		return { kind: 'chromium', channel: 'msedge' };
	}
	if (s.includes('chromehtml') || s.startsWith('google-chrome') || /^chrome(htt|html)/.test(s)) {
		return { kind: 'chromium', channel: 'chrome' };
	}
	return { kind: 'other', hint: raw.trim() };
}

/** 从 reg.exe query 输出中解析 ProgId 值；非预期格式返回 null */
export function parseRegProgId(output: string | null): string | null {
	if (!output) {
		return null;
	}
	const m = /ProgId\s+REG_SZ\s+(\S+)/i.exec(output);
	return m ? m[1] : null;
}

/**
 * 探测系统默认浏览器是否为可驱动的 Chromium 系（Edge/Chrome）。
 * win32：读 https（回退 http）UrlAssociations 的 UserChoice ProgId；
 * linux：xdg-settings get default-web-browser；macOS 不探测（回退已装检测顺序）。
 * exec 注入便于单测；探测失败一律 unknown → 调用方回退 pickChromiumChannel。
 */
export function detectDefaultBrowser(
	exec: (cmd: string, args: string[]) => { status: number | null; stdout: string },
	platform: NodeJS.Platform = process.platform
): DefaultBrowserSignal {
	if (platform === 'win32') {
		for (const scheme of ['https', 'http']) {
			const key = `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`;
			let out: { status: number | null; stdout: string };
			try {
				out = exec('reg', ['query', key, '/v', 'ProgId']);
			} catch {
				continue;
			}
			if (out.status === 0) {
				return classifyDefaultBrowser(parseRegProgId(out.stdout));
			}
		}
		return { kind: 'unknown' };
	}
	if (platform === 'linux') {
		try {
			const out = exec('xdg-settings', ['get', 'default-web-browser']);
			if (out.status === 0) {
				return classifyDefaultBrowser(out.stdout.trim());
			}
		} catch {
			/* fall through */
		}
		return { kind: 'unknown' };
	}
	return { kind: 'unknown' };
}

export interface BrowserLoginOptions {
	channel: ChromiumChannel;
	/** 注入 playwright-core 模块获取（生产：() => require(<extPath>/vendor/playwright-core)；测试给 mock） */
	requirePlaywright: () => any;
	/** 总等待预算（毫秒），默认 10 分钟 */
	timeoutMs?: number;
	/** 轮询间隔（毫秒），默认 1500 */
	pollMs?: number;
	/** 状态回调（面板回显用）：launching=正在启动浏览器 waiting-login=等你在窗口里登录 closing=已拿到Cookie收尾 */
	onStatus?: (state: 'launching' | 'waiting-login' | 'closing') => void;
	/** 取消探测（如用户关闭了登录面板）；返回 true 时终止并关闭浏览器 */
	isAborted?: () => boolean;
}

/**
 * 执行一次浏览器登录。无论成功/取消/超时，finally 保证：浏览器关闭 + 临时 profile 删除。
 */
export async function loginWithBrowser(opts: BrowserLoginOptions): Promise<BrowserLoginResult> {
	const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
	const pollMs = opts.pollMs ?? 1500;
	let tmpDir: string;
	try {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leetcode-hot100-login-'));
	} catch (e: any) {
		return { status: 'error', message: `无法创建临时目录: ${e?.message || e}` };
	}
	let ctx: any;
	let browserClosed = false;
	try {
		const pw = opts.requirePlaywright();
		opts.onStatus?.('launching');
		// 全新临时 profile：插件读不到用户日常浏览器里的任何数据，也杜绝"未察觉地复用旧会话"
		const launchOnce = (sandbox: boolean) => pw.chromium.launchPersistentContext(tmpDir, {
			channel: opts.channel,
			headless: false,
			viewport: null,
			// Playwright 的 chromiumSandbox 默认 false——会注入 --no-sandbox，
			// Edge/Chrome 随即弹"你使用的是不受支持的命令行标记 --no-sandbox"警告条，
			// 且真的关闭渲染沙箱是安全降级。桌面环境显式开启沙箱；
			// 万一受限环境（特殊策略/容器）带沙箱启动失败，降级无沙箱重试一次保可用。
			chromiumSandbox: sandbox,
			args: [
				'--no-first-run',
				'--no-default-browser-check',
				// Playwright 官方支持的标准参数：去掉 navigator.webdriver 自动化标记，
				// 降低 LeetCode 风控（腾讯验证码组件）误伤率。仅缓解、不保证通过深度探测；
				// 验证仍失败时引导用户改用 App 扫码登录（不走滑块组件，成功率最高），
				// 或退回手动粘贴 Cookie。
				'--disable-blink-features=AutomationControlled',
				// 抑制 Edge/Chrome 对敏感标记（--disable-blink-features 等）的
				// "你使用的是不受支持的命令行标记"黄色警告条：--test-type 是浏览器
				// 官方文档化的自动化测试模式（Selenium/ChromeDriver 同款做法），
				// 只隐藏警告 UI，不改变 navigator.webdriver 的隐藏效果，也不放行任何安全策略。
				'--test-type'
			]
		});
		try {
			ctx = await launchOnce(true);
		} catch {
			ctx = await launchOnce(false);
		}
		ctx.on('close', () => { browserClosed = true; });

		const page = ctx.pages()[0] || await ctx.newPage();
		// goto 失败不打断等待：登录页没自动打开时用户仍可在窗口里自行导航
		await page.goto('https://leetcode.cn/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { /* ignore */ });

		opts.onStatus?.('waiting-login');
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (browserClosed || opts.isAborted?.()) {
				return { status: 'canceled' };
			}
			await new Promise(resolve => setTimeout(resolve, pollMs));
			let cookies: { name: string; value: string }[];
			try {
				cookies = await ctx.cookies('https://leetcode.cn');
			} catch {
				return { status: 'canceled' }; // 窗口被关，连接已断
			}
			const cookie = extractLeetCodeCookie(cookies);
			if (cookie) {
				opts.onStatus?.('closing');
				return { status: 'success', cookie };
			}
		}
		return { status: 'timeout' };
	} catch (e: any) {
		return { status: 'error', message: String(e?.message || e) };
	} finally {
		if (ctx) {
			try { await ctx.close(); } catch { /* 已被用户关闭 */ }
		}
		// 临时 profile 用完即删；Windows 上浏览器进程退出稍有延迟，重试几次兜底
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
		} catch { /* 极端情况残留一个空临时目录，可接受 */ }
	}
}
