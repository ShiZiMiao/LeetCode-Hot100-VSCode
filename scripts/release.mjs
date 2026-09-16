#!/usr/bin/env node
/**
 * 发布脚本：pnpm release <version> [--dry-run]
 *
 * 流程：版本与 CHANGELOG 校验 → 更新 package.json 版本 → vsce 打包（固定参数）
 * → git commit/tag/push → gh release（挂 VSIX 资产）→ Open VSX 发布（OVSX_PAT 存在时）
 * → 输出 Marketplace 手动上传指引（该步骤无 API，固定由用户手动网页上传）。
 *
 * 注意：本脚本只做"发版动作"，是否发版仍由用户明确指示后才运行；
 * 当前工作区有未提交改动时会终止并要求先提交。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry-run');
const version = process.argv.find(a => /^\d+\.\d+\.\d+$/.test(a));
if (!version) {
  console.error('用法: pnpm release <version>  (如 pnpm release 0.2.0)');
  process.exit(1);
}

// 全局 npm 工具（vsce/ovsx/gh）路径加入 PATH（Windows 用户目录安装）
const npmBin = path.join(process.env.APPDATA || '', 'npm');
if (fs.existsSync(npmBin)) {
  process.env.PATH = npmBin + path.delimiter + process.env.PATH;
}

const fail = (msg) => {
  console.error('✗ ' + msg);
  process.exit(1);
};
const step = (msg) => console.log('\n▶ ' + msg);
const run = (cmd) => {
  console.log('  $ ' + cmd);
  if (!DRY) {
    execSync(cmd, { stdio: 'inherit', shell: true });
  }
};

// ---------- 校验 ----------
step(`校验版本 ${version}`);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (pkg.version === version) fail(`package.json 已是 ${version}`);
const cur = pkg.version.split('.').map(Number);
const next = version.split('.').map(Number);
if (next[0] < cur[0] || (next[0] === cur[0] && (next[1] < cur[1] || (next[1] === cur[1] && next[2] <= cur[2])))) {
  fail(`新版本 ${version} 未高于当前 ${pkg.version}`);
}

const changelog = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf8') : '';
const entryRe = /^##\s+\[?(\d+\.\d+\.\d+)\]?/gm;
let entryStart = -1;
let entryEnd = -1;
for (const m of changelog.matchAll(entryRe)) {
  if (m[1] === version) {
    entryStart = m.index;
    break;
  }
}
if (entryStart < 0) fail(`CHANGELOG.md 缺少 ${version} 条目，请先补写再发布`);
const after = changelog.slice(entryStart + changelog.slice(entryStart).indexOf('\n'));
const nextEntry = after.match(entryRe);
entryEnd = nextEntry ? after.indexOf(nextEntry[0]) : after.length;
const releaseNotes = after.slice(0, entryEnd).trim() || `release ${version}`;

// 工作区状态检查
if (!DRY) {
  const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
  if (status) {
    fail(`工作区有未提交改动，请先提交后再发布：\n${status.split('\n').slice(0, 10).join('\n')}`);
  }
}

// ---------- 执行 ----------
step('更新 package.json 版本号');
pkg.version = version;
if (!DRY) {
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
}

step('vsce 打包（--no-dependencies --skip-license --readme-path MARKETPLACE.md）');
const vsix = 'Hot100-for-VSCode.vsix';
run(`vsce package --out ${vsix} --no-dependencies --skip-license --readme-path MARKETPLACE.md`);

step('git 提交 + 打标签 + 推送');
run('git add package.json CHANGELOG.md README.md MARKETPLACE.md AGENTS.md src tsconfig.json scripts');
run(`git commit -m "release: ${version}"`);
run(`git tag v${version}`);
run('git push');
run('git push --tags');

step(`创建 GitHub Release v${version} 并挂载 VSIX`);
const notesFile = path.join(os.tmpdir(), `release-notes-${version}.txt`);
fs.writeFileSync(notesFile, releaseNotes, 'utf8');
run(`gh release create v${version} ${vsix} --title "LeetCode Hot100 Pro v${version}" --notes-file ${JSON.stringify(notesFile)}`);

step('Open VSX 发布');
if (process.env.OVSX_PAT) {
  run(`ovsx publish ${vsix}`);
  console.log('  Open VSX 发布完成（新扩展首次约 1~2 分钟过审，可用 curl https://open-vsx.org/api/ShiZiMiao/leetcode/latest 验证）');
} else {
  console.log('  未检测到 OVSX_PAT，跳过。手动发布：');
  console.log('  1) open-vsx.org → 头像 → Access Tokens → Generate new token');
  console.log('  2) OVSX_PAT=<token> ovsx publish ' + vsix);
}

console.log('\n✔ 发布流程执行完毕。最后一步需要手动完成：');
console.log('  Marketplace 管理页 → 扩展条目 → 上传 ' + path.resolve(vsix) + '（打开管理页 → New extension → Visual Studio Code → 选择 VSIX → Upload）');
if (DRY) {
  console.log('\n（--dry-run：以上步骤仅打印未执行）');
}