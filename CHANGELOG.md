# Changelog

One entry per version in `package.json`. The public repository carries a
`v<version>` tag and a GitHub release for each, with this entry as its notes. A
version is never re-released with different skill content; `tools/validate.sh`
refuses a version that does not match every skill.

## Unreleased

- The repository exists, with its records and its checks: the contributor guide,
  the writing rules, the three-way positioning, the server model with its firewall
  and probe tables, the design record, the sources, the rehearsal procedure, the
  vendored humanizer, and the prose guard library. The layout is in place for the
  code that has not been written yet.
- No code has run against a real server. Nothing here has been rehearsed, and the
  facts the design leans on (how Coolify's registration page behaves after the
  first user, the installer's version argument, the current Hetzner type names,
  GitHub's hook ranges, `npx -y` over a session with no terminal, the SSH grant,
  the humanizer's placement) are all marked to be confirmed in the first rehearsal.
- The substrate has landed. `npm run launch -- --server <name>` reads the spec
  and `.env.<name>`, checks this computer and that each secret is set (by name,
  never by value), creates the server with Pulumi, waits for cloud-init and
  Coolify, verifies the tailnet node, and proves the SSH grant from this
  computer. It stops there, with port 22 still open. If it stops earlier, it
  prints the failure block; its way forward is to run the launch again, or to
  destroy the stack by hand as `tests/rehearsal.md` describes, until `--resume`
  and `/retire-server` land. It has passed its unit tests and an offline
  `pulumi preview`. It has not yet run against Hetzner.
- A later launch never replaces a running server over a change to user-data, such
  as a pinned Coolify version or a new auth key. The auth key reaches `tailscale
  up` through a file rather than the command line, and `.env.example` now asks
  for a one-off, pre-approved key, because user-data stays readable on the box.
  Step 3 gives up on a connection held by a Tailscale `check` rule and says to
  change it to `accept`. On a Mac, the App Store build of Tailscale is found.
- `pulumi login` is no longer an install step: the launch keeps Pulumi's state in
  `.pulumi/` itself. A copy of `.env.example` needs `chmod 600`, and the launch
  says so if it is missing.
- The launch now runs to the end. After the SSH grant it waits while you create
  the Coolify admin account over the tailnet, writes the env file once at mode
  600, installs the coolify-devops skills in `/root` when the spec asks for the
  tooling, replaces the firewall's rules with the lane's (22 closes), probes the
  public IP, and prints the server block and a list of what is still yours to do,
  also written to `servers/<name>.block.txt`. Node 22 and Claude Code are
  installed by cloud-init, after Coolify, when the tooling is asked for, and a
  failure there no longer stops Coolify's install.
- `npm run launch -- --server <name> --resume` runs the second phase again, over
  Tailscale SSH once port 22 has closed, and leaves the env file as it is. It
  stops at once, rather than waiting, when it cannot find the node and 22 is
  closed. If Coolify's registration page never closes, `--admin-created` says
  the account exists, but in `internet` mode 8000 still stays shut while the page
  answers. In `internet` mode nothing opens until `--two-factor-on`.
- A machine found on the tailnet by name must prove it is the stack's server,
  by its public IP and Hetzner instance id, before the launch goes on, the check
  reads it, or the retire logs it out. A stale machine of the same name is left
  alone.
- A resume, the check and the retire no longer need `TAILSCALE_AUTH_KEY`, which
  is spent after the launch.
- `npm run check-server -- --server <name>` reads a server back without changing
  it and prints one table, broken things first, then the server block again.
- `npm run retire -- --server <name>` refuses a server the launchpad did not
  create, destroys nothing until the name is typed, logs the node out of the
  tailnet, destroys the server and its stack, and hands over the console step
  that removes the machine.
- The firewall only changes a `coolify` firewall that carries this server's
  labels. Its rule descriptions are now the exact strings coolify-devops sends.
  The block's Tailnet line says the grant reaches root, proved from this
  computer, because the launchpad cannot read which group the policy names, and
  a new Admin line says how the account was known to exist.
- All of this has passed its unit tests against stand-ins and the offline
  preview. None of it has run against Hetzner.
- The three commands work in Claude Code. `/launch-server` asks six questions
  and writes `servers/<name>.yaml`. It walks you through the Hetzner token, the
  tailnet policy, the auth key and the env file, and checks what it can with
  the new `npm run launch -- --server <name> --preflight`, which creates
  nothing. It says what the server will cost before it creates one, tells you
  when to create the Coolify admin account, and reads the server block back.
  `/check-server` reads a server and changes nothing. `/retire-server` destroys
  a server only after you type its name in reply to the warning.
- [docs/before-you-launch.md](docs/before-you-launch.md) says where to click in
  the Hetzner and Tailscale consoles. The tailnet policy's `ssh` rule names a
  group of operators, because Tailscale does not accept `autogroup:admin` as
  the source of an `ssh` rule.
- Prose guards under `tests/rules/` keep the rules the scripts cannot hold: a
  secret is checked for presence and never read, a pasted token is refused,
  the retire waits for the typed name, a step that costs money is announced, the
  check only reads, the launch stops at the block, and each description ends
  with its closing sentence.
- Still to land: a first real launch driven from a Claude Code session, then
  release 0.1.0 after a full rehearsal through coolify-devops's canary and
  `/retire-server`.
