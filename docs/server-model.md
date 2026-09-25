# The server model

This document owns the firewall and probe tables the launchpad implements. They are coolify-devops's tables, restated here because the launchpad has to produce a server that passes coolify-devops's own checks. The origin is `platform.md` and `provisioning.md`, two runbooks that `/setup-coolify-devops` renders into every deployment repo. When this document and those runbooks disagree, the runbooks win and this document is fixed.

## Two lanes

Every tool on the server goes down one of two lanes.

The internal lane is the tailnet. A tool gets no public name and no route through the proxy. The docktail registrar on the server watches labelled containers and registers each one as a Tailscale Service, reachable at `https://<name>.<tailnet>.ts.net` by anyone the tailnet policy allows. coolify-devops's rule of thumb is to default to this lane.

The public lane is the internet. A tool gets a name under a wildcard domain the team owns, and Traefik terminates TLS and routes to the container. This lane exists only when the server has a public suffix, and ports 80 and 443 are open only then.

The launchpad asks which lanes the server will have, records the answer, and opens the ports that follow from it. Deploying the registrar, the proxy configuration and the DNS pinner is coolify-devops's job.

## Three dashboard exposures

Coolify's own dashboard and API live on port 8000 of the host. Who may reach it is a separate question from the lanes, and coolify-devops records the answer as `exposure.coolify_ui`.

| Exposure | Who reaches port 8000 | Push-to-deploy |
|---|---|---|
| `tailnet` | The team, over the tailnet only | No. Deploys are triggered from the MCP or the UI. |
| `github` | The team over the tailnet, plus GitHub's published webhook ranges | Yes. GitHub reaches the instance to deliver push events. The default. |
| `internet` | Anyone | Yes. The login page is on the open internet, so 2FA on every Coolify account is mandatory. |

`github` is the mode AI Build Kit's `/ship` relies on. Per-pull-request preview deployments and push-to-deploy on the default branch both need GitHub to reach Coolify. In `tailnet` mode every release is a manual redeploy.

## The firewall

The firewall is Hetzner's cloud firewall, named `coolify`, sitting outside the VM. It is an allow list. Everything not listed is dropped. There are no outbound rules, which keeps all outbound traffic open for Tailscale, Docker pulls and certificate issuance.

The inbound rules depend on the two answers above. The descriptions are the ones coolify-devops's `provisioning.md` renders, and the launchpad sends them unchanged.

| Inbound rule | Source | When | Description |
|---|---|---|---|
| TCP 80 | anywhere | A public suffix is set | Let's Encrypt HTTP challenge and the HTTP to HTTPS redirect (public lane) |
| TCP 443 | anywhere | A public suffix is set | The public lane, via Traefik |
| TCP 8000 | GitHub's webhook ranges | `github` mode | Push-to-deploy webhooks |
| TCP 8000 | anywhere | `internet` mode | The Coolify dashboard and push-to-deploy webhooks |
| none | | `tailnet` mode with no public lane | Nothing inbound. The tailnet needs no open port, and there is no public lane. |

GitHub's webhook ranges come from `GET https://api.github.com/meta`, key `hooks`. They change rarely but do change, so the launchpad fetches them at launch rather than hardcoding them.

Deliberately not in the list:

- Tailscale. It needs no inbound rule. It dials out on 443 and UDP and relays through Tailscale's own servers if it cannot connect directly.
- Port 22. SSH goes over the tailnet, through Tailscale SSH. The launchpad opens 22 during its second phase and removes it as the last remote step.
- Ports 6001 and 6002, Coolify's realtime and terminal channels. They stay closed from the internet in every mode. The dashboard works without them from outside, and the team has them over the tailnet.
- Anything an application listens on. Internal tools are reached by the registrar over the container network, public ones by Traefik on 443.

No `ufw` on the host. Docker publishes a container port by rewriting iptables ahead of the host firewall's own chain, so a host firewall never sees that traffic. Coolify's own documentation says the same and recommends the cloud provider's firewall. Adding `ufw` on top buys nothing and can break Coolify, which connects to itself over SSH on port 22, traffic that never crosses the cloud firewall but that `ufw` would block.

## The outside probe

After the rules are applied, the launchpad probes the server's public IP from the operator's machine, the same loop coolify-devops runs in its setup and in `/health`:

```bash
for p in 22 80 443 3000 8000 6001 6002; do
  timeout 3 bash -c "</dev/tcp/<public-ip>/$p" 2>/dev/null && echo "$p OPEN" || echo "$p closed"
done
```

| Port | Expected | Because |
|---|---|---|
| 22 | closed | SSH is tailnet only |
| 80, 443 | open with a public lane, closed without | The public lane, or no public lane |
| 8000 | open only in `internet` mode | In `tailnet` mode the dashboard is tailnet only. In `github` mode 8000 is open to GitHub's ranges only, so closed from the operator's machine is the rule working. |
| 3000, 6001, 6002 | closed | Always |

Then, from the operator's machine on the tailnet, `curl -sI http://<tailnet-ip>:8000` must answer.

The runbook asks for this probe from a machine that is not on the tailnet. The launchpad runs it from the operator's machine, which is on the tailnet. Traffic to the public IP does not use the tailnet, so the result is the same, but the server block says where the probe ran rather than claiming the runbook's condition.

