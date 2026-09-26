// The records this repository promises exist, and the skills carry the
// frontmatter the family agreed. A missing file fails here before a reader
// finds a dead link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { skillFolders } from '../../scripts/skill-folders.mjs';

const root = new URL('../..', import.meta.url).pathname;
const must = [
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE',
  'docs/positioning.md', 'docs/server-model.md', 'docs/design.md', 'docs/sources.md', 'docs/maintaining.md',
  'docs/before-you-launch.md',
  'skills/launch-server/references/interview.md', 'skills/launch-server/references/preflight.md',
  'skills/launch-server/references/server-block.md',
  'tests/rehearsal.md', 'servers/example.yaml', '.env.example',
  '.agents/maintainer-skills/humanizer/SKILL.md', '.agents/maintainer-skills/humanizer/LICENSE',
  'tests/lib/rule-shape.sh', 'tools/build-adapters.sh', 'tools/validate.sh', '.githooks/commit-msg',
];

for (const f of must) {
  test(`${f} exists`, () => assert.ok(existsSync(join(root, f)), `${f} is missing`));
}

test('CLAUDE.md is the one-line import', () => {
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
});

// A Mac checkout can hold a .DS_Store here that a clean clone never has, so
// the listing reads directories only.
test('the skills listing skips stray files and dot folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  try {
    cpSync(join(root, 'skills'), dir, { recursive: true });
    writeFileSync(join(dir, '.DS_Store'), '');
    writeFileSync(join(dir, 'notes.txt'), '');
    mkdirSync(join(dir, '.hidden'));
    assert.deepEqual(skillFolders(dir), ['check-server', 'launch-server', 'retire-server']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const name of skillFolders(join(root, 'skills'))) {
  test(`skills/${name} has the agreed frontmatter and a generated adapter`, () => {
    const src = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    for (const key of ['name:', 'description:', 'license: MIT', 'compatibility:', 'author:', 'version:']) {
      assert.ok(fm.includes(key), `${name}: frontmatter lacks ${key}`);
    }
    assert.ok(existsSync(join(root, '.claude/commands', `${name}.md`)), `${name}: no adapter`);
  });
}
