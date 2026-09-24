import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractExampleInputs, extractExamples, extractExpectedOutputs, parseProblemFileName } from '../utils/problemText';

test('extractExpectedOutputs：pre 块排版（中文示例，输出值止于解释）', () => {
	const html = '<p>示例 1：</p><pre>输入：nums = [2,7,11,15], target = 9<br>输出：[0,1]<br>解释：因为 nums[0] + nums[1] == 9</pre>';
	assert.deepEqual(extractExpectedOutputs(html), ['[0,1]']);
});

test('extractExpectedOutputs：多示例 + 示例间互不串段', () => {
	const html =
		'<p>示例 1：</p><pre>输入：nums = [1]<br>输出：[1]<br>解释：x</pre>' +
		'<p>示例 2：</p><pre>输入：nums = []<br>输出：[]<br>解释：y</pre>';
	assert.deepEqual(extractExpectedOutputs(html), ['[1]', '[]']);
});

test('extractExpectedOutputs：末尾跟提示/进阶（无解释段）也能取值', () => {
	const html = '<p>示例 1：</p><pre>输入：x = 1<br>输出：2</pre><p>提示：</p><ul><li>1 &lt;= x</li></ul>';
	assert.deepEqual(extractExpectedOutputs(html), ['2']);
});

test('extractExpectedOutputs：英文题面', () => {
	const html = '<p>Example 1:</p><pre>Input: nums = [1,2]<br>Output: 3<br>Explanation: z</pre>';
	assert.deepEqual(extractExpectedOutputs(html), ['3']);
});

test('extractExpectedOutputs：HTML 实体还原（&quot; 出现在字符串输出里）', () => {
	const html = '<p>示例 1：</p><pre>输入：s = &quot;ab&quot;<br>输出：&quot;ba&quot;<br>解释：x</pre>';
	assert.deepEqual(extractExpectedOutputs(html), ['"ba"']);
});

test('extractExpectedOutputs：空输入返回空数组', () => {
	assert.deepEqual(extractExpectedOutputs(''), []);
});

test('parseProblemFileName：题解文件/调试驱动/非法名', () => {
	assert.deepEqual(parseProblemFileName('1_two-sum.py'), { questionId: '1', titleSlug: 'two-sum', isDebug: false });
	assert.deepEqual(parseProblemFileName('283_move-zeroes_debug.py'), { questionId: '283', titleSlug: 'move-zeroes', isDebug: true });
	assert.deepEqual(parseProblemFileName('146_lru-cache.java'), { questionId: '146', titleSlug: 'lru-cache', isDebug: false });
	assert.equal(parseProblemFileName('main.cpp'), null);
	assert.equal(parseProblemFileName('README.md'), null);
});

test('extractExampleInputs：多参数「名字 = 值」按序解析为 JSON 值', () => {
	const html = '<p>示例 1：</p><pre>输入：list1 = [1,2,4], list2 = [1,3,4]<br>输出：[1,1,2,3,4,4]</pre>';
	assert.deepEqual(extractExampleInputs(html), [[[1, 2, 4], [1, 3, 4]]]);
});

test('extractExampleInputs：数组+标量混合、null 值与字符串值', () => {
	const html =
		'<p>示例 1：</p><pre>输入：root = [1,null,2,3]<br>输出：[1,3,2]</pre>' +
		'<p>示例 2：</p><pre>输入：s = &quot;3[a]2[bc]&quot;<br>输出：&quot;aaabcbc&quot;</pre>' +
		'<p>示例 3：</p><pre>输入：nums = [-2,1], k = 2<br>输出：-1</pre>';
	assert.deepEqual(extractExampleInputs(html), [
		[[1, null, 2, 3]],
		['3[a]2[bc]'],
		[[-2, 1], 2]
	]);
});

test('extractExampleInputs：裸值输入（无参数名）与空输入段', () => {
	const html = '<p>示例 1：</p><pre>输入：[1,2,3]<br>输出：6</pre>';
	assert.deepEqual(extractExampleInputs(html), [[[1, 2, 3]]]);
	const none = '<p>示例 1：</p><pre>输出：6<br>解释：x</pre>';
	assert.deepEqual(extractExampleInputs(none), []);
});

test('extractExampleInputs：任一示例解析失败整体返回 []（退回位置配对）', () => {
	const html =
		'<p>示例 1：</p><pre>输入：nums = [1]<br>输出：[1]</pre>' +
		'<p>示例 2：</p><pre>输入：链表 = 1 -&gt; 2<br>输出：[]</pre>';
	assert.deepEqual(extractExampleInputs(html), []);
});

test('extractExampleInputs：Python 风格单引号归一为 JSON（79/200 题面形态）', () => {
	const html = `<p>示例 1：</p><pre>输入：board = [['A','B']], word = "AB"<br>输出：true</pre>`;
	assert.deepEqual(extractExampleInputs(html), [[[['A', 'B']], 'AB']]);
});

test('extractExamples：输入输出同切段同序（配对锚点与期望一致）', () => {
	const html =
		'<p>示例 1：</p><pre>输入：nums = [1,null,2,3]<br>输出：[1,3,2]</pre>' +
		'<p>示例 2：</p><pre>输入：nums = []<br>输出：[]</pre>';
	const entries = extractExamples(html);
	assert.equal(entries.length, 2);
	assert.deepEqual(extractExpectedOutputs(html), ['[1,3,2]', '[]']);
	assert.equal(entries[0].input, 'nums = [1,null,2,3]');
});
