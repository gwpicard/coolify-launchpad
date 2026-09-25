---
name: check-server
description: Read a launched server back without changing it, covering the firewall probe, the tailnet, Coolify answering, the env file, and the tooling on the box. Use when you want to know whether a server still matches what the launchpad handed over. Type this command when you want it; it never starts on its own.
license: MIT
compatibility: Run from a clone of coolify-launchpad on the operator's own computer, on the same Tailscale tailnet as the server. Read-only; needs network access to the Hetzner API and to the server over the tailnet.
metadata:
  author: gwpicard
  version: "0.1.0"
---

# /check-server

This command reads a server the launchpad made and says whether it still matches
what was handed over. It changes nothing: not the server, not the firewall, not
the records in this folder. You do the talking, and the script
`npm run check-server` does the reading. Never run `pulumi` yourself.

## Rules for the whole command

**Read only.** Run the check script and nothing that writes. If the check finds
something broken, report it and suggest the fix; do not apply it in this
command. A fix is a separate decision the person makes, and most fixes are a
resume of the launch, which changes the server.

**Secrets.** Check that a secret is present; never read its value. The check
script reports whether the Coolify token is set on the server as "set" or
"unset" and nothing more. Do not run `env | grep`, do not `cat` an env file, do
not `echo` a variable, and do not read shell history, on this computer or on the
server. Do not open `.env.<name>` with a file-reading tool either.

## 0. Is this a launchpad checkout?

Run `node -p "require('./package.json').name"` in the current folder. It must
print `coolify-launchpad`. If it does not, tell the person this command works
only inside the clone the server was launched from, because the records and the
Pulumi state live there, and stop. A fresh clone cannot check a server it did not
launch.

If `node_modules/` is missing, run `npm install` and say that you did.

## 1. Which server

Use the name typed after the command. Without one, list the files in `servers/`
other than `example.yaml` and ask which server to check; with only one, say which
and go on. The check needs `servers/<name>.yaml` and, in `.env.<name>`,
`HCLOUD_TOKEN` and `PULUMI_CONFIG_PASSPHRASE`. It does not need the auth key.

## 2. Run the check

```bash
npm run check-server -- --server <name>
```

It costs nothing and changes nothing, so it needs no announcement beyond one
line saying it is reading the server. It reads the firewall rules through the
Hetzner API with read requests only, probes the public ports from this computer,
checks the node on the tailnet, Coolify answering there, the env file on the
server and the tools on the server. It exits with 1 when anything is broken.

## 3. Report

Show the table as the script printed it, broken rows first. Then, for each
broken row, one or two plain sentences on what it means and what would fix it.
The troubleshooting table in [docs/server-model.md](../../docs/server-model.md)
covers most of them. The expected answers for each port are in the same
document, under "The outside probe".

Common fixes to suggest, never to run from here:

- Firewall rules that differ from the lane table, or a port open that should be
  closed: `npm run launch -- --server <name> --resume` sets the rules again.
  Say that this changes the live firewall.
- This computer cannot find the server on the tailnet: check that Tailscale is
  running here and that the machine in the Tailscale console still carries the
  server's name.
- The Coolify token unset on the server: that is a to-do from the block, not a
  fault. It is created in the Coolify dashboard and added on the server.

If nothing is broken, say so in one line.

Last, show the saved server block the script printed after the table, as it is.
Then stop.
