# Sources

This is a credit list for borrowed ideas rather than a list of everything the kit depends on. Why the kit is shaped the way it is belongs to `positioning.md`, so every line here credits a source and stops there.

Nobody named here was asked first, and nobody named here has endorsed this kit.

| Source | What it gave the kit |
|---|---|
| hermes-launchpad, the maintainer's own earlier project | The Pulumi and cloud-init substrate for a Hetzner server on a tailnet, the SSH harness and its hard-won options, the two-phase deploy with a second phase that can be run again, the troubleshooting table in the shape Symptom, Diagnosis, Fix, and the rule that a deploy path is not claimed to work until a real run has proved it. |
| [coolify-devops](https://github.com/KasperHonore/coolify-devops), by Kasper Honore | The two lanes, the firewall and probe tables, the five preconditions this kit stops at, the pasted block as the hand-off between machines, the rule that a secret's presence is checked and its value never read, and the rule that a skill is a living runbook that absorbs each lesson in the same change as the fix. |
| [AI Build Kit](https://github.com/gwpicard/ai-build-kit) | The README shape and section order, the writing rules, the prose guards that prove a written rule is still present by removing it, and the person as the transport between two machines. |
| [Coolify documentation](https://coolify.io/docs) | The installer and its requirements, the ports Coolify uses, and the note that Docker's port publishing bypasses `ufw`. |
| [Tailscale documentation](https://tailscale.com/kb) | Tagged auth keys, Tailscale SSH and the grant a tagged node needs, and Tailscale Services. |
