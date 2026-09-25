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
- No token value appears anywhere in either session's transcript.

## Before the first real run

This part of the record holds what has been shown without a real server, so the
first real run knows what it still has to prove.

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

The first real run is still pending. Until it has happened, nothing here is
claimed to work on Hetzner. It must run `npm run launch -- --server <name>` in
`github` mode with no public lane to the block, and then confirm the facts above
that a laptop cannot, in particular: the `/register` behaviour, `set_rules` and
its read-back, the probe reading every port closed, `npx -y skills add` over SSH,
a `--resume` after 22 has closed, `/setup-coolify-devops` step 1 and step 2's
firewall check with no gap recorded, and `npm run retire` taking the server down.

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
