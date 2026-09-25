# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, Copilot, and the rest)
and for people working in this repository. Read it before changing anything here.

## What this repository is

coolify-launchpad is the missing link between two kits. [AI Build
Kit](https://github.com/gwpicard/ai-build-kit) builds and checks a tool on the
builder's machine and stops at "ready".
[coolify-devops](https://github.com/KasperHonore/coolify-devops) runs on a Coolify
server and takes a ready tool to an address. Both assume the server already exists.
This repository takes a person from no server to exactly the state coolify-devops's
`/setup-coolify-devops` expects to find: a Hetzner server on a Tailscale tailnet
behind a cloud firewall, Coolify installed and owned, the env file in place, and the
server-side tooling installed. It stops there and hands over a server block.

## Layout

```
AGENTS.md                 this file: standing rules for working on the source
CLAUDE.md                 one line, @AGENTS.md, so Claude Code reads the same rules
README.md                 what it is, install, and positioning for someone deciding
CONTRIBUTING.md           how to report a problem or send a change
SECURITY.md               how to report a security problem
CHANGELOG.md              one entry per version; the entry becomes the release notes
LICENSE                   MIT
package.json              engines, scripts, and the version every skill mirrors
skills/                   the three commands, one folder each, the canonical source
  launch-server/          SKILL.md plus references/ (interview, preflight, server block)
  check-server/           SKILL.md
  retire-server/          SKILL.md
.claude/commands/         generated from skills/ by tools/build-adapters.sh; never hand-edited
.agents/maintainer-skills/humanizer/   vendored writing skill; outside every skills folder on purpose
lib/                      spec, env, secrets, ssh, progress, pulumi, tailnet, local-tailscale, phase-b,
                          launch-flow, hetzner-firewall, server-block, check, retire
program/                  Pulumi.yaml, index.ts, cloud-init/build.ts and its snippets
scripts/                  launch, check, retire and output: the dispatcher the skills call
servers/                  example.yaml is tracked; every real server file is ignored
docs/
  positioning.md          the three-way story and the block formats
  server-model.md         lanes, firewall rules, the probe table, troubleshooting
  design.md               how a launch works and why each step is where it is
  sources.md              borrowed ideas and where they came from
  maintaining.md          writing rules, one owner per concept, release steps
tests/
  unit/                   Node's test runner: cloud-init assembly, spec, env check, tailnet checks, harness,
                          the lane firewall, the blocks, Phase B against stand-ins, check and retire
  unit/helpers/           stand-ins for the Hetzner API, GitHub's meta answer and a shell on the server
  fixtures/               a saved copy of GitHub's meta answer, for the github rule
  offline-preview.sh      pulumi preview with stand-in secrets and local state; reaches no Hetzner, Tailscale or Pulumi service
  lib/existing-server-state.ts   the hand-built state of a running server that the offline preview plans against
  rules/                  prose guards built on tests/lib/rule-shape.sh
  lib/rule-shape.sh       the guard library, copied from AI Build Kit
  rehearsal.md            what a release rehearsal does, and the record of runs
tools/                    build-adapters.sh and validate.sh
.github/workflows/        check.yml: what CI runs on every push and pull request
```

The program has landed: `npm run launch` takes a spec to the server block,
`npm run check-server` reads a server back, and `npm run retire` destroys one.
None of it has run against a real server yet. `tests/rules/` and each skill's
`references/` folder are empty until their slice lands. The three `SKILL.md` files exist so that every check
runs for real from the first commit; each says the command is not built yet and
stops. `CHANGELOG.md` says which slices are still to come.

## The boundary

The launchpad decides that a server exists and how it is reached. It never decides
what runs on it. That line is what lets three tools share one chain without any of
them growing into the others.

So the launchpad does not deploy the tailnet registrar, the canary, or the DNS
pinner. It does not create the GitHub App, the Tailscale OAuth client, or the
Coolify API token. It hosts nothing. Every one of those is a step of
`/setup-coolify-devops` or `/host`, and the server block names the ones still
ahead so the person knows where to go next.

On the server itself the launchpad writes two things and no more: the env file at
`/root/.config/coolify-devops.env` with its `.bashrc` source line, and the
coolify-devops skills install in `/root` when the person asked for it. It leaves
`/root` free of `AGENTS.md`, `CLAUDE.md`, `instance.yaml`, `docs/` and `stacks/`,
because coolify-devops's scaffolder refuses to run when any of those exists. It
never writes into a product repository or a deployment repository.

## Secrets

Check that a secret is present. Do not read its value. `[ -n "$HCLOUD_TOKEN" ] &&
echo set` is the whole check, on this machine and on the server. Do not run `env |
grep`, do not `cat` an env file, do not `echo` a variable, and do not read shell
history. A session that did any of those once wrote a live token into its own
transcript.

A token is never pasted into a session. The Coolify API token is created in the
Coolify UI and added to the env file on the server by the person, with the command
coolify-devops prints. The Tailscale auth key reaches the server inside cloud-init,
base64 encoded, and nowhere else.

The launchpad's own `HCLOUD_TOKEN` is read and write. It never goes to the server:
a read-write token in a shell on the host can delete the host. If the person wants
coolify-devops to manage the firewall from the server, that is a separate token
they create, and the server block says so. On this machine the token goes to two
places: the `pulumi` process's environment, and the Authorization header of the
launchpad's own Hetzner API calls, held privately in `HetznerApi`. No error
message or printed line carries it.

Secrets live in `.env.<name>` here, mode 600, ignored by git. Nothing under
`servers/` except `example.yaml` is tracked.

## The rehearsal rule

A deploy path is not claimed to work until a real run on Hetzner has proved it.
Code review does not count and unit tests do not count: the first real run of the
tool this was adapted from found five blocking defects that review had passed. A
rehearsal costs cents, so the price of being wrong is always higher than the price
of checking.

Before every release the rehearsal in `tests/rehearsal.md` runs in full: a launch
in `github` mode with no public lane, then `/setup-coolify-devops` on the box
through to its canary, then `/retire-server`. It confirms the facts the code
assumes and cannot prove from a laptop; that file lists them. What a rehearsal
found is folded back into the skill or document that should have known it, in
the same change.

## Editing a skill

`skills/` is the canonical source. Each skill is one folder whose name equals its
`name`. The frontmatter carries `name`, `description`, `license: MIT`,
`compatibility` (what the skill needs from its environment), `metadata.author:
gwpicard` and `metadata.version`, which equals the version in `package.json`.
`tools/validate.sh` fails on drift.

Every description ends with the sentence "Type this command when you want it; it
never starts on its own." It is the only text a client reads before deciding
whether to trigger a skill by itself, so it stays. It stays last because the
adapter builder takes the first sentence as the short help string, and a guard
sentence at the front would become the help text.

After changing a skill, run `tools/build-adapters.sh` and commit the generated
`.claude/commands/` files with the change. Never edit a generated file by hand.
The generated adapters carry `disable-model-invocation: true`; the canonical
files do not, because the Agent Skills reference validator rejects it.

Skills are living runbooks. When a session learns something the hard way, fold it
into the skill that should have prevented it, in the same change as the fix.

## Writing

The rules are in [docs/maintaining.md](docs/maintaining.md). The four that matter
most: British spelling with no em dashes; plain words, with a technical term
defined once where it lives and linked from everywhere else; paragraphs under
about 100 words; and the vendored humanizer run in embedded mode over any prose
before it is saved.

## Checks

```bash
npm test               # unit tests, all offline: cloud-init, spec, env, tailnet, harness, firewall, blocks, Phase B, check, retire
npm run typecheck      # tsc --noEmit over lib/, program/, scripts/, tests/unit/
npm run validate       # tools/validate.sh: skills-ref validate, version sync, adapter drift, prose scan
npm run check          # test + typecheck + validate; what CI runs
npm run preview:offline  # pulumi preview on a copy, stand-in secrets, local state; needs the Pulumi CLI
```

The offline preview is not part of `check`, because CI has no Pulumi CLI. Run it
after changing `program/`. It points the Hetzner provider at a closed local port,
so it cannot reach Hetzner even by mistake.

`tools/validate.sh` also scans every tracked Markdown file for em dashes and the
banned words, and runs the prose guards under `tests/rules/`. A guard asserts that
a written rule is still in its skill and then proves the assertion is load bearing
by removing the rule and requiring the check to fail.

## Releasing

One release per version, named by the version. A change to a skill that will be
published needs, in the same change:

1. `version` bumped in `package.json` and in every skill's `metadata.version`
   (`npm run validate` lists what is out of sync);
2. a `## <version>, <date>` entry at the top of `CHANGELOG.md`, in plain words. It
   becomes the release notes.

The rehearsal in `tests/rehearsal.md` runs before the tag, and its row in the
record is part of the release. A version is never re-released with different skill
content. The full sequence is in [docs/maintaining.md](docs/maintaining.md).

## Referring to work

Issue and pull request numbers belong in issues, pull requests, and the
changelog. Never in a tracked file. A number in a document is a pointer the
reader cannot follow, and once the material moves it points at something
unrelated. Say the thing instead. Where a comment needs the reason behind a rule,
write the reason.
