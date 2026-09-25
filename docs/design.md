# How a launch works

This is the standing description of what the launchpad does, in the order it does
it, and why each step sits where it sits. The three-way story and the block formats
are in [positioning.md](positioning.md). The firewall rules, the probe and the
troubleshooting table are in [server-model.md](server-model.md). Facts marked
"not yet confirmed" are assumptions the code leans on that no real run has
proved; `tests/rehearsal.md` records which ones the runs so far did prove.

## The form of the tool

The repository is the operator's working folder, the way coolify-devops's
deployment repository is the server's. In version 0.1 there is one install route:
clone it, run `npm install`, and start Claude Code inside it. Cloning is installing, because the generated
`.claude/commands/` adapters are in the checkout.

The other routes, `npx skills add` and a Claude plugin, wait for a later version.
On their own the skills are useless without the program beside them, and
coolify-devops's README already warns against having two install routes on one
machine. Until the skill can fetch the program itself, a second route would only
produce a command that fails at its first step.

State stays local and is ignored by git: `servers/<name>.yaml` for each server,
`.env.<name>` at mode 600 for its secrets, and `.pulumi/` for the Pulumi state.
The launch points Pulumi at `.pulumi/` itself, through `PULUMI_BACKEND_URL`, so
there is no `pulumi login` step. A computer that is also signed in to Pulumi
Cloud for other work still keeps this state in the folder. The Pulumi program
sits in `program/`, and each server is a stack named after the server.

The name `example` is kept for the two tracked templates, `servers/example.yaml`
and `.env.example`, and the launch refuses it.

The skills do the talking and TypeScript does the work. A skill never runs `pulumi`
itself. It runs `npm run launch -- --server <name> --json` and reads the progress
events that come back, one JSON object per line, ending in a result line. Each skill's first step checks that the
`package.json` name is `coolify-launchpad`, and otherwise tells the person to clone
the repository.

## The three commands

The names must not clash with AI Build Kit's nine commands, because a builder's
laptop may hold both, and not with coolify-devops's five, in case the same person
operates both from one machine.

`/launch-server` runs the interview, writes the spec, runs the preflight, deploys,
runs Phase B, and prints the server block.

`/check-server` is read only. It runs the outside probe coolify-devops's setup step
2 and `/health` expect, the tailnet checks (signed in, `tag:server`, key expiry
null, SSH on, and the SSH grant working from here), Coolify answering on the
tailnet, the env file present, and Node, git, jq and Claude Code present on the box.
It prints one table with the broken things first, then the server block again.
The script behind it is `npm run check-server -- --server <name>`. It also reads
the live firewall rules through the Hetzner API and compares them with the lane
table, using GET requests only. On the box it runs only commands that print: the
env file's mode, whether `.bashrc` sources it, and whether the token is set, which
it learns by sourcing the file in a subshell and printing "set" or "unset". A
missing token is a to-do, not a fault. It does not look for `AGENTS.md` and the
rest in `/root`, because once `/setup-coolify-devops` has run they belong there.

`/retire-server` warns that `/data/coolify` and every hosted tool on the box will
be destroyed, requires the person to type the server name, runs `tailscale logout`
over Tailscale SSH, runs `pulumi destroy` and removes the stack, then hands over the
console step "Machines, the node, Remove" as a step still to do. Logout expires the
node's key; it does not delete the machine, and the launchpad holds no `devices:core`
credential to do that.

The script behind it is `npm run retire -- --server <name>`. Before it asks
anything, it checks that the launchpad made the server. The local stack must
exist, every resource in it must belong to the `coolify-launchpad` project and be
one of the types the program creates, and its server and firewall must carry the
labels `purpose=coolify` and `server=<name>`. The live Hetzner server of that
name must carry the same labels and the id the stack holds. Anything else is
refused with nothing changed. The typed name comes from a prompt in a terminal,
or from `--confirm <typed name>`, which is how the skill passes on what the
person typed. Without either it destroys nothing. The node is logged out only
when the stack's server is live on Hetzner and the tailnet machine of that name
proves it is that server (see "Which machine is this" below); a stale machine of
the same name is left for the console step. Logout drops the SSH session
it runs in, so it is started detached, and the retire then waits up to a minute
for the node to stop answering. A node it cannot find, or one that still
answers, does not stop the retire, because the console step covers it. Last, it
removes `servers/<name>.yaml` and `servers/<name>.block.txt` and keeps
`.env.<name>`, which holds the person's own Hetzner token and passphrase.

