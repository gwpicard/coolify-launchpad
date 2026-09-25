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
- Still to land, one slice at a time: Phase B to the server block with `--resume` and the check and retire scripts, then the three
  skills with their generated adapters and prose guards, then release 0.1.0 after
  a full rehearsal through coolify-devops's canary and `/retire-server`.
