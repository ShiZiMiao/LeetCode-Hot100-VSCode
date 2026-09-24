import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientNetworkError, computeRetrySafe, retryTransient } from '../utils/networkRetry';

test('isTransientNetworkError：瞬时故障（消息/错误码）判定', () => {
	const cases: Array<[any, boolean]> = [
		[{ message: 'socket hang up' }, true],
		[{ message: 'Client network socket disconnected before secure TLS connection was established' }, true],
		[{ code: 'ECONNRESET' }, true],
		[{ code: 'EAI_AGAIN' }, true],
		[{ code: 'ETIMEDOUT' }, true],
		[{ code: 'ENOTFOUND' }, true],
		[{ message: '请求超时: /graphql' }, true],
		[{ message: 'Request failed with status 500: server error' }, false],
		[{ message: 'invalid json' }, false],
		[null, false],
		[undefined, false]
	];
	for (const [err, expected] of cases) {
		assert.equal(isTransientNetworkError(err), expected, `err=${JSON.stringify(err)}`);
	}
});

test('computeRetrySafe：重试幂等判定表（方法 × 请求体是否发完 × 是否握手期断开）', () => {
	const HS = 'Client network socket disconnected before secure TLS connection was established';
	const PLAIN = 'socket hang up';
	// GET 恒可重试
	assert.equal(computeRetrySafe('GET', true, PLAIN), true);
	assert.equal(computeRetrySafe('GET', false, PLAIN), true);
	// POST：请求体未完整发出 → 服务器没收到 → 可重试
	assert.equal(computeRetrySafe('POST', false, PLAIN), true);
	// POST：请求体已发完且非握手期断开 → 服务器可能已执行（提交类）→ 不可重试
	assert.equal(computeRetrySafe('POST', true, PLAIN), false);
	// POST：请求体发完但断开发生在 TLS 握手期 → 服务器必然没收到 → 可重试
	assert.equal(computeRetrySafe('POST', true, HS), true);
});

test('retryTransient：瞬断重试后成功 / 非瞬断不重试 / 超次抛错', async () => {
	// 前两次瞬断、第三次成功
	let calls = 0;
	const ok = await retryTransient(async () => {
		calls++;
		if (calls < 3) {
			throw new Error('Client network socket disconnected before secure TLS connection was established');
		}
		return 'done';
	}, 3, 0);
	assert.equal(ok, 'done');
	assert.equal(calls, 3);
	// 非瞬断错误（如安全校验拒绝/HTTP 4xx）立即抛出，不浪费重试
	calls = 0;
	await assert.rejects(
		retryTransient(async () => {
			calls++;
			throw new Error('仅支持 https 下载: http://x');
		}, 3, 0),
		/仅支持 https 下载/
	);
	assert.equal(calls, 1);
	// 一直瞬断 → 达到 maxAttempts 后抛出最后一次错误
	calls = 0;
	await assert.rejects(
		retryTransient(async () => {
			calls++;
			throw new Error('socket hang up');
		}, 3, 0),
		/socket hang up/
	);
	assert.equal(calls, 3);
});