A resume, the check and the retire need only `HCLOUD_TOKEN` and
`PULUMI_CONFIG_PASSPHRASE`. None of them runs `pulumi up`, so the auth key,
which is spent once the server has joined, may have been deleted.

### Which machine is this

The launchpad finds a server on the tailnet by name, with `tailscale ip -4
<name>`, and an older machine of the same name can still be there. So before it
trusts a node, it asks the node for its Hetzner instance id, from the metadata
service at `169.254.169.254/hetzner/v1/metadata/instance-id`, and for the public
address it leaves from. The address must equal the stack's public IP. The
instance id must equal the stack's server id whenever the metadata service
answers. Phase B checks this right after step 2, the check reads nothing more
from a machine that fails it, and the retire does not log it out.

There is no fourth command. Reconfiguring a running server is coolify-devops's job.

## The interview

Six questions, each with a default the person can accept in a word.

1. The server name, one lowercase word. It becomes the Hetzner name, the Tailscale
   hostname, and the spec filename.
2. Where the server runs. Hetzner only in version 0.1. The location defaults to
   `nbg1`. The size defaults to `cpx32`, an x86 type with 4 vCPU and 8 GB, which is
   what coolify-devops names for a box that builds images. Arm is offered only
   when every image the team will run has an arm64 build. The type names and
   prices are checked against `hcloud server-type list` at build time.
3. Will there be public-facing apps? No is the default. Yes needs a domain the team
   owns, or a DuckDNS one. The launchpad records the suffix and opens 80 and 443.
   The wildcard record and the DNS pinner are coolify-devops's job. This maps to
   `domains.public_suffix` in coolify-devops's `instance.yaml`.
