# How a launch works

This is the standing description of what the launchpad does, in the order it does
it, and why each step sits where it sits. The three-way story and the block formats
are in [positioning.md](positioning.md). The firewall rules, the probe and the
troubleshooting table are in [server-model.md](server-model.md). Facts marked "to
be confirmed in the first rehearsal" are assumptions the code leans on until
`tests/rehearsal.md` has proved them.

## The form of the tool

The repository is the operator's working folder, the way coolify-devops's
deployment repository is the server's. In version 0.1 there is one install route:
clone it, run `npm install`, run `pulumi login file://$PWD/.pulumi`, and start
Claude Code inside it. Cloning is installing, because the generated
`.claude/commands/` adapters are in the checkout.

The other routes, `npx skills add` and a Claude plugin, wait for a later version.
On their own the skills are useless without the program beside them, and
coolify-devops's README already warns against having two install routes on one
machine. Until the skill can fetch the program itself, a second route would only
produce a command that fails at its first step.

State stays local and is ignored by git: `servers/<name>.yaml` for each server,
`.env.<name>` at mode 600 for its secrets, and `.pulumi/` for the Pulumi state.

The skills do the talking and TypeScript does the work. A skill never runs `pulumi`
itself. It runs `npm run launch -- --server <name>` and reads the structured
progress events that come back. Each skill's first step checks that the
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

`/retire-server` warns that `/data/coolify` and every hosted tool on the box will
be destroyed, requires the person to type the server name, runs `tailscale logout`
over Tailscale SSH, runs `pulumi destroy` and removes the stack, then hands over the
console step "Machines, the node, Remove" as a step still to do. Logout expires the
node's key; it does not delete the machine, and the launchpad holds no `devices:core`
credential to do that.

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
rather than typed.

`pulumi` is on the path and logged in to the local backend, `node` is version 20 or
newer, and `ssh` exists.

The operator's machine is on the tailnet, shown by `tailscale status` working
locally. The person needs this to register the Coolify admin over the tailnet, and
the launchpad needs it to reach the box after port 22 closes.

The tailnet policy holds the block in `references/preflight.md`, pasted as one
piece: `tagOwners` for `tag:server`, and an `ssh` rule whose source is the admin
group, whose destination is `tag:server`, and whose users are `root`. The default
`ssh` section only lets members reach their own devices. A tagged node has no
owner, so without this rule Tailscale SSH refuses everyone, including the
operator. The `autoApprovers.services` entry and the OAuth client stay
coolify-devops's precondition, so each has one owner.

The auth key was created for `tag:server`, reusable and not ephemeral. A tagged key
brings the node up already tagged, with key expiry disabled. Ephemeral is the
wrong choice for a server: an ephemeral node is removed once it goes offline, so a
reboot could delete the server's identity.

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
   route on a Hetzner image has hung package fetches before. There is no `ubuntu`
   user, because Coolify's installer wants root, coolify-devops lands in `/root`,
   and Tailscale SSH gives root. There are no build tools, no ffmpeg, no Python,
   no ripgrep and no Homebrew; those were the previous payload's needs.
2. `tailscale.sh` installs Tailscale and runs `tailscale up` with the decoded auth
   key, `--ssh`, `--advertise-tags=tag:server` and `--hostname=<name>`. A failure
   here stops the script; hermes-launchpad only printed a warning, and a box that
   silently missed the tailnet was unreachable by name. The key travels base64
   encoded, so a stray character in it cannot break the script.
3. `tooling.sh` installs Node 22 from NodeSource and Claude Code with `npm i -g
   @anthropic-ai/claude-code`. It is included only when question 5 was yes. It
   still belongs in user-data because it is decided before creation and never
   changes.
