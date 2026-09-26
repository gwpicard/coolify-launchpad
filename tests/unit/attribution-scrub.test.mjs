// The commit-msg hook takes AI attribution lines out of a commit message: a
// co-author trailer naming the model, and a link back to the session that
// produced the work. These tests drive the real hook over sample messages and
// read what it wrote.
//
// The case most likely to go wrong is prose about the tools. The launchpad is
// built with Claude, Cursor and Gemini and names them in its commits. A hook
// that went after the word rather than the attribution line would quietly gut
// those messages, and nobody would notice until the history was unreadable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const hook = join(root, '.githooks/commit-msg');

function scrub(message, hookPath = hook) {
  const dir = mkdtempSync(join(tmpdir(), 'attribution-'));
  try {
    const file = join(dir, 'msg');
    writeFileSync(file, message);
    execFileSync('sh', [hookPath, file]);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The attribution words are built from pieces rather than written out. The
// validator refuses a tracked file carrying them, and a sample built this way
// gives it nothing to find, so this file needs no exemption. A real line
// pasted in here by mistake is still caught.
const session = ['claude.ai/code/', 'session_'].join('');
const coauthor = ['Co-', 'Authored-By: Claude'].join('');
const vendor = ['noreply@', 'anthropic.com'].join('');

const sessionTrailer = `Say the thing

Claude-Session: https://${session}0000000000000000000000
`;

const coauthorTrailer = `Say the thing

${coauthor} Opus 5 (1M context) <${vendor}>
`;

const squashed = `Say the thing

Some body text.

---------

${coauthor} <${vendor}>
`;

// The same squash merge with another trailer below the removed one. The dashes
// are no longer the last line, and they are still stranded.
const squashedSigned = `Say the thing

Some body text.

---------

${coauthor} <${vendor}>
Signed-off-by: A Person <a.person@example.com>
`;

// A row of dashes with a kept line under it is not stranded.
const dashesKept = `Say the thing

---------

Signed-off-by: A Person <a.person@example.com>
`;

const footer = `Say the thing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
`;

const plainFooter = `Say the thing

🤖 Generated with Claude Code
`;

// A sentence that names the tool is not the footer, even when it uses the
// footer's words.
const footerWordsInProse = `Say the thing

The first draft was generated with Claude Code and then rewritten by hand.
`;

const bareLink = `Say the thing

https://${session}0000000000000000000000
`;

const aboutTheTools = `Name the agents the launch skill supports

/launch-server reads the same in Claude Code, Cursor and Gemini. Claude asks
the interview questions one at a time.
`;

const plain = `Say the thing

A body with nothing to take out of it.
`;

test('a session link behind a trailer key goes', () => {
  const out = scrub(sessionTrailer);
  assert.ok(!out.includes(session), out);
  assert.ok(out.startsWith('Say the thing'), 'the subject line must survive');
});

test('a session link on a line of its own goes', () => {
  assert.ok(!scrub(bareLink).includes(session));
});

test('a co-author trailer naming the model goes, with the vendor address', () => {
  const out = scrub(coauthorTrailer).toLowerCase();
  assert.ok(!out.includes(coauthor.toLowerCase()), out);
  assert.ok(!out.includes(vendor), out);
});

test('the pull request footer goes', () => {
  assert.ok(!scrub(footer).includes('Generated with [Claude Code]'));
});

test('the footer without its link goes', () => {
  assert.ok(!scrub(plainFooter).includes('Generated with Claude Code'));
});

test('a sentence using the footer words stays', () => {
  assert.ok(scrub(footerWordsInProse).includes('generated with Claude Code and then'));
});

test('the row of dashes a squash merge strands goes, and the body above it stays', () => {
  const out = scrub(squashed);
  assert.ok(!out.includes('---------'), out);
  assert.ok(out.includes('Some body text.'), out);
});

test('the row of dashes goes when another trailer follows the removed one', () => {
  const out = scrub(squashedSigned);
  assert.ok(!out.includes('---------'), out);
  assert.ok(out.includes('Signed-off-by: A Person'), out);
  assert.ok(out.includes('Some body text.'), out);
});

test('a row of dashes with a kept line under it stays', () => {
  assert.equal(scrub(dashesKept), dashesKept);
});

// The samples above are built from pieces so that the validator can read this
// file like any other. An exemption by path would let a real line pasted in
// here pass unseen, so require that the validator names no such exemption.
test('the validator reads this file like any other', () => {
  const validator = readFileSync(join(root, 'tools/validate.sh'), 'utf8');
  assert.ok(!validator.includes('tests/unit/attribution-scrub.test.mjs'));
});

test('prose about Claude, Cursor and Gemini survives', () => {
  const out = scrub(aboutTheTools);
  assert.ok(out.includes('reads the same in Claude Code, Cursor and Gemini'), out);
  assert.ok(out.includes('Claude asks'), out);
  assert.ok(out.includes('/launch-server'), out);
});

test('a message with nothing to remove comes back unchanged', () => {
  assert.equal(scrub(plain), plain);
});

// A check that cannot fail proves nothing. Take the session rule out of a copy
// of the hook and require the bare link to survive. The bare link is used
// because only that one rule reaches it; a trailer is also caught by its key.
test('removing the session rule from the hook is noticed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'attribution-hook-'));
  try {
    const copy = join(dir, 'commit-msg');
    const source = readFileSync(hook, 'utf8');
    writeFileSync(copy, source.split('\n').filter((l) => !l.includes(session)).join('\n'));
    assert.ok(scrub(bareLink, copy).includes(session));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
