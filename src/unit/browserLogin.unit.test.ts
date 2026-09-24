import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLeetCodeCookie, candidateChromiumPaths, pickChromiumChannel, loginWithBrowser, classifyDefaultBrowser, parseRegProgId, detectDefaultBrowser } from '../core/browserLogin';

test('extractLeetCodeCookie：两项齐全则组装 Cookie 串', () => {
	const cookie = extractLeetCodeCookie([
		{ name: 'aliyungf_tc', value: 'noise' },
		{ name: 'LEETCODE_SESSION', value: 'eyJhbGciOiJSUzI1NiJ9.x' },
		{ name: 'csrftoken', value: 'abc123' }
	]);
	assert.equal(cookie, 'LEETCODE_SESSION=eyJhbGciOiJSUzI1NiJ9.x; csrftoken=abc123');
});

test('extractLeetCodeCookie：JWT 值含 = / ; 不截断（精确按 name 匹配，不用正则）', () => {
	const cookie = extractLeetCodeCookie([
		{ name: 'LEETCODE_SESSION', value: 'eyJhbGci==;==padding' },
		{ name: 'csrftoken', value: 'a=b=c' }
	]);
	assert.equal(cookie, 'LEETCODE_SESSION=eyJhbGci==;==padding; csrftoken=a=b=c');
});

test('extractLeetCodeCookie：缺任一项返回 null（视为未登录完成）', () => {
	assert.equal(extractLeetCodeCookie([{ name: 'LEETCODE_SESSION', value: 'x' }]), null);
	assert.equal(extractLeetCodeCookie([{ name: 'csrftoken', value: 'y' }]), null);
	assert.equal(extractLeetCodeCookie([]), null);
	// 空串值不算已登录
	assert.equal(extractLeetCodeCookie([{ name: 'LEETCODE_SESSION', value: '' }, { name: 'csrftoken', value: 'y' }]), null);
});

const WIN_ENV = {
	'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
	'PROGRAMFILES': 'C:/Program Files',
	'LOCALAPPDATA': 'C:/Users/x/AppData/Local'
} as NodeJS.ProcessEnv;

test('candidateChromiumPaths：win32 优先 Edge，且覆盖三个安装根目录', () => {
	const list = candidateChromiumPaths('win32', WIN_ENV);
	assert.equal(list[0].channel, 'msedge');
	assert.ok(list.some(c => c.channel === 'msedge' && c.exe.includes('Program Files (x86)')));
	assert.ok(list.some(c => c.channel === 'chrome' && c.exe.includes('Google')));
});

test('candidateChromiumPaths：darwin 使用 /Applications 路径', () => {
	const list = candidateChromiumPaths('darwin', {});
	assert.equal(list.length, 2);
	assert.ok(list[0].exe.startsWith('/Applications/Microsoft Edge.app'));
	assert.ok(list[1].exe.startsWith('/Applications/Google Chrome.app'));
});

test('pickChromiumChannel：Edge 优先；无 Edge 退 Chrome；全无返回 null', () => {
	const edgeOnly = (p: string) => p.includes('Microsoft') && p.endsWith('msedge.exe');
	assert.equal(pickChromiumChannel(edgeOnly, 'win32', WIN_ENV), 'msedge');
	const chromeOnly = (p: string) => p.includes('Google') && p.endsWith('chrome.exe');
	assert.equal(pickChromiumChannel(chromeOnly, 'win32', WIN_ENV), 'chrome');
	assert.equal(pickChromiumChannel(() => false, 'win32', WIN_ENV), null);
	// existsSync 抛异常按不存在处理
	assert.equal(pickChromiumChannel(() => { throw new Error('EPERM'); }, 'win32', WIN_ENV), null);
});

