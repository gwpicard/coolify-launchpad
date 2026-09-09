---
name: launch-server
description: Rent a server, install Coolify on it, join it to your Tailscale tailnet, lock the firewall to the lane you choose, and hand back a server block for coolify-devops. Use when a team needs a home for its tools and has no server yet. Runs on your own computer, inside this folder. Type this command when you want it; it never starts on its own.
license: MIT
compatibility: Run from a clone of coolify-launchpad on the operator's own computer, with Node 20 or newer, the Pulumi CLI, and this computer on the Tailscale tailnet. Needs network access to the Hetzner API and to the new server.
metadata:
  author: gwpicard
  version: "0.0.0"
---

# /launch-server

This command is not built yet. The repository holds its records and checks; the program behind the commands arrives in later slices, and `CHANGELOG.md` says which have landed.

Tell the person that in one sentence. Point them at `docs/design.md`, which describes what this command will do, and at `docs/positioning.md`, which says where it sits between AI Build Kit and coolify-devops. Then stop. Do not run anything, and do not improvise the steps from the design document.