4. Who may reach the Coolify dashboard, asked the way coolify-devops asks it:
   `tailnet` (the team only; releases are manual redeploys), `github` (the tailnet
   plus GitHub's webhook ranges, so a release is a push; the default), or
   `internet` (anyone; two-factor authentication is mandatory). This maps to
   `exposure.coolify_ui`. The skill says plainly that `github` is what AI Build
   Kit's `/ship` relies on for the preview address and push-to-deploy.
5. Install Node, Claude Code and coolify-devops on the server now? Yes is the
   default. coolify-devops needs Node 18 or newer either way, so a "no" moves
   "install Node 22" into the hand-over list.
6. One confirmation of the remaining defaults: the firewall is named `coolify`,
   which is coolify-devops's fixed `host.firewall_name`, and the Tailscale hostname
   equals the server name.

A free-text answer is read as a signal that the options were wrong for this
person, the same rule coolify-devops writes for its own interview.

## The preflight

Nothing is spent until every one of these has been verified. None is assumed.

The three secrets are present in `.env.<name>`: `HCLOUD_TOKEN`,
`PULUMI_CONFIG_PASSPHRASE` and `TAILSCALE_AUTH_KEY`. Presence only. There is no
`TAILNET_DNS_NAME`, because the tailnet suffix is discovered on the node in Phase B
rather than typed. The file itself must be readable by its owner only; a copy of
`.env.example` arrives at mode 644, so the check names the `chmod 600` to run. A
key followed only by a comment, the way `.env.example` ships, counts as not set.
The check reports key names and nothing else. The values go from the file into
the `pulumi` process's environment, and `HCLOUD_TOKEN` also into the
Authorization header of the launchpad's own Hetzner API calls in step 7, the
check and the retire. They go nowhere else, and no error message carries one.

`pulumi` is on the path, `node` is version 20 or newer, and `ssh` exists. The
Tailscale command is `tailscale` on the path or, on a Mac with the App Store
build, `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, which puts nothing
on the path.

The operator's machine is on the tailnet, shown by `tailscale status` working
locally. The person needs this to register the Coolify admin over the tailnet, and
the launchpad needs it to reach the box after port 22 closes.

The tailnet policy holds the entries in
[the preflight reference](../skills/launch-server/references/preflight.md): a
group for the operators, `tagOwners` for `tag:server`, and an `ssh` rule whose
source is that group, whose destination is `tag:server`, and whose users are
`root`. The source is a named group because Tailscale does not accept
`autogroup:admin` as the source of an `ssh` rule. The default
`ssh` section only lets members reach their own devices. A tagged node has no
owner, so without this rule Tailscale SSH refuses everyone, including the
operator. The `autoApprovers.services` entry and the OAuth client stay
coolify-devops's precondition, so each has one owner.

The auth key was created for `tag:server`, one-off, pre-approved and not
ephemeral. A tagged key brings the node up already tagged, with key expiry
disabled. One-off, because user-data stays readable from the metadata service by
anything on the box, and a spent key there can do no harm; the reason is in
[server-model.md](server-model.md). Ephemeral is the
wrong choice for a server: an ephemeral node is removed once it goes offline, so a
reboot could delete the server's identity.

The launch script cannot read these last two from the operator's machine: seeing
the tailnet policy or how a key was made takes a Tailscale API credential the
launchpad does not hold. So `/launch-server` asks the person to confirm both
before it runs the launch, and Phase B proves them on the real node. What a
machine can check, it checks first with `npm run launch -- --server <name>
--preflight`, which runs the preflight alone and creates nothing. Step 2 reads
the tag and the key expiry back, and step 3 proves the SSH grant, both before
anything closes.

## Phase A: cloud-init

Cloud-init runs as root on the new server. The script is assembled the way
hermes-launchpad assembled its own: sections joined into one bash script,
`{{PLACEHOLDER}}` substitution with the `[A-Z0-9_]+` character class (the digit
matters; a narrower class once skipped a placeholder silently), and a hard failure
on any placeholder left unset.

One rule governs what may go into user-data. Nothing that could change later goes
in, because user-data is part of the Hetzner server's fingerprint. A change to it
makes Pulumi replace the machine, and a replaced machine has no `/data/coolify`.

The sections, in order:

1. `base.sh` runs `apt-get` update and upgrade with `Acquire::ForceIPv4=true` and
   installs `curl`, `git` and `jq`. Every `curl` in Phase A uses `-4`: a dead IPv6
   route on a Hetzner image has hung package fetches before. It also writes
   `Acquire::ForceIPv4 "true"` into `/etc/apt/apt.conf.d/`, because the Tailscale
   and Coolify installers run `apt-get` themselves, and a flag on our own lines
   would not reach theirs. The script runs under `set -euo pipefail`, so any
   failed step stops it and `cloud-init status` reports `error`. A second file
   sets `DPkg::Lock::Timeout "300"`: on first boot, unattended upgrades often hold
   the apt lock, and without it `apt-get` fails at once instead of waiting. There is no `ubuntu`
   user, because Coolify's installer wants root, coolify-devops lands in `/root`,
   and Tailscale SSH gives root. There are no build tools, no ffmpeg, no Python,
   no ripgrep and no Homebrew; those were the previous payload's needs.
2. `tailscale.sh` installs Tailscale and runs `tailscale up` with the decoded auth
   key, `--ssh`, `--advertise-tags=tag:server` and `--hostname=<name>`. A failure
   here stops the script; hermes-launchpad only printed a warning, and a box that
   silently missed the tailnet was unreachable by name. The key travels base64
   encoded, so a stray character in it cannot break the script. On the box it is
   decoded into a mode 600 file under `/run` and passed as
   `--auth-key=file:<path>`, so it never appears in the process list; the file is
   removed afterwards, and a `trap` removes it if `tailscale up` fails.
3. `coolify.sh` runs Coolify's installer with a positional version argument. That
   the installer accepts one, and that it requires root, are not yet confirmed;
   the version is pinned once they are. The first real run left
   `COOLIFY_VERSION` in `program/cloud-init/build.ts` unset, and the installer
   installed its current release, 4.3.23. The admin account is
   not pre-created with the installer's `ROOT_USER_*` variables, because that
   would put a password in user-data, which any process on the box can read from
   the metadata service. The admin is registered over the tailnet in Phase B, as
   coolify-devops's own runbook does it.
4. `tooling.sh` installs Node 22 from NodeSource and Claude Code with `npm install -g
   @anthropic-ai/claude-code`. It is included only when question 5 was yes. It
   still belongs in user-data because it is decided before creation and never
   changes. The NodeSource setup script is fetched with `curl -4` and then run,
   and `npm` runs with `--dns-result-order=ipv4first`, for the same dead IPv6
   route as the rest of Phase A. It runs after Coolify, and a failure in it is
   printed but does not stop the script: its commands run in a subshell with
   `set -e` of its own while the outer `set -e` is paused. A box with Coolify and
   no Node is still worth handing over, and Phase B step 6 names what is missing.
5. A sentinel: `install -d /var/lib/coolify-launchpad && touch
   /var/lib/coolify-launchpad/phase-a-done`. Phase B polls this file and
   `cloud-init status`, and fails early when that status reports `error`.

There is no `ufw`. Docker rewrites iptables ahead of it, and Coolify SSHes to itself
on port 22. The cloud firewall is the only firewall.

## The Pulumi program

The project is `coolify-launchpad`. The resources are `coolify-ssh-key`,
`coolify-server`, and a firewall named exactly `coolify`, which is the name
coolify-devops expects to find. The image is Ubuntu 24.04 LTS. The server carries
the labels `purpose=coolify` and `server=<name>`. None of hermes-launchpad's legacy
resource names survive; there is no old stack to stay compatible with. The key
pair Pulumi generates is also named `coolify-ssh-key`, which Pulumi allows
because the two resources have different types. User-data is marked secret, so
the auth key inside it is encrypted in the state file rather than stored as
plain text.

Hetzner firewall names are unique within a Hetzner project. Because the
firewall must be called `coolify`, one Hetzner project holds one launchpad
server. A second launch into the same project fails when it tries to create a
second `coolify` firewall. The SSH key is named `coolify-launchpad-<name>`, so it
does not collide.

The server carries `ignoreChanges: ["userData"]`. User-data only matters on
first boot, and a change to it would make Pulumi replace the machine. So a later
launch after the Coolify version is pinned, or with a new auth key, leaves the
running server alone. `npm run preview:offline` proves this against a hand-built
state for a running server: a new key plans nothing, and the same preview on a
copy of the program without that line plans a replacement.

At creation the firewall allows inbound TCP 22 from anywhere and nothing else.
There are no outbound rules, which keeps all outbound traffic open, as
coolify-devops's runbook says it should be. The rules are the one thing about the
firewall that changes later, so the resource carries `ignoreChanges: ["rules"]`.
Phase B replaces the rules through the Hetzner API, and coolify-devops's
`HCLOUD_TOKEN` path may own them from then on, without Pulumi reverting them on
the next `up`. `pulumi refresh` pulls the live rules into state, which is harmless.

## Phase B: two SSH legs

The SSH harness is hermes-launchpad's, in `lib/ssh.ts`: `StrictHostKeyChecking=no`
with `UserKnownHostsFile=/dev/null` (Hetzner recycles IP addresses, and
`accept-new` refused a replaced machine on a remembered address), `sshRun`,
`sshProbe`, `scp`, `shellSingleQuote`, the `step()` progress wrapper, the
poll-with-deadline loop, and `stageSshKey` with its `try/finally` cleanup. The env
file writer is adapted rather than copied: it writes `export` lines with a fixed
body, and only when the file is absent.

There are two legs. The first is `root@<public-ip>` with the Pulumi-generated key.
The second is `root@<tailnet-ip>` over Tailscale SSH, with no key at all. The
harness switches at step 3. From then on, closing port 22 costs nothing, and
`--resume` can reach the box on any later run.

Each step is a progress event:

1. Wait for the sentinel and for `curl -fsS http://127.0.0.1:8000` to answer, with
   a 20-minute limit. Then also run `curl -sI http://localhost:8000` on the box.
   On a Hetzner box `localhost` once resolved to IPv6 while a service bound IPv4
   only, and `localhost:8000` is what coolify-devops's env file will point at, so
   the mismatch is caught here rather than after hand-over. The step does not
   stop on it: it reports the mismatch so step 5 can write `127.0.0.1` instead.
   It does stop early when `cloud-init status` reports `error`, and points at
   `/var/log/cloud-init-output.log`.
2. Verify the tailnet with coolify-devops's own checks. `tailscale status --json`
   gives `.Self.HostName`; `.Self.Tags` lists `tag:server`; `.Self.KeyExpiry` is
   `null`; `.MagicDNSSuffix` is set, and that value is the tailnet name;
   `.CertDomains` is set, which means HTTPS is enabled on the tailnet. `tailscale
   debug prefs | jq .RunSSH` is `true`. Read `tailscale ip -4` and the public
   address from `curl -4 -s https://api.ipify.org`. If MagicDNS or HTTPS is off,
   stop and give the console link. The comment on `.MagicDNSSuffix` in
   Tailscale's source says it is filled in whether or not MagicDNS is on, so the
   check also reads `.CurrentTailnet.MagicDNSEnabled` when the node reports it.
   Which of the two a real node gives is not yet confirmed: the first real run
   passed this check without recording which field it read. The step also
   checks that the node's DNS name starts with the server name. If an older
   machine of the same name is still in the tailnet, the new one joins as
   `<name>-1`, and the step stops and says which machine to remove.
3. Prove the SSH grant from the operator's machine: `ssh -o BatchMode=yes
   root@<tailnet-ip> true`. On failure, stop before anything closes, and show the
   policy block to paste. On success, every later step uses this leg. The command
   turns off every key and password method, so only Tailscale SSH can let it in,
   and a key that happens to sit in this computer's agent cannot make a missing
   grant look present. It retries for 90 seconds, because a new node can take a
   moment to appear in this computer's peer list. Each attempt is stopped after
   30 seconds. An ssh rule with action `check` holds the connection open until
   someone signs in in a browser, which cannot happen during a launch, so a held
   connection stops the step at once and says to change the rule to `accept`.
   Every other SSH command has a time limit too.
4. Wait for the admin account. Tell the person to open `http://<tailnet-ip>:8000`
   from this computer now and create the admin account, because whoever reaches
   that page first owns the server, which is why nothing is open to the internet
   yet. Then turn on two-factor authentication under Settings, General. Poll
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/register`
   without `-L` until it stops answering 200; Coolify closes registration after
   the first user and redirects. The first real run saw it answer 302 once the
   account existed. The wait lasts 20 minutes. If it runs out, the launch stops and
   names `--resume --admin-created`, which is how the person confirms the account
   instead, and the block then says "confirmed by you, not verified". In
   `internet` mode the person must also type `2fa on`, which the skill passes on
   as `--two-factor-on`. Without it the launch stops before step 7, with nothing
   opened.
5. Write `/root/.config/coolify-devops.env` at mode 600, only if it is absent,
   with `export COOLIFY_BASE_URL=http://localhost:8000` and a commented
   placeholder line for `COOLIFY_ACCESS_TOKEN`. If step 1 found that only
   `127.0.0.1:8000` answers, the URL is that instead. Append `.
   ~/.config/coolify-devops.env` to `/root/.bashrc` if it is not there. The
   launchpad's own `HCLOUD_TOKEN` is never copied to the server; it is read and
   write, and a read-write token on the host can delete the host. The block says a
   read-only one is optional.
6. If question 5 was yes, run `cd /root && npx -y skills add
   KasperHonore/coolify-devops -a claude-code -y`. The first `-y` is for `npx`
   itself, since there is no terminal. Its output goes to
   `/var/log/coolify-launchpad-skills.log`, and a failure quotes the last lines.
   `/root` is left free of `AGENTS.md`,
   `CLAUDE.md`, `instance.yaml`, `docs/` and `stacks/`, because coolify-devops's
   scaffolder refuses to run when any of those exists. The step then reads the
   box back in one round trip and stops if any of those is there, or if Node 18
   or newer, Claude Code or `/root/skills-lock.json` is missing when the tooling
   was asked for. Signing in to Claude Code is the person's step.
7. Apply the lane firewall through the Hetzner API `set_rules` call on the firewall
   named `coolify`, inbound rules only, with the descriptions coolify-devops's
   `provisioning.md` uses. The rules per lane are in
   [server-model.md](server-model.md). Port 22 is removed here. In `tailnet` mode
   with no public lane the rule list is empty. In `github` mode the hook ranges
   are fetched from GitHub first. The step refuses a `coolify` firewall that does
   not carry this server's labels or is not attached to it, waits for Hetzner to
   report the change applied, and reads the rules back to compare.
8. Run the outside probe from the operator's machine, over ports 22, 80, 443, 3000,
   8000, 6001 and 6002, and compare it to the expectation table. A mismatch is
   read again for up to a minute, then stops the launch. The block records
   that the probe ran from the operator's machine, which is on the tailnet.
   Traffic to the public address does not use the tailnet, but coolify-devops's
   runbook asks for a machine outside it, so the claim is stated as what it is.
   Then `curl -sI http://<tailnet-ip>:8000` from the operator's machine.
9. Print the server block, and write it to `servers/<name>.block.txt` as well.

`--resume` skips `pulumi up` and re-runs Phase B from step 1. It asks this
computer's Tailscale for the node's address with `tailscale ip -4 <name>`, and
when it finds one, steps 1 and 2 run over the second leg, so a closed port 22
does not matter. When it finds none, it falls back to the first leg only if
port 22 still answers. Once the lane firewall is on, that fallback would wait 20
minutes for nothing, so the resume stops at once and says to check that this
computer is on the tailnet and the machine still carries the server's name.
Either way, the node must pass the identity check before anything else runs.
In `internet` mode a resume with `--admin-created` looks at `/register` once
more and refuses to open 8000 while it still answers 200. Every step
is idempotent: the env file is never overwritten, the skills install is skipped
when `/root/skills-lock.json` exists, and `set_rules` replaces the whole rule set
each time.

The steps run in `lib/launch-flow.ts`, which takes the SSH, Hetzner, GitHub and
network calls as arguments. `scripts/launch.ts` passes the real ones. The unit
tests pass stand-ins and run every step in order without a server, including a
resume against an env file that already exists.

## What came from hermes-launchpad

Copied: `lib/secrets.ts` (the base64 route for a secret through bash),
`lib/env.ts` (a dependency-free reader for `.env` files, now private behind a
check that returns key names only), the SSH harness from
`lib/post-deploy.ts`, `stageSshKey`, the progress event shapes from
`targets/index.ts`, the progress renderer and `humanDuration` from
`scripts/run.ts`, the cloud-init assembly in `build.ts` with its comment about
user-data and machine replacement, `tailscale.sh` made to fail hard, the first 23
lines of `base.sh` without the user creation, and the `.gitignore` patterns.

Adapted: `program.ts` (new names, the image, the type, `ignoreChanges`, no
outbound rules), `adapter.ts` (three env keys instead of many, an HTTP readiness
check instead of a file test, two SSH legs, the tailnet logout in destroy),
`lib/spec.ts` with far fewer fields, the env file writer, and the README's
troubleshooting table with its Cleanup and Tailscale node leftovers sections.

Dropped: the archetypes, the checklist, the web intake form, the other three
targets, every Hermes snippet, the Node and Homebrew snippet, the systemd
snippets, the parity-warning machinery between form and mapper, the release and
workflow documents, and the process files of the toolkit that repository was
built with.