test('classifyDefaultBrowser：Windows ProgId 与 linux 桌面名分类', () => {
	assert.deepEqual(classifyDefaultBrowser('MSEdgeHTM'), { kind: 'chromium', channel: 'msedge' });
	assert.deepEqual(classifyDefaultBrowser('ChromeHTML'), { kind: 'chromium', channel: 'chrome' });
	assert.deepEqual(classifyDefaultBrowser('ChromeHTT'), { kind: 'chromium', channel: 'chrome' });
	assert.deepEqual(classifyDefaultBrowser('google-chrome.desktop'), { kind: 'chromium', channel: 'chrome' });
	assert.deepEqual(classifyDefaultBrowser('microsoft-edge.desktop'), { kind: 'chromium', channel: 'msedge' });
	// Firefox / Chromium 分支（Tabbit/Opera 等）：不可驱动，走回退
	assert.equal(classifyDefaultBrowser('FirefoxHTTPS-308046B0AF4A39CB').kind, 'other');
	assert.equal(classifyDefaultBrowser('Tabbit Browser.KTYN75QE3DCFAQRX66ZKKJ4PPE').kind, 'other');
	assert.equal(classifyDefaultBrowser('MSEdgeHTM').kind, 'chromium');
	assert.deepEqual(classifyDefaultBrowser(null), { kind: 'unknown' });
});

test('parseRegProgId：reg query 输出提取；异常输出返回 null', () => {
	assert.equal(parseRegProgId('\nHKEY_CURRENT_USER\\...\\UserChoice\n    ProgId    REG_SZ    MSEdgeHTM\n    Hash    REG_SZ    xxx=\n'), 'MSEdgeHTM');
	assert.equal(parseRegProgId('错误: 系统找不到指定的注册表项或值。'), null);
	assert.equal(parseRegProgId(null), null);
});

test('detectDefaultBrowser：win32 https 优先、失败回退 http、全失败 unknown', () => {
	const regOut = (progId: string) => ({ status: 0, stdout: `    ProgId    REG_SZ    ${progId}\n` });
	const calls: string[] = [];
	assert.deepEqual(
		detectDefaultBrowser((_cmd, args) => {
			calls.push(args[1] || '');
			return args[1] && args[1].includes('https') ? regOut('MSEdgeHTM') : { status: 1, stdout: '' };
		}, 'win32'),
		{ kind: 'chromium', channel: 'msedge' }
	);
	// https 键不存在（Win10 部分版本只有 http 关联）→ 回退 http
	const r2 = detectDefaultBrowser((_cmd, args) => (args[1] && args[1].includes('http\\') ? regOut('ChromeHTML') : { status: 1, stdout: '' }), 'win32');
	assert.deepEqual(r2, { kind: 'chromium', channel: 'chrome' });
	// 两个键都没有 → unknown
	assert.deepEqual(detectDefaultBrowser(() => ({ status: 1, stdout: '' }), 'win32'), { kind: 'unknown' });
});

test('detectDefaultBrowser：linux 走 xdg-settings；mac 返回 unknown', () => {
	assert.deepEqual(
		detectDefaultBrowser(() => ({ status: 0, stdout: 'microsoft-edge.desktop\n' }), 'linux'),
		{ kind: 'chromium', channel: 'msedge' }
	);
	assert.equal(detectDefaultBrowser(() => { throw new Error('ENOENT'); }, 'linux').kind, 'unknown');
	assert.deepEqual(detectDefaultBrowser(() => ({ status: 0, stdout: 'whatever' }), 'darwin'), { kind: 'unknown' });
});

