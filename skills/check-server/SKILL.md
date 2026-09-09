---
name: check-server
description: Read a launched server back without changing it, covering the firewall probe, the tailnet, Coolify answering, the env file, and the tooling on the box. Use when you want to know whether a server still matches what the launchpad handed over. Type this command when you want it; it never starts on its own.
license: MIT
compatibility: Run from a clone of coolify-launchpad on the operator's own computer, on the same Tailscale tailnet as the server. Read-only; needs network access to the Hetzner API and to the server over the tailnet.
metadata:
  author: gwpicard
  version: "0.0.0"
---

# /check-server

This command is not built yet. The repository holds its records and checks; the program behind the commands arrives in later slices, and `CHANGELOG.md` says which have landed.

Tell the person that in one sentence. Point them at `docs/design.md`, which describes what this command will do, and at `docs/positioning.md`, which says where it sits between AI Build Kit and coolify-devops. Then stop. Do not run anything, and do not improvise the steps from the design document.