4. `coolify.sh` runs Coolify's installer with a positional version argument. That
   the installer accepts one, and that it requires root, are to be confirmed in
   the first rehearsal; the version is pinned once they are. The admin account is
   not pre-created with the installer's `ROOT_USER_*` variables, because that
   would put a password in user-data, which any process on the box can read from
   the metadata service. The admin is registered over the tailnet in Phase B, as
   coolify-devops's own runbook does it.
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
resource names survive; there is no old stack to stay compatible with.

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
   the mismatch is caught here rather than after hand-over.
2. Verify the tailnet with coolify-devops's own checks. `tailscale status --json`
   gives `.Self.HostName`; `.Self.Tags` lists `tag:server`; `.Self.KeyExpiry` is
   `null`; `.MagicDNSSuffix` is set, and that value is the tailnet name;
   `.CertDomains` is set, which means HTTPS is enabled on the tailnet. `tailscale
   debug prefs | jq .RunSSH` is `true`. Read `tailscale ip -4` and the public
   address from `curl -4 -s https://api.ipify.org`. If MagicDNS or HTTPS is off,
   stop and give the console link.
3. Prove the SSH grant from the operator's machine: `ssh -o BatchMode=yes
   root@<tailnet-ip> true`. On failure, stop before anything closes, and show the
   policy block to paste. On success, every later step uses this leg.
4. Wait for the admin account. Tell the person to open `http://<tailnet-ip>:8000`
   from this computer now and create the admin account, because whoever reaches
   that page first owns the server, which is why nothing is open to the internet
   yet. Then turn on two-factor authentication under Settings, General. Poll
   `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/register`
   without `-L` until it stops answering 200; Coolify closes registration after
   the first user and redirects. That behaviour is to be confirmed in the first
   rehearsal; if it does not hold, the step asks the person to confirm instead. In
   `internet` mode the person must also type `2fa on` before step 7.
5. Write `/root/.config/coolify-devops.env` at mode 600, only if it is absent,
   with `export COOLIFY_BASE_URL=http://localhost:8000` and a commented
   placeholder line for `COOLIFY_ACCESS_TOKEN`. Append `.
   ~/.config/coolify-devops.env` to `/root/.bashrc` if it is not there. The
   launchpad's own `HCLOUD_TOKEN` is never copied to the server; it is read and
   write, and a read-write token on the host can delete the host. The block says a
   read-only one is optional.
6. If question 5 was yes, run `cd /root && npx -y skills add
   KasperHonore/coolify-devops -a claude-code -y`. The first `-y` is for `npx`
   itself, since there is no terminal. `/root` is left free of `AGENTS.md`,
   `CLAUDE.md`, `instance.yaml`, `docs/` and `stacks/`, because coolify-devops's
   scaffolder refuses to run when any of those exists. Signing in to Claude Code
   is the person's step.
7. Apply the lane firewall through the Hetzner API `set_rules` call on the firewall
   named `coolify`, inbound rules only, with the descriptions coolify-devops's
   `provisioning.md` uses. The rules per lane are in
   [server-model.md](server-model.md). Port 22 is removed here. In `tailnet` mode
   with no public lane the rule list is empty.
8. Run the outside probe from the operator's machine, over ports 22, 80, 443, 3000,
   8000, 6001 and 6002, and compare it to the expectation table. The block records
   that the probe ran from the operator's machine, which is on the tailnet.
   Traffic to the public address does not use the tailnet, but coolify-devops's
   runbook asks for a machine outside it, so the claim is stated as what it is.
   Then `curl -sI http://<tailnet-ip>:8000` from the operator's machine.
9. Print the server block, and write it to `servers/<name>.block.txt` as well.

`--resume` re-runs Phase B from step 1 over the second leg when port 22 is already
closed. Every step is idempotent: the env file is never overwritten, the skills
install is skipped when `/root/skills-lock.json` exists, and `set_rules` replaces
the whole rule set each time.

## What came from hermes-launchpad

Copied: `lib/secrets.ts` (the base64 route for a secret through bash),
`lib/env.ts` (a dependency-free reader for `.env` files), the SSH harness from
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
