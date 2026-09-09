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
- Still to land, one slice at a time: the substrate (the Pulumi program,
  cloud-init, the spec, and Phase B through the SSH grant), then Phase B to the
  server block with `--resume` and the check and retire scripts, then the three
  skills with their generated adapters and prose guards, then release 0.1.0 after
  a full rehearsal through coolify-devops's canary and `/retire-server`.
