import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgeReport, formatJudgeValue, buildCaseSections, collectJudgeCaseInfos } from '../utils/judgeReport';

test('formatJudgeValue：数组逐项去尾拼接、对象 JSON 化、空值空串', () => {
	assert.equal(formatJudgeValue(['a\n', 'b\n', '']), 'a\nb');
	assert.equal(formatJudgeValue({ x: 1 }), '{"x":1}');
	assert.equal(formatJudgeValue(undefined), '');
	assert.equal(formatJudgeValue(null), '');
	assert.equal(formatJudgeValue('text\n'), 'text');
});

test('buildCaseSections：runCode 逐用例分组（含空串收尾、首个用例失败第二个通过）', () => {
	const check = {
		status_msg: 'Wrong Answer',
		total_correct: 1,
		total_testcases: 2,
		compare_result: '01',
		code_answer: ['[1,0,3,12,0]\n', '[0]\n', ''],
		expected_code_answer: ['[1,3,12,0,0]\n', '[0]\n', '']
	};
	const sections = buildCaseSections(check, '[0,1,0,3,12]\n[0]');
	assert.ok(sections, '应能分组');
	assert.equal(sections!.length, 2);
	assert.match(sections![0], /【用例 1】❌ 未通过/);
	assert.match(sections![0], /输入：\n\[0,1,0,3,12\]/);
	assert.match(sections![0], /输出：\n\[1,0,3,12,0\]/);
	assert.match(sections![0], /预期结果：\n\[1,3,12,0,0\]/);
	assert.match(sections![1], /【用例 2】✅ 通过/);
});

test('buildCaseSections：多参数题按行数均分还原逐用例输入', () => {
	const check = {
		total_testcases: 3,
		compare_result: '110',
		code_answer: ['[0,1]', '[1,2]', '[]'],
		expected_code_answer: ['[0,1]', '[1,2]', '[0,1]']
	};
	const sections = buildCaseSections(check, '[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6');
	assert.ok(sections);
	assert.equal(sections!.length, 3);
	assert.match(sections![0], /输入：\n\[2,7,11,15\]\n9\n输出/);
	assert.match(sections![2], /【用例 3】❌ 未通过/);
});

test('buildCaseSections：提交场景无数组返回 undefined（调用方回退汇总格式）', () => {
	const check = { status_msg: 'Accepted', total_testcases: 50, total_output: 'x\ny', expected_output: 'x\ny' };
	assert.equal(buildCaseSections(check, 'a\nb'), undefined);
});

test('buildCaseSections：compare_result 混入非 0/1 字符时不显示逐用例状态', () => {
	const check = {
		total_testcases: 2,
		compare_result: '1null',
		code_answer: ['1', '0'],
		expected_code_answer: ['1', '0']
	};
	const sections = buildCaseSections(check, '');
	assert.ok(sections);
	assert.doesNotMatch(sections![0], /通过|未通过/);
});

test('buildJudgeReport：测试场景详情含逐用例组与首个未通过用例', () => {
	const check = {
		status_msg: 'Wrong Answer',
		status_runtime: '8 ms',
		status_memory: '16.2 MB',
		total_correct: 1,
		total_testcases: 2,
		compare_result: '01',
		code_answer: ['[1,0,3,12,0]\n', '[0]\n'],
		expected_code_answer: ['[1,3,12,0,0]\n', '[0]\n']
	};
	const { summary, detail } = buildJudgeReport(check, '[0,1,0,3,12]\n[0]', false);
	assert.equal(summary, '解答错误 (Wrong Answer)，1/2 个用例通过');
	assert.match(detail, /❌【判题结果】/);
	assert.match(detail, /🔍 首个未通过用例: 第 1 个/);
	assert.match(detail, /【用例 1】/);
	assert.match(detail, /【用例 2】/);
});

test('buildJudgeReport：提交场景回退汇总三段', () => {
	const check = {
		status_msg: 'Accepted',
		total_correct: 85,
		total_testcases: 85,
		code_output: '',
		total_output: 'null\nnull',
		expected_output: 'null\nnull'
	};
	const { detail } = buildJudgeReport(check, undefined, true);
	assert.match(detail, /✅【判题结果】通过 \(Accepted\)，85\/85 个用例通过/);
	assert.match(detail, /📤【输出】/);
	assert.match(detail, /🎯【预期结果】/);
});

