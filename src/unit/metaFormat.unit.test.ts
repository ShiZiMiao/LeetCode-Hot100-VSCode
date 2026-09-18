/**
 * metaFormat 元数据格式化纯逻辑单测
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import { formatAcRate } from '../utils/metaFormat';

test('formatAcRate：接口值为 0~1 小数（如 0.552 → 55.2%），兼容百分数', () => {
    // leetcode.cn 列表/详情接口的 acRate 是小数
    assert.strictEqual(formatAcRate(0.5523060273503219), '55.2%');
    assert.strictEqual(formatAcRate(0.4291), '42.9%');
    assert.strictEqual(formatAcRate(0.5), '50%');
    assert.strictEqual(formatAcRate(0.556), '55.6%');
    assert.strictEqual(formatAcRate(1), '100%');
    assert.strictEqual(formatAcRate(0), '0%');
    // 防御：个别数据源直接给百分数
    assert.strictEqual(formatAcRate(72.5), '72.5%');
    assert.strictEqual(formatAcRate(64), '64%');
    assert.strictEqual(formatAcRate(64.34), '64.3%');
    assert.strictEqual(formatAcRate(undefined), undefined);
    assert.strictEqual(formatAcRate(null), undefined);
    assert.strictEqual(formatAcRate(-1), undefined);
    assert.strictEqual(formatAcRate(101), undefined);
    assert.strictEqual(formatAcRate(Number.NaN), undefined);
});