# The release rehearsal

A deploy path is not claimed to work until a real run has proved it. This is that
run. It happens before every release, in full, and its row goes into the record at
the bottom of this file before the tag is made.

## What it is

One real launch on Hetzner, then the hand-over, then the retirement:

1. From a clean clone on the operator's machine, `/launch-server` with a new server
   name, dashboard exposure `github`, no public lane, and the server-side tooling
   installed. It ends in a server block or it has failed.
2. On the server, `/setup-coolify-devops` in bootstrap mode, through its interview
   (which should confirm the block rather than ask), the token step, its firewall
   check, and on to its canary answering in a browser over the tailnet.
3. From the operator's machine, `/retire-server` for that name, then a look at the
   Tailscale admin console to confirm the console removal step was needed and
   worked.

Read `docs/server-model.md` for what the outside probe must show at each point, and
`docs/positioning.md` for what the block must contain.

## What each rehearsal confirms

These are the facts the code assumes and cannot prove from a laptop. Each one is
checked on every run, because the services behind them change without notice.

- Coolify's registration page stops answering 200 at `/register` once the first
  user exists, so Phase B can wait on it without asking the person.
- Coolify's installer accepts a positional version argument and requires root.
  Once it does, `COOLIFY_VERSION` in `program/cloud-init/build.ts` is set to the
  version that run installed.
- The Hetzner server type names and prices the interview offers still exist in the
  chosen location: `cpx32`, the default, and `cpx22`, the smaller size a
  rehearsal uses. Record the price each showed.
- `tailscale up` accepts `--auth-key=file:<path>` with the installed version, a
  one-off pre-approved key joins, and the key file is gone from `/run` afterwards.
- `apt-get` waits on the lock that first-boot upgrades hold rather than failing.
- `apt-get` and both installers finish over IPv4 with the `Acquire::ForceIPv4`
  file in place, and nothing in `/var/log/cloud-init-output.log` waits on an IPv6
  address.
- A failed step in Phase A makes `cloud-init status` report `error`, so step 1
  stops early instead of waiting 20 minutes.
- `curl -fsS http://127.0.0.1:8000` answers once Coolify is up, and whether
  `localhost:8000` answers too.
- On a real node, `tailscale status --json` gives `.Self.Tags` with `tag:server`,
  no `.Self.KeyExpiry`, `.CertDomains` filled in, and says whether it carries
  `.CurrentTailnet.MagicDNSEnabled`. `tailscale debug prefs` gives `RunSSH: true`.
- GitHub's published hook ranges, read from `https://api.github.com/meta`, are what
  the `github` firewall rule contains, and a real push through them reaches Coolify.
- `npx -y skills add ...` completes over an SSH session with no terminal.
- The SSH grant in the pasted policy lets the operator open `ssh root@<tailnet-ip>`
  with no key, before port 22 is closed, and with every key and password method
  turned off, the way step 3 runs it.
- `npx skills add gwpicard/coolify-launchpad` does not offer the vendored humanizer
  under `.agents/maintainer-skills/`.
- `/setup-coolify-devops` step 2 passes its firewall check with no gap recorded for
  the firewall or the env file.
- `npm run launch -- --server <name> --resume` after 22 is closed completes over the
  tailnet and leaves the env file untouched.
- `tailscale ip -4 <name>` on the operator's machine finds the new node, which is
  how `--resume`, `/check-server` and `/retire-server` reach it.
- Hetzner's `set_rules` call answers with an action that `GET
  /firewalls/actions/<id>` can follow to `success`, and the rules it reads back
  compare equal to what was sent, IPv6 ranges included. If Hetzner rewrites a
  range, record how, and fold the normalisation into `lib/hetzner-firewall.ts`.
- The probe from the operator's machine reads every port closed within a minute
  of the rules changing, and `curl -sI http://<tailnet-ip>:8000` answers.
- NodeSource's setup script and `npm install -g @anthropic-ai/claude-code` finish
  in cloud-init, and `node --version` on the box reads 22.
- `npx -y skills add` leaves none of `AGENTS.md`, `CLAUDE.md`, `instance.yaml`,
  `docs/` or `stacks/` in `/root`, and writes `/root/skills-lock.json`.
- `/setup-coolify-devops` step 1 accepts every answer in the server block without
  asking again, the Tailnet line naming root rather than a group included.
- `npm run check-server -- --server <name>` reports nothing broken on the new
  server, with the Coolify token as its only to-do, and changes nothing.
- `npm run retire -- --server <name>` refuses a wrong typed name, then, with the
  right one, logs the node out (the detached `tailscale logout` runs after the
  session closes, and the node stops answering), destroys the server, the SSH key
  and the firewall, removes the stack and the two record files, and keeps
  `.env.<name>`.
- The node's identity check passes on the real server: the metadata service at
  `169.254.169.254/hetzner/v1/metadata/instance-id` answers with the stack's
  server id, and `api.ipify.org` from the box gives the stack's public IP.
- The probe covers the public IPv4 address only. Hetzner's firewall also guards
  the server's IPv6 address, and whether 22, 3000, 8000, 6001 and 6002 read
  closed over IPv6 is checked by hand from a machine with IPv6, off the tailnet,
  until the probe learns it. A probe from a machine without IPv6 would read every
  port closed and prove nothing, which is why it is not automatic yet.
- No token value appears anywhere in either session's transcript.

## Shown without a server

What the unit tests and the offline preview showed before any server existed.
A laptop can show this much; the list above is what only a real run confirms.

The substrate (the spec, the env check, the Pulumi program, cloud-init sections
1, 2, 4 and 5, and Phase B steps 1 to 3) has passed:

- `npm run check`: the unit tests, the type check, and the repository checks.
  The unit tests cover a spec whose name differs from its file name, the env
  check naming keys and never a value (including an untouched copy of
  `.env.example`, whose trailing comments must not count as values), every
  placeholder resolving, no `ubuntu` user and no `ufw`, every fetch over IPv4, the
  auth key reaching `tailscale up` through a file rather than the command line,
  the tailnet checks against saved `tailscale status` answers, and an SSH
  command that never answers being stopped at its time limit.
- `npm run preview:offline`: `pulumi preview` on a copy of the program with a
  throwaway local state folder, stand-in secrets, and the Hetzner provider
  pointed at a closed port on the operator's machine. It plans five resources
  (the stack, the key pair, the SSH key, the firewall `coolify` with one inbound
  rule for 22 and no outbound rules, and the `cpx32` server in `nbg1` on
  `ubuntu-24.04`), and user-data shows only as `[secret]`. It then imports a
  hand-built state for a server that already runs and previews again with a
  different auth key: nothing is planned. The same preview on a copy of the
  program without `ignoreChanges: ["userData"]` plans a replacement, driven by
  user-data alone. That also confirmed the Hetzner provider stores user-data as
  the base64 of its SHA-1. The first run
  downloaded the Hetzner and TLS provider plugins; nothing reached Hetzner,
  Tailscale or Pulumi Cloud. The Hetzner provider refuses to start unless the
  token is exactly 64 characters, so the stand-in is that long.

Phase B steps 4 to 9, the tooling section, the check and the retire have passed
`npm run check` without a server:

- The six combinations of public lane and dashboard exposure give exactly the
  rule sets in `docs/server-model.md`, with an empty list for `tailnet` and no
  public lane, and no combination opens 22, 3000, 6001 or 6002. GitHub's hook
  ranges come from a saved copy of GitHub's meta answer in
  `tests/fixtures/github-meta.json`, and an answer with no ranges, or one as wide
  as `0.0.0.0/0`, is refused.
- The Hetzner calls run against a stand-in that answers only the calls the
  launchpad makes: find the firewall, `set_rules`, follow the action, read back.
  A `coolify` firewall without this server's labels, or attached to another
  server, gets no `set_rules` at all. A read-back that differs stops the step.
  No error message carries the token.
- The probe tells an open port on this computer from a closed one, and a
  mismatch names each port.
- The env file script runs for real against a folder on this computer: written
  at mode 600, the `.bashrc` line added once, a second run leaves the file byte
  for byte, and a file the person already filled is never read out or changed.
- The whole of Phase B runs in order against stand-ins, in `github` mode with no
  public lane (the campaign's answers: `cpx22`, `nbg1`, tooling installed), and
  ends in the block. A resume leaves the env file untouched and skips the skills
  install. `internet` mode stops before the firewall until `--two-factor-on`. A
  probe mismatch renders the failure block with resume and retire as the ways
  forward.
- The block carries every label of the template in `docs/positioning.md`, in
  order.
- The check sends only GET requests to Hetzner and only read commands to the
  box. The retire refuses a missing stack, a stack from another project or with
  a resource type the program never creates, an unlabelled server and a live
  server whose id differs from the stack's, all before it asks for the name. A
  wrong, empty or near-miss name destroys nothing.

The three skills, their references and the prose guards have passed
`npm run check` without a server:

- `npm run launch -- --server <name> --preflight` names a missing key and no
  value, says ready once the three keys are set, asks Pulumi for its version and
  nothing else, and makes no Hetzner call.
- The guards under `tests/rules/` find each written rule in its skill and fail
  on a copy with that rule removed: presence not value in all three skills, the
  pasted token refused, the typed name for the retire, the announcement before
  the server is created and before the destroy, the check that only reads, the
  launch stopping at the block with no later step named, and the closing
  sentence last in every description.
- `skills-ref validate` accepts each skill, and the generated adapters match.

## The first real run, 2026-09-25

One `cpx22` server in `nbg1` on Hetzner, dashboard exposure `github`, no public
lane, the server-side tooling installed. The launchpad was the code that became
0.1.0, still stamped 0.0.0. The operator's agent was a Claude Code session in
the cloned folder that followed `/launch-server` as written. That agent answered
the six questions itself, from decisions made before the run. The person made
the Hetzner token and the auth key, and saved the tailnet policy in the console. On the server, coolify-devops 0.4.0 ran
`/setup-coolify-devops` through to its canary, and its `/host` then put a small
web app on the server, reached over the tailnet. `/retire-server` took the server
down the same day. Coolify 4.3.23 was what the installer installed.

The launch did not reach the block in one go. The ask to create the admin
account came about three minutes in, the person did not see it, and the 20-minute
wait ran out. The launch stopped cleanly and named the resume. Once the account
existed, `--resume` ran to the block without `--admin-created`.

### Timings

| Stage | Time |
|---|---|
| Reading the spec and checking the env file | 2 s |
| Creating the server on Hetzner | 22 s |
| Cloud-init finished and Coolify answering | 2 min 36 s |
| Tailnet node verified | 3 s |
| Node matched to the Hetzner server | 1 s |
| SSH grant proved | 0.6 s |
| Waiting for the admin account | the full 20 min, missed |
| The resume, from start to block | 21 s |
| The whole launch, less the missed wait | about 4 min |
| The retire, from the typed name | about 40 s (tailnet logout 16 s, Hetzner destroy 20 s) |

Within the resume, the env file took 0.3 s, the skills install 4.4 s, the lane
firewall 4.4 s and the probe 3 s.

### What it confirmed

Each row is a fact from the list above, in its order.

| Fact | Result | What the run showed |
|---|---|---|
| Registration page | Held | Once the admin account existed, `/register` answered 302 and sent the browser to `/login`, and the resume read that as the account existing. |
| Installer version argument | Not confirmed | `COOLIFY_VERSION` was unset, so the installer ran with no argument and installed its current release, 4.3.23. The version stays unpinned until a run passes one. The installer ran as root and finished, which does not show whether it requires root. |
| Server type and price | Partly | `cpx22` exists in `nbg1` and launched. `cpx32` was not tried, and no price was recorded. |
| Auth key from a file | Partly | `tailscale up --auth-key=file:<path>` joined with a one-off, pre-approved key. Nobody checked that the key file was gone from `/run` afterwards. |
| apt lock and IPv4 | Partly | Cloud-init finished without error in 2 min 36 s with the `Acquire::ForceIPv4` file in place. The log was not read for a wait on the lock or on an IPv6 address. |
| A failed first phase | Not tried | Nothing in the first phase failed. |
| Coolify on 8000 | Held | `127.0.0.1:8000` answered, and so did `localhost:8000`, which is why the block's Coolify line reads `localhost`. |
| The tailnet node | Partly | `.Self.Tags` held `tag:server`, `.Self.KeyExpiry` was null, HTTPS was on and `RunSSH` was true; coolify-devops read the same values again. Which of the two MagicDNS fields the node gave was not recorded. |
| GitHub's hook ranges | Partly | Six ranges were read, and the `github` rule and its read-back matched them. `/check-server` compared them with GitHub's list again and found them equal. No real push went through them. |
| `npx -y skills add` over SSH | Held | Completed in 4.4 s with no terminal: five skills in `/root`, and `/root/skills-lock.json` written. |
| The SSH grant | Held | Proved in 0.6 s with every key and password method off. The policy's `ssh` rule worked with `group:server-admins` as its source, as the preflight reference gives it. `autogroup:admin` as the source was not tried in the run; the reference leaves it out on the strength of Tailscale's rules, read while the skill was built. |
| The humanizer's placement | Not tried | |
| `/setup-coolify-devops` step 2 | Partly | It accepted the launchpad's probe as its firewall check. With no Hetzner token on the box it could not read the rules itself, and its later `/health` listed "firewall not read back" among its gaps. |
| A resume after 22 is closed | Not confirmed | The resume ran before the firewall step, so 22 was still open, though it chose the tailnet anyway. It wrote the env file for the first time, so leaving the file untouched was not tested either. |
| Finding the node by name | Held | `tailscale ip -4` found it, and the resume reached the server over the tailnet. |
| `set_rules` and its read-back | Held | The action finished and the rules read back equal to what was sent: "TCP 8000 from 6 source(s)". |
| The probe | Held | From the operator's machine, 22, 80, 443, 3000, 8000, 6001 and 6002 all read closed within seconds of the rules changing, and Coolify answered over the tailnet with HTTP 302. |
| Node and Claude Code | Held | `node --version` read v22.23.3, and Claude Code ran on the box. |
| `/root` left clean | Held | The launch's check of `/root` passed, and coolify-devops's scaffolder ran in place. |
| `/setup-coolify-devops` step 1 | Held | It read every binding from the box, and they matched the block, the Tailnet line included. |
| `/check-server` | Held | 13 rows, all ok, and nothing changed. A second read after the GitHub App was added gave 14 of 14. |
| The retire | Held | A first reply that was not the name was refused and nothing was destroyed. With the name, the node was logged out and stopped answering; the server, the SSH key and the firewall were destroyed; the stack and the two record files went; `.env.<name>` stayed. Read afterwards, the Hetzner project held no servers, firewalls, SSH keys or primary IPs. The console step that removes the machine was handed over and was still the person's to do when this was written. |
| The node's identity | Held | The metadata service gave the stack's server id, and the public IP matched. |
| The probe over IPv6 | Not tried | |
| No token in a transcript | Did not hold | The launch and retire output carried none. On the server, a coolify-devops session listed its own env file and put the Coolify token in that session's transcript. That step belongs to coolify-devops and was reported to its maintainer. |

In the consoles, the three tailnet policy entries from the preflight reference
saved as written and were all there after a reload.

### Still to confirm

The next rehearsal has to cover what this one did not:

- the installer's version argument, and then the pin;
- `cpx32` in `nbg1`, and the price of each size;
- the key file gone from `/run`, and the log free of lock and IPv6 waits;
- a failed first phase stopping early;
- which MagicDNS field a real node gives;
- a real push through GitHub's hook ranges reaching Coolify;
- a push webhook delivered with the webhook secret set;
- the manual GitHub App route in `internet` mode;
- `npx skills add gwpicard/coolify-launchpad` not offering the humanizer;
- a `--resume` after 22 has closed, leaving the env file untouched;
- the probe over IPv6, by hand from a machine with IPv6 off the tailnet;
- where Coolify keeps two-factor authentication (the ask says Settings, General);
- a resume after the account exists going on with no ask;
- `internet` mode and the public lane, which no run has tried;
- the Tailscale console removal step, done and seen to work;
- a launch started by typing `/launch-server` itself.

### Notes for the operator

- The admin-account ask comes about three minutes into the launch. Stay at the
  screen until it does, because a missed ask costs the 20-minute wait and a
  resume. Where the harness can send a desktop notification, the ask arrives
  as one too; note whether it did.
- A resume after the account exists looks at `/register` first and makes no
  ask.
- At the retire, reply with the bare server name. The IP address was refused,
  and a name with a full stop after it would not match either.
- The block of this release told the person to put their own IP on the 8000
  rule for the GitHub App. That was not needed: in this run the App was made by
  Coolify's manual route over the tailnet, with no firewall change. The
  automated route failed, because the dashboard was reached only over the
  tailnet. The block now points at the manual route.
- Traefik publishes 8080, which the probe does not test.
- Claude Code on the server runs as root. A headless run there refuses to bypass
  permissions and needs an allow-list, and the signed-in account's own connectors
  load on the server too.

Folded into this release: the announcement in `/launch-server` now says the ask
comes about three minutes in, and `/retire-server` shows the exact name to type. The
repeated ask, the GitHub App advice and the 8080 gap are left for the next
version.

## Taking a server down by hand

If `npm run retire` refuses a server that should be the launchpad's, or fails
partway, the server is destroyed by hand from the repository folder. The first
line loads the secrets into the shell without printing them:

```bash
set -a; . ./.env.<name>; set +a
cd program
PULUMI_BACKEND_URL="file://$PWD/../.pulumi" pulumi destroy --stack <name> --yes
PULUMI_BACKEND_URL="file://$PWD/../.pulumi" pulumi stack rm <name> --yes
```

Then remove the machine under Machines in the Tailscale console, because
destroying the server does not take it off the tailnet.

## What to record

After each run, one row in the table below, and for anything that failed, the
change that fixed it and the file it was folded into. A rehearsal that found
nothing still gets a row: that is the evidence the release stands on.

Record the date, the launchpad version being rehearsed, the coolify-devops version
installed on the box, the Coolify version the installer produced, whether each of
the facts above held, what failed, and where the fix landed.

A full run costs a few cents of Hetzner time for a server that lives under an hour.

## Runs

| Date | Launchpad | coolify-devops | Coolify observed | Facts held | What failed | Folded into |
|---|---|---|---|---|---|---|
| 2026-09-25 | 0.0.0, released as 0.1.0 | 0.4.0 | 4.3.23 | 13 held, 6 partly, 5 not confirmed or not tried, 1 did not hold; see the first real run above | The missed admin ask timed out the first pass, and a coolify-devops session put the Coolify token in its own transcript | The announcement in `/launch-server`; the typed name in `/retire-server` |