test('buildJudgeReport：memory 字节数自适应 KB/MB 展示', () => {
	const small = buildJudgeReport({ status_msg: 'Wrong Answer', memory: 2048 }, undefined, false).detail;
	assert.match(small, /2\.0 KB/);
	const big = buildJudgeReport({ status_msg: 'Wrong Answer', memory: 18 * 1024 * 1024 }, undefined, false).detail;
	assert.match(big, /18\.0 MB/);
});

test('buildJudgeReport：编译/运行时错误段透出', () => {
	const detail = buildJudgeReport({
		status_msg: 'Compile Error',
		full_compile_error: 'error: expected declaration'
	}, undefined, false).detail;
	assert.match(detail, /⚠️【编译错误】\nerror: expected declaration/);
});

test('collectJudgeCaseInfos：runCode 多用例逐项还原（含空串收尾、多参数均分）', () => {
	const check = {
		status_msg: 'Wrong Answer',
		total_correct: 1,
		total_testcases: 2,
		compare_result: '01',
		code_answer: ['[1,0,3,12,0]\n', '[0]\n', ''],
		expected_code_answer: ['[1,3,12,0,0]\n', '[0]\n', '']
	};
	const infos = collectJudgeCaseInfos(check, '[0,1,0,3,12]\n[0]');
	assert.equal(infos.length, 2);
	assert.deepEqual(infos[0], {
		index: 1, input: '[0,1,0,3,12]', output: '[1,0,3,12,0]', expected: '[1,3,12,0,0]', passed: false, known: true
	});
	assert.deepEqual(infos[1], {
		index: 2, input: '[0]', output: '[0]', expected: '[0]', passed: true, known: true
	});
});

test('collectJudgeCaseInfos：多参数题按行数均分还原逐用例输入', () => {
	const check = {
		total_testcases: 3,
		compare_result: '110',
		code_answer: ['[0,1]', '[1,2]', '[]'],
		expected_code_answer: ['[0,1]', '[1,2]', '[0,1]']
	};
	const infos = collectJudgeCaseInfos(check, '[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6');
	assert.equal(infos.length, 3);
	assert.equal(infos[0].input, '[2,7,11,15]\n9');
	assert.equal(infos[1].input, '[3,2,4]\n6');
	assert.equal(infos[2].passed, false);
	assert.equal(infos[2].expected, '[0,1]');
});

test('collectJudgeCaseInfos：提交 WA 回退单条用例（输入/输出/预期取响应字段）', () => {
	const check = {
		status_msg: 'Wrong Answer',
		input: '[2,1]',
		code_output: '[1,2]',
		expected_output: '[2,1]'
	};
	const infos = collectJudgeCaseInfos(check);
	assert.equal(infos.length, 1);
	assert.deepEqual(infos[0], {
		index: 1, input: '[2,1]', output: '[1,2]', expected: '[2,1]', passed: false, known: true
	});
});

test('collectJudgeCaseInfos：Accepted 提交无失败用例', () => {
	const infos = collectJudgeCaseInfos({ status_msg: 'Accepted', total_correct: 75, total_testcases: 75 });
	assert.deepEqual(infos, []);
});

test('collectJudgeCaseInfos：输入行数不能整除时用例 input 为空（判为不可调试）', () => {
	const check = {
		total_testcases: 2,
		compare_result: '00',
		code_answer: ['a', 'b'],
		expected_code_answer: ['a', 'b']
	};
	const infos = collectJudgeCaseInfos(check, 'x\ny\nz');
	assert.equal(infos.length, 2);
	assert.equal(infos[0].input, '');
	assert.equal(infos[1].input, '');
});

test('collectJudgeCaseInfos：compare_result 非纯 0/1 串时 known=false（不误判失败）', () => {
	const check = {
		total_testcases: 2,
		compare_result: '1null',
		code_answer: ['1', '0'],
		expected_code_answer: ['1', '0']
	};
	const infos = collectJudgeCaseInfos(check, '');
	assert.equal(infos.length, 2);
	assert.equal(infos[0].known, false);
	assert.equal(infos[1].known, false);
});
