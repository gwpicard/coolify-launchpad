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
- The Hetzner server type names and prices the interview offers still exist in the
  chosen location.
- GitHub's published hook ranges, read from `https://api.github.com/meta`, are what
  the `github` firewall rule contains, and a real push through them reaches Coolify.
- `npx -y skills add ...` completes over an SSH session with no terminal.
- The SSH grant in the pasted policy lets the operator open `ssh root@<tailnet-ip>`
  with no key, before port 22 is closed.
- `npx skills add gwpicard/coolify-launchpad` does not offer the vendored humanizer
  under `.agents/maintainer-skills/`.
- `/setup-coolify-devops` step 2 passes its firewall check with no gap recorded for
  the firewall or the env file.
- `npm run launch -- --server <name> --resume` after 22 is closed completes over the
  tailnet and leaves the env file untouched.
- No token value appears anywhere in either session's transcript.

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
