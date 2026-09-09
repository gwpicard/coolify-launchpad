# Contributing

This repository is both the source and the thing people clone. Every file that
runs on a person's computer can be read here and compared between version tags.

## Report a problem

Open a public issue with the version (the tag you cloned, or the commit), what
you expected, and what happened instead. Add the smallest set of steps that
reproduces the problem. Remove tokens, passphrases, IP addresses, tailnet names,
and anything else that identifies your server before posting.

If the problem happened during a launch, the failure block the agent printed is
the most useful thing to include. It names the last step that passed and quotes
the line that stopped it.

## Suggest a change

Open a feature request and describe the situation in which you would use it.
Explain what you would expect to see or do. You do not need to propose a
technical design.

Anything that hosts a tool, locks the server down, or changes a running server
belongs to [coolify-devops](https://github.com/KasperHonore/coolify-devops),
not here. The launchpad stops where that kit starts.

## Pull requests

Read `AGENTS.md` first. It is the contributor guide, written for agents and
people alike, and it names the rules a change must keep. Run `npm run check`
before opening a pull request. A change to a skill's prose is guarded by tests
that read the prose, so a rule removed by accident fails the check.

A change to how the server is built is not accepted on tests alone. It needs a
real run against Hetzner, recorded in `tests/rehearsal.md`, because a launch
that only ever worked in a unit test has never worked.
