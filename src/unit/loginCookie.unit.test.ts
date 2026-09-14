import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLeetCodeCookie } from '../utils/loginCookie';

test('buildLeetCodeCookie：两个裸值正常组装', () => {
	assert.equal(buildLeetCodeCookie('eyJabc', 'tok123'), 'LEETCODE_SESSION=eyJabc; csrftoken=tok123');
});

test('buildLeetCodeCookie：整段 Cookie 粘到 session 框，csrf 留空自动拆分', () => {
	const blob = 'LEETCODE_SESSION=eyJabc; csrftoken=tok123; other=x';
	assert.equal(buildLeetCodeCookie(blob, ''), 'LEETCODE_SESSION=eyJabc; csrftoken=tok123');
});

test('buildLeetCodeCookie：整段 Cookie 含前导其他键也能提取', () => {
	const blob = 'foo=1; csrftoken=tok123; LEETCODE_SESSION=eyJabc';
	assert.equal(buildLeetCodeCookie(blob, ''), 'LEETCODE_SESSION=eyJabc; csrftoken=tok123');
});

test('buildLeetCodeCookie：整段 Cookie 粘到 csrf 框（session 框留空）', () => {
	const blob = 'LEETCODE_SESSION=eyJabc; csrftoken=tok123';
	assert.equal(buildLeetCodeCookie('', blob), 'LEETCODE_SESSION=eyJabc; csrftoken=tok123');
});

test('buildLeetCodeCookie：两键凑不齐返回 null', () => {
	assert.equal(buildLeetCodeCookie('eyJabc', ''), null);
	assert.equal(buildLeetCodeCookie('', 'tok'), null);
	assert.equal(buildLeetCodeCookie('', ''), null);
	assert.equal(buildLeetCodeCookie(undefined as any, undefined as any), null);
});

test('buildLeetCodeCookie：裸值两端空白被去除', () => {
	assert.equal(buildLeetCodeCookie('  eyJabc \n', '\ttok123 '), 'LEETCODE_SESSION=eyJabc; csrftoken=tok123');
});
