#!/usr/bin/env node
// Every version this repository states must equal package.json's: each skill's
// metadata.version, and a CHANGELOG.md entry for it. A stamp that matches
// nothing reports success and ships the previous number, so the check names
// every file that is out of step rather than the first.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillFolders } from './skill-folders.mjs';

const root = new URL('..', import.meta.url).pathname;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const wrong = [];

for (const name of skillFolders(join(root, 'skills'))) {
  const file = join(root, 'skills', name, 'SKILL.md');
  const src = readFileSync(file, 'utf8');
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const found = fm.match(/^\s+version:\s*"?([^"\n]+)"?\s*$/m)?.[1];
  if (found !== version) wrong.push(`skills/${name}/SKILL.md: ${found ?? 'missing'}`);
  const declared = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  if (declared !== name) wrong.push(`skills/${name}/SKILL.md: name "${declared}" != directory`);
}

// 0.0.0 is the pre-release stamp; its changelog entry is "Unreleased".
const heading = version === '0.0.0' ? 'Unreleased' : version.replace(/\./g, '\\.');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## ${heading}\\b`, 'm').test(changelog)) wrong.push(`CHANGELOG.md: no "## ${version === '0.0.0' ? 'Unreleased' : version}" entry`);

if (wrong.length) {
  console.error(`package.json is ${version}; out of sync:\n  ${wrong.join('\n  ')}`);
  process.exit(1);
}
console.log(`All versions are ${version}`);
