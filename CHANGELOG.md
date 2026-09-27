# Changelog

One entry per version in `package.json`. The public repository carries a
`v<version>` tag and a GitHub release for each, with this entry as its notes. A
version is never re-released with different skill content; `tools/validate.sh`
refuses a version that does not match every skill.

## 0.1.1, 2026-09-27

A release after the second real run on Hetzner. That run used `github` mode
with a public lane on a DuckDNS name. The person typed `/launch-server` and
drove it, and coolify-devops then hosted an app on the public lane, with a
pull request preview and a push that deployed.

- Every launch now installs Coolify 4.3.23. The run passed that version to
  Coolify's installer, and the server ran exactly it.
- If `.env.<name>` already has all three keys, `/launch-server` says so and
  offers to skip the console steps. It checks only that each key is present.
- The admin account ask comes once. A resume looks at Coolify's registration
  page first and makes no ask when the account already exists. The ask also
  arrives as a desktop notification where the harness can send one. If you
  miss it, the agent repeats it when you next write.
- The ask now says to fill in every field, use a strong password (at least 8
  characters, mixed case, a number and a symbol) and submit the form once. Coolify allows about five submits a minute from one address.
  After an HTTP 429, wait two minutes before you try again.
- The server block gives a link that fills in GitHub's form for a new App from
  the server's own addresses. You type the webhook secret yourself. The App is
  then finished in Coolify by its manual route, with no firewall change. In the
  run, a push reached Coolify through the App's webhook with the secret set.
- The token item in the block gives one command to run on the server. It asks
  for the Coolify token without showing it and appends it to the env file as a
  quoted line.
- The block's Next line now depends on whether the token is already in the env
  file.
- With a public lane, the block lists Coolify's server Wildcard Domain, which
  you set by hand. With a DuckDNS name, it asks only for the DuckDNS token,
  because DuckDNS needs no wildcard record.
- The probe also tests port 8080, where Traefik publishes its dashboard, and
  expects it closed in every lane. The run read it closed.
- The before-you-launch guide now covers signing up for Hetzner, choosing your
  tailnet name before HTTPS is on, and installing Claude Code.
- A stray file in `skills/`, such as the `.DS_Store` a Mac leaves, no longer
  breaks the version check.

- The block's Claude Code item says to start `claude` from an interactive
  shell. A known gap, seen in the run: a session started with `bash -lc` had no
  token, because Ubuntu's `.bashrc` stops before the env file's line for a shell
  that is not interactive. There is no proven fix yet.
- For maintainers: a commit-msg hook in `.githooks/` takes AI attribution lines
  out of commit messages, and `tools/validate.sh` refuses a tracked file that
  carries one.

What the run confirmed: a resume after port 22 has closed leaves a filled env
file exactly as it was, and `/check-server` read every row as ok. None of this
release's skill and block changes was in the run, so 0.1.1 ships on a partial
rehearsal. Still open: `internet` mode, the probe over IPv6, where Coolify
keeps two-factor authentication, and a fix that lets a shell that is not
interactive see the token. `tests/rehearsal.md` lists every fact and what each
run showed.

## 0.1.0, 2026-09-25

The first release. It takes a person from no server to one that
coolify-devops's `/setup-coolify-devops` accepts, and it has been run once on a
real Hetzner server, from launch to retire. Two parts were not run: a resume
after port 22 had closed, and a launch started by typing `/launch-server`
itself.

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
- `--resume` runs the second half again over the tailnet. `/check-server` reads a server back and changes
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
