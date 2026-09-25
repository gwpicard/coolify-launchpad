# The interview

Six questions, asked one at a time. Each carries a best guess the person can
accept in a word. The reasons behind each default are in
[docs/design.md](../../../docs/design.md), "The interview". The firewall each
answer leads to is in [docs/server-model.md](../../../docs/server-model.md).

Treat a free-text answer that fits none of the options as a sign that the
options were wrong for this person. Ask what they are trying to do, then map it
back to an option, and say which one you chose.

## 1. The server's name

"What should the server be called? One lowercase word of letters and digits,
starting with a letter. It becomes the server's name at Hetzner, its name on
your tailnet, and the file name for its records. My guess: `coolify`."

Refuse `example`, which is the template. If `servers/<name>.yaml` already
exists, say so and ask whether this is the same server (step 1 of the skill) or
a new one that needs another name.

## 2. Where it runs, and how big

"The server runs on Hetzner Cloud. I suggest `cpx32` in `nbg1` (Nuremberg): an
x86 server with 4 vCPU and 8 GB of memory, the size coolify-devops names for a
server that builds images. Shall I use that?"

If the person asks for choices:

- Location: `nbg1` (Nuremberg), `fsn1` (Falkenstein) and `hel1` (Helsinki) are in
  the EU. Hetzner also has locations in the United States and Singapore. Pick
  the one closest to the team.
- Size: `cpx22` is the smaller step down, fine for a trial or a few light tools.
  An Arm server (`cax` types) costs less, but offer it only when every image the
  team will run has an arm64 build.
- Prices and which types each location offers change. Point the person at
  Hetzner's own price page rather than quoting a figure.

Hetzner cloud firewall names are unique within a project, and the launchpad's
firewall is always called `coolify`. So each launchpad server needs its own
Hetzner project. Say this now if the person plans a second server in a project
that already holds one.

## 3. Public apps

"Will any tool on this server be open to the public internet, not only to your
team? My guess: no. Internal tools stay on your tailnet and need no open port."

A yes needs a domain the team owns, or a DuckDNS one. Record the suffix the
public tools will live under, such as `apps.example.com`. The launchpad opens
ports 80 and 443 for it. Setting up the wildcard record is coolify-devops's
work, later. In the spec this is `public_lane`: `none`, or the suffix.

## 4. Who may reach the Coolify dashboard

Ask it the way coolify-devops asks it, with the three answers side by side:

- `tailnet`: only your team, over the tailnet. Every release is a manual
  redeploy.
- `github`: your team over the tailnet, plus GitHub's webhook addresses, so a
  push to GitHub deploys. My guess, and the default.
- `internet`: anyone. The login page is on the open internet, so two-factor
  authentication on every Coolify account is mandatory.

Say plainly that `github` is what AI Build Kit's `/ship` relies on for its
preview address and for push-to-deploy. In the spec this is `dashboard`.

## 5. Tooling on the server

"Shall I install Node 22, Claude Code and the coolify-devops skills on the
server now? My guess: yes. coolify-devops needs Node 18 or newer either way, and
it runs inside Claude Code on the server."

A no moves "install Node 22" into the "Still yours to do" list. In the spec this
is `install_tooling`.

## 6. The remaining defaults

Confirm them in one question: "The Hetzner firewall will be called `coolify`,
which is the name coolify-devops expects, and the server's name on the tailnet
will be `<name>`, the same as its Hetzner name. All right?"

Neither can change. If the person wants another name on the tailnet, go back to
question 1.

## Writing the spec

Write `servers/<name>.yaml` in the shape of `servers/example.yaml`:

```yaml
name: <name>
hetzner:
  location: <location>
  type: <type>
public_lane: none            # or the suffix from question 3
dashboard: github            # tailnet | github | internet
install_tooling: true
```

Show the file and ask whether it is right. Git ignores it, so it stays on this
computer. The launch refuses a file whose `name` differs from its file name.
