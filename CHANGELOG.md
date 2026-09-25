# Changelog

One entry per version in `package.json`. The public repository carries a
`v<version>` tag and a GitHub release for each, with this entry as its notes. A
version is never re-released with different skill content; `tools/validate.sh`
refuses a version that does not match every skill.

## 0.1.0, 2026-09-25

The first release. It takes a person from no server to one that
coolify-devops's `/setup-coolify-devops` accepts, and it has been run once, in
full, on a real Hetzner server.

- Clone the repository and type `/launch-server` in Claude Code. It asks six
  questions, walks you through the Hetzner token, the tailnet policy, the auth
  key and the env file, checks what it can without creating anything, and says
  what is about to be created before it creates it.
- The launch creates the server with Pulumi, waits for Coolify, joins the
  server to your tailnet with the `tag:server` tag and Tailscale SSH, and proves
  you can reach it as root from your own computer. It then asks you to create
  the Coolify admin account over the tailnet, writes the env file coolify-devops
  reads, installs Node 22, Claude Code and the coolify-devops skills when you
  asked for them, closes port 22, applies the firewall for your lane, probes the
  public address from outside, and prints the server block and what is still
  yours to do.
- `--resume` runs the second half again over the tailnet and leaves an env file
  you have filled alone. `/check-server` reads a server back and changes
  nothing. `/retire-server` destroys only a server the launchpad made, and only
  after you type its name.
- The launchpad never reads a secret's value, never takes a token pasted into
  the session, and never sends its own Hetzner token to the server.

What the rehearsal showed, on a `cpx22` in `nbg1` in `github` mode with no
public lane, handed over to coolify-devops 0.4.0 and then retired:

- The launch itself took about four minutes of machine time: the server in
  22 seconds, cloud-init and Coolify in 2 minutes 36 seconds, the tailnet and
  the SSH grant in a few seconds, and the second half in 21 seconds.
- The probe read every port closed, Coolify answered over the tailnet, and
  `/check-server` found nothing broken. coolify-devops accepted every answer in
  the server block, reached its canary, and hosted an app on the server.
- The retire refused a reply that was not the server name. With the name, it
  took the server down in about 40 seconds and left the Hetzner project empty.
- The ask to create the admin account comes about three minutes in, and the
  first time it was missed, so the launch waited out its 20 minutes and needed a
  resume. `/launch-server` now says when the ask will come. `/retire-server` now
  shows the exact name to type, because the first reply was the IP address.
- Coolify 4.3.23 was installed. The installer's version argument was not tried,
  so the Coolify version is still not pinned.
- Not yet confirmed: `internet` mode, the public lane, the probe over IPv6, a
  resume after port 22 has closed, and where Coolify keeps two-factor
  authentication. `tests/rehearsal.md` lists every fact and what the run showed.