## Where this differs from Coolify's own documentation

Coolify's firewall page lists 22, 80, 443, 8000, 6001 and 6002 as ports to open. That list is written for a server reached over the public internet by its own admin. coolify-devops's model reaches the server over the tailnet instead, so 22, 6001 and 6002 are never open to the internet, 8000 is open only as far as the dashboard exposure requires, and 80 and 443 are open only when there is a public lane.

The launchpad follows coolify-devops, because a server that follows Coolify's list would fail `/setup-coolify-devops`'s firewall check and `/health` would report the perimeter as wrong on every run.

## Two SSH legs

The launchpad reaches the new server in two ways, one after the other.

The first leg is `root@<public-ip>` with the SSH key Pulumi generated for the server, over port 22, which is the only inbound rule at creation. This leg lasts until the tailnet is verified.

The second leg is `root@<tailnet-ip>` over Tailscale SSH, with no key. Before the launchpad closes 22, it proves this leg works from the operator's machine with `ssh -o BatchMode=yes root@<tailnet-ip> true`. If that fails, the launch stops with the policy block to paste, and nothing has closed yet. Every later step, every `--resume`, `/check-server` and `/retire-server` uses this leg.

A tagged node needs an explicit SSH grant. Tailscale's default policy lets members reach their own devices, and a tagged node has no owner, so without a rule naming `tag:server` as a destination, Tailscale SSH refuses everyone. The launchpad's preflight hands over one policy block that carries both the `tagOwners` entry for `tag:server` and an `ssh` rule with the operator's group as source, `tag:server` as destination and `root` as the user.

## The auth key

The Tailscale auth key in `.env.<name>` must be created for `tag:server`, one-off rather than reusable, pre-approved, and not ephemeral.

Created for the tag, it brings the node up already tagged, and a tagged node has no key expiry. That removes two console steps coolify-devops otherwise hands over and verifies: tagging the node after the fact and disabling key expiry on it. The launchpad still reads `.Self.Tags` and `.Self.KeyExpiry` back and stops if either is wrong.

One-off, because the key travels in user-data, and user-data stays readable from Hetzner's metadata service for the life of the server, by any process or container on the box. A one-off key is spent the moment the server joins, so what stays readable can no longer add a machine to the tailnet. A reusable key would stay live there until it expires. Pre-approved, so a tailnet that requires device approval still lets the node straight in. A new launch needs a new key.

Not ephemeral, because an ephemeral node is removed from the tailnet after it goes offline. A server reboots. A reboot that took long enough would delete the server's tailnet identity, and every internal tool would go dark. The stale machine that a retired server leaves behind is handled in `/retire-server` instead, as a console step handed to the person.

## The admin registration race

Coolify's first visitor to `http://<ip>:8000` becomes the admin. Coolify's own documentation warns that whoever reaches the registration page first owns the server.

The launchpad keeps 8000 closed to the internet until the account exists. During the second phase it asks the person to open `http://<tailnet-ip>:8000` from their own machine on the tailnet and create the account, then polls the registration page until it stops answering. Only after that does it apply the lane firewall. In `internet` mode it also requires the person to type that 2FA is on before 8000 opens to anyone, and the server block says that 2FA was confirmed by the person, not verified by the launchpad.

Whether Coolify's registration page stops answering 200 after the first user is confirmed in the first rehearsal. If it does not hold, the launchpad asks the person to confirm the account exists instead.

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| `curl http://localhost:8000` fails on the box while `curl http://127.0.0.1:8000` works | `localhost` resolves to IPv6 on this image and Coolify bound IPv4 only | The launchpad checks both during its first step. If it reports this, the env file's URL is wrong for this box; set `COOLIFY_BASE_URL=http://127.0.0.1:8000` instead. |
| `apt-get` or the installer hangs with no output | A dead IPv6 route on the Hetzner image; names resolve to AAAA records and packets go nowhere | Every fetch in the launchpad's first phase forces IPv4. If you are on the box by hand, use `apt-get -o Acquire::ForceIPv4=true` and `curl -4`. |
| The launch waits past 20 minutes for the first phase | A slow mirror, a slow image pull, or the first phase failed partway | Over Tailscale SSH, read `/var/log/cloud-init-output.log` and `cloud-init status`. Fix what stopped, then `npm run launch -- --server <name> --resume`. |
| `ssh root@<tailnet-ip>` is refused, `tailscale status` shows the node up | The tailnet policy has no `ssh` rule with `tag:server` as destination | Paste the policy block the preflight printed, then run the proof again. Nothing has closed yet at this step. |
| `.MagicDNSSuffix` or `.CertDomains` is empty in `tailscale status --json` | MagicDNS or HTTPS is not enabled on the tailnet | In the Tailscale admin console, DNS, enable MagicDNS, then enable HTTPS. Then `--resume`. |
| A machine named after a retired server still shows offline in the Tailscale console | `tailscale logout` expires the key; it does not delete the machine | In the console, Machines, the entry, Remove. `/retire-server` prints this step. |
| The probe reads 8000 open in `github` mode from the operator's machine | The firewall rule for 8000 has a wider source than GitHub's ranges, or the rules were not applied | `/check-server` reads the live rules back. Compare the sources with `GET https://api.github.com/meta`, key `hooks`, and re-apply. |
