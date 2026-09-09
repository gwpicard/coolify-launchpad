# Reporting a security problem

coolify-launchpad rents a server, puts it on your private network, and decides
which of its ports the internet can reach. A problem here can leave a server
open, so it matters beyond the kit itself.

## Report it privately

Use GitHub's private vulnerability reporting on this repository: open the
Security tab and choose "Report a vulnerability". That message is visible only
to the maintainer.

Please do not open a public issue for a security problem. The public issue
tracker is the right place for everything else, and
[CONTRIBUTING.md](CONTRIBUTING.md) explains what to put in one.

## What helps

Say what you expected, what happened instead, and the smallest set of steps that
reproduces it. Name the version you cloned. Remove tokens, passphrases, IP
addresses, and tailnet names before sending anything.

You do not need to prove the problem is exploitable, and you do not need to
suggest a fix. A clear description of behaviour that looks wrong is enough. A
port that the probe said was closed but is open, a secret that appeared in a
transcript, or a step that ran before the one it should have waited for are all
worth reporting.

## What to expect

An acknowledgement, then an assessment. A fix arrives in a numbered release with
public notes, and the notes will credit you unless you would rather they did not.

This is a small project with no service behind it and no paid support, so there
is no response-time commitment. Reports are read and taken seriously.

## What is out of scope

Hetzner, Tailscale, Coolify, Pulumi, and Claude Code belong to their own
vendors. A problem in one of them should go to that vendor. If the launchpad
tells people to use one of them in an unsafe way, that part is ours. What
happens on the server after the handover belongs to
[coolify-devops](https://github.com/KasperHonore/coolify-devops).
