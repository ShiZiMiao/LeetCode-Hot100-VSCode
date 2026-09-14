import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientNetworkError, computeRetrySafe } from '../utils/networkRetry';

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