test('loginWithBrowser：launch 抛错（如浏览器损坏）返回 error 且不解包崩溃', async () => {
	const result = await loginWithBrowser({
		channel: 'msedge',
		requirePlaywright: () => {
			return { chromium: { launchPersistentContext: async () => { throw new Error('Executable doesn\'t exist'); } } };
		},
		timeoutMs: 2000
	});
	assert.equal(result.status, 'error');
	assert.match(result.message || '', /Executable doesn't exist/);
});

test('loginWithBrowser：带沙箱启动失败时降级为无沙箱重试一次（选项 chromiumSandbox true→false）', async () => {
	const seenSandboxFlags: unknown[] = [];
	const makeCtx = () => ({
		on: (_e: string, _cb: () => void) => { /* noop */ },
		pages: () => [{ goto: async () => undefined }],
		cookies: async () => [
			{ name: 'LEETCODE_SESSION', value: 'jwt' },
			{ name: 'csrftoken', value: 'csrf' }
		],
		close: async () => { /* noop */ }
	});
	let calls = 0;
	const result = await loginWithBrowser({
		channel: 'msedge',
		requirePlaywright: () => ({
			chromium: {
				launchPersistentContext: async (_dir: string, options: { chromiumSandbox?: boolean }) => {
					calls++;
					seenSandboxFlags.push(options.chromiumSandbox);
					if (calls === 1) {
						throw new Error('Sandbox launch failed');
					}
					return makeCtx();
				}
			}
		}),
		pollMs: 10,
		timeoutMs: 5000
	});
	assert.equal(result.status, 'success');
	assert.equal(calls, 2);
	assert.deepEqual(seenSandboxFlags, [true, false]);
});

test('loginWithBrowser：mock 上下文——轮询到 Cookie 即成功返回', async () => {
	let polls = 0;
	let launchArgs: string[] = [];
	const makeCtx = () => ({
		on: (_e: string, _cb: () => void) => { /* noop */ },
		pages: () => [makePage()],
		newPage: async () => makePage(),
		cookies: async () => {
			polls++;
			// 前两次未登录，第三次出现完整会话对
			if (polls < 3) {
				return [{ name: 'sl-session', value: 'x' }];
			}
			return [
				{ name: 'LEETCODE_SESSION', value: 'jwt-value' },
				{ name: 'csrftoken', value: 'csrf-value' }
			];
		},
		close: async () => { /* noop */ }
	});
	const makePage = () => ({ goto: async () => { /* ok */ } });

	const result = await loginWithBrowser({
		channel: 'msedge',
		requirePlaywright: () => ({
			chromium: {
				launchPersistentContext: async (_dir: string, options: { args?: string[] }) => {
					launchArgs = options.args || [];
					return makeCtx();
				}
			}
		}),
		pollMs: 10,
		timeoutMs: 5000
	});
	assert.equal(result.status, 'success');
	assert.equal(result.cookie, 'LEETCODE_SESSION=jwt-value; csrftoken=csrf-value');
	// 风控缓解与警告条抑制的关键参数必须都在
	assert.ok(launchArgs.includes('--disable-blink-features=AutomationControlled'), '缺去 webdriver 标记参数');
	assert.ok(launchArgs.includes('--test-type'), '缺警告条抑制参数');
});

test('loginWithBrowser：isAborted 置位后快速取消并关闭浏览器', async () => {
	let closed = false;
	const ctx = {
		on: (_e: string, _cb: () => void) => { /* noop */ },
		pages: () => [{ goto: async () => undefined }],
		cookies: async () => [],
		close: async () => { closed = true; }
	};
	const result = await loginWithBrowser({
		channel: 'chrome',
		requirePlaywright: () => ({ chromium: { launchPersistentContext: async () => ctx } }),
		pollMs: 10,
		timeoutMs: 5000,
		isAborted: () => true
	});
	assert.equal(result.status, 'canceled');
	assert.equal(closed, true, '取消路径必须关闭浏览器');
});

test('loginWithBrowser：cookies() 抛错（窗口被用户关闭）按取消处理', async () => {
	const ctx = {
		on: (_e: string, _cb: () => void) => { /* noop */ },
		pages: () => [{ goto: async () => undefined }],
		cookies: async () => { throw new Error('Target page, context or browser has been closed'); },
		close: async () => { /* noop */ }
	};
	const result = await loginWithBrowser({
		channel: 'msedge',
		requirePlaywright: () => ({ chromium: { launchPersistentContext: async () => ctx } }),
		pollMs: 10,
		timeoutMs: 5000
	});
	assert.equal(result.status, 'canceled');
});
