import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateDebugFile } from '../utils/debugUtils';

// 判题比对语义（tuple/list 等价、数值相等、顺序无关场景）活在 Python 驱动的
// same_value/_normalize/_canonical 里。此处从"生成的驱动源码"加载这些函数跑断言，
// 防止改模板时悄悄破坏与 LeetCode 判题机对齐的语义。python3 缺失时跳过（不阻塞 CI 平台差异）。

const PY_ASSERTS = `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("lc_driver", os.environ["LC_DRIVER"])
mod = importlib.util.module_from_spec(spec)
sys.modules["lc_driver"] = mod
spec.loader.exec_module(mod)

# tuple/list 等价（LC 判题按 JSON 序列化比较）
assert mod.same_value((0, 1), [0, 1]) is True
assert mod.same_value([0, 1], (0, 1)) is True
# int/float 数值相等
assert mod.same_value(1, 1.0) is True
# bool 与 int/float 不可互换
assert mod.same_value(True, 1) is False
assert mod.same_value(1, True) is False
# 嵌套列表顺序无关（全排列/子集/异位词分组等）
assert mod.same_value([[1, 2], [3]], [[3], [1, 2]]) is True
# 字符串列表顺序无关（括号生成）
assert mod.same_value(["a", "b"], ["b", "a"]) is True
# 普通整数列表顺序敏感
assert mod.same_value([0, 1], [1, 0]) is False
# 原样相等 / None
assert mod.same_value([1, 3, 12, 0, 0], [1, 3, 12, 0, 0]) is True
assert mod.same_value(None, None) is True
assert mod.same_value(None, [0]) is False
print("PY_OK")
`;

test('Python 驱动比对语义与判题机对齐', (t) => {
	const py = process.platform === 'win32' ? 'python' : 'python3';
	const probe = spawnSync(py, ['--version'], { encoding: 'utf8' });
	if (probe.status !== 0) {
		t.skip('本机无 python，跳过驱动级验证');
		return;
	}

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-driver-test-'));
	try {
		const snippet = 'class Solution:\n    def twoSum(self, nums, target):\n        return []\n';
		const sol = path.join(dir, '1_two-sum.py');
		fs.writeFileSync(sol, snippet);
		const driver = path.join(dir, '1_two-sum_debug.py');
		const gen = generateDebugFile('python3', '1', 'two-sum', '[1, 2]\n3', snippet, sol.replace(/\\/g, '/'), ['[0, 1]']);
		assert.ok(gen, 'generateDebugFile 应返回 python 驱动');
		fs.writeFileSync(driver, gen!.content);

		const res = spawnSync(py, ['-c', PY_ASSERTS], {
			encoding: 'utf8',
			env: { ...process.env, LC_DRIVER: driver }
		});
		assert.equal(res.stdout.includes('PY_OK'), true, `python 断言失败: stdout=${res.stdout}\nstderr=${res.stderr}`);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('generateDebugFile：Python 驱动内嵌期望输出 base64 可解码且不含裸换行注入', () => {
	const snippet = 'class Solution:\n    def f(self, x):\n        return x\n';
	const gen = generateDebugFile('python3', '999', 'sample-slug', '[1]', snippet, '/tmp/999_sample-slug.py', ['[1]', 'bad " quote \\"']);
	assert.ok(gen);
	const m = gen!.content.match(/b64decode\("([^"]+)"\)/);
	assert.ok(m, '驱动应含 base64 期望输出');
	const decoded = JSON.parse(Buffer.from(m![1], 'base64').toString('utf8'));
	// 每项 [是否可 JSON 解析, 值]：'[1]' 可解析；后者是题面非标准文本 → 标 0（驱动侧显示"未校验"）
	assert.deepEqual(decoded, [[1, [1]], [0, 'bad " quote \\"']]);
});
