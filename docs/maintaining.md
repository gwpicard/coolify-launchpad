# Maintaining coolify-launchpad

How the words in this repository are written, which document owns which idea, and
how a release is cut. `AGENTS.md` holds the standing rules for the source; this
file holds the detail behind four of them.

## Before your first commit

The commit-msg hook in `.githooks/` takes AI attribution lines out of a commit
message. `AGENTS.md` says why. Git runs it only when the clone points at that
folder, which is a local setting a clone does not carry. Run this once in every
fresh clone:

```bash
git config core.hooksPath .githooks
```

`git config core.hooksPath` then prints `.githooks`.

## House rules for writing

Anything written into this repository, by a person or an agent, follows these.
They exist because the audience does not read code, so the words are the product.
They are taken from AI Build Kit's maintainer rules, and this repository keeps
them in full rather than in a short form.

Before saving human-facing prose, load
`.agents/maintainer-skills/humanizer/SKILL.md` and run its embedded mode. This
covers documentation, skills, pull request titles and descriptions, issues,
release notes, interface copy, error messages, and comments written for a reader.
Preserve the information and intended voice rather than the draft's sentence
shape. Never invent facts, names, figures, dates, quotations, or citations. Leave
code blocks, frontmatter, data, commands, and link targets untouched. After the
first edit, ask what still sounds generated and revise once more.

- British spelling. No em dashes: a comma, colon, semicolon, or full stop is
  always available and always clearer.
- Plain words over jargon. When a technical term is unavoidable, define it once
  in the sentence that introduces it and then use it plainly.
- Banned: leverage, robust, comprehensive, seamless, crucial, foster, enhance,
  transformative, delve, navigate as a metaphor, empower, streamline, holistic.
- No contrastive reframes ("it's not X, it's Y"), no rhetorical triplets, no
  bulleted lists where each item opens with a bold header.
- Explain a concept where it lives, and link from everywhere else.
- One name per thing. This is a launchpad. Calling it a kit or a tool in one place
  and a launchpad in another makes a reader wonder whether the two differ.
- Paragraphs stay under about 100 words.
- Vary the sentence shape. Almost every explanation wants to arrive as
  "statement: a, b, and c", and a document leaning on one device reads as a
  template however clear each instance is.
- Two house aphorisms are easy to overuse: "X is how something good goes wrong",
  and "X, never Y". Two of each per document.

Technical and reference writing stays neutral and plain. Personality belongs only
where the subject and the author's voice call for it, which in this repository is
almost nowhere.

## The vendored humanizer

The humanizer is version 2.9.1 of
[blader/humanizer](https://github.com/blader/humanizer/tree/v2.9.1), copied with
its MIT licence into `.agents/maintainer-skills/humanizer/`. It sits outside every
folder a skills installer reads (`skills/`, `.claude/skills/`, `.agents/skills/`),
so nobody who installs the launchpad's commands is offered a fourth skill they did
not ask for. The release rehearsal confirms that placement still holds.

Review the upstream changes before replacing the local copy, and keep the
attribution paragraph at the end of its `SKILL.md`.

## One owner per concept

Every concept has one home, and every other mention is a link. Before adding an
explanation, check whether its owner already carries it. If it does, link. If two
documents disagree, the owner wins and the other is edited.

| Document | Owns |
|---|---|
| `README.md` | What the launchpad is, how to install it, and where it sits between the other two kits, for someone deciding whether to use it. |
| `docs/positioning.md` | The three-way story: the chain, what crosses each boundary, who carries it, and the exact server block and failure block formats. |
| `docs/server-model.md` | The two lanes, the firewall rules per lane, the outside probe and its expected answers, why there is no `ufw`, why 22 is closed, and the troubleshooting table. |
| `docs/design.md` | How a launch works, step by step, and the reason each step is where it is. |
| `docs/before-you-launch.md` | Where to click in the Hetzner and Tailscale consoles before a launch, for the person. The policy block and the auth key settings it points at live in the preflight reference. |
| `docs/sources.md` | The outside work the launchpad took ideas or code from, and what each one contributed. |
| `docs/maintaining.md` | This file: first-commit setup, writing, ownership, releasing. |
| `AGENTS.md` | Standing rules for working on the source. |
| `tests/rehearsal.md` | What a release rehearsal does, which facts it confirms, and the record of runs. |
| The skills under `skills/` | What the person sees and types, in the order they see it. |

The firewall table lives once, in `docs/server-model.md`. The block templates live
once, in `docs/positioning.md`. The skills and `docs/design.md` link to them.

## Releasing

A release is a version, a tag, and a GitHub release whose notes are the changelog
entry. The steps, in order:

1. Run the rehearsal in `tests/rehearsal.md` in full, and add its row to the
   record. A rehearsal that failed means there is no release until the cause is
   folded back into the skill or document that should have known it. Release
   0.1.0 shipped on a partial rehearsal; `tests/rehearsal.md` lists the gaps.
2. Bump `version` in `package.json` and in every skill's `metadata.version`. Run
   `npm run validate`; it lists anything out of sync.
3. Write the `## <version>, <date>` entry at the top of `CHANGELOG.md` in plain
   words: what a person using the launchpad will notice, and what a rehearsal
   taught. Run the humanizer over it. That entry is the release notes, unchanged.
4. Regenerate the adapters with `tools/build-adapters.sh` and confirm `npm run
   check` is green.
5. Open a pull request, merge it, then tag `v<version>` on `main` and create the
   GitHub release with the changelog entry as its notes.

A version is never re-released with different skill content. A docs-only change
after a release goes out under the next version, however small.
