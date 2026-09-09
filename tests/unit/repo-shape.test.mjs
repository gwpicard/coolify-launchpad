// The records this repository promises exist, and the skills carry the
// frontmatter the family agreed. A missing file fails here before a reader
// finds a dead link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const must = [
  'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE',
  'docs/positioning.md', 'docs/server-model.md', 'docs/design.md', 'docs/sources.md', 'docs/maintaining.md',
  'tests/rehearsal.md', 'servers/example.yaml', '.env.example',
  '.agents/maintainer-skills/humanizer/SKILL.md', '.agents/maintainer-skills/humanizer/LICENSE',
  'tests/lib/rule-shape.sh', 'tools/build-adapters.sh', 'tools/validate.sh',
];

for (const f of must) {
  test(`${f} exists`, () => assert.ok(existsSync(join(root, f)), `${f} is missing`));
}

test('CLAUDE.md is the one-line import', () => {
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
});

for (const name of readdirSync(join(root, 'skills'))) {
  test(`skills/${name} has the agreed frontmatter and a generated adapter`, () => {
    const src = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    for (const key of ['name:', 'description:', 'license: MIT', 'compatibility:', 'author:', 'version:']) {
      assert.ok(fm.includes(key), `${name}: frontmatter lacks ${key}`);
    }
    assert.ok(existsSync(join(root, '.claude/commands', `${name}.md`)), `${name}: no adapter`);
  });
}
