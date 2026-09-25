---
name: retire-server
description: Destroy a server the launchpad created, after you type its name, and hand over the one console step that removes it from the tailnet. Use when a server is no longer needed. Type this command when you want it; it never starts on its own.
license: MIT
compatibility: Run from a clone of coolify-launchpad on the operator's own computer, with the Pulumi CLI and the local state that launched the server. Needs network access to the Hetzner API.
metadata:
  author: gwpicard
  version: "0.0.0"
---

# /retire-server

This command destroys a server the launchpad made: the server with its disk,
`/data/coolify` and every tool Coolify hosts on it, and the SSH key and firewall
the launch created. It cannot be undone. You do the talking, and the script
`npm run retire` does the work. Never run `pulumi` yourself.

## Rules for the whole command

**The typed name.** Nothing is destroyed until the person types the server name
in reply to the warning. That reply is the only confirmation. The name typed
after the command does not count, and neither does "yes". Never type the name
for them: do not fill it in, correct a typo in it, or carry it over from earlier
in the conversation. Pass their reply to the script exactly as they wrote it,
and let the script decide whether it matches.

**Money and online changes.** The destroy deletes a server, a firewall and an
SSH key at Hetzner, and logs the machine out of the tailnet. Say so before it
runs. It also ends the server's hourly bill.

**Secrets.** Check that a secret is present; never read its value. Do not run
`env | grep`, do not `cat` an env file, do not `echo` a variable, and do not read
shell history. Do not open `.env.<name>` with a file-reading tool either.

## 0. Is this a launchpad checkout?

Run `node -p "require('./package.json').name"` in the current folder. It must
print `coolify-launchpad`. If it does not, tell the person this command works
only inside the clone the server was launched from, because the Pulumi state
that knows the server lives there, and stop.

If `node_modules/` is missing, run `npm install` and say that you did.

## 1. Which server

Use the name typed after the command, or the one a failure block named. Without
one, list the files in `servers/` other than `example.yaml` and ask which server
to retire. The retire needs, in `.env.<name>`, `HCLOUD_TOKEN` and
`PULUMI_CONFIG_PASSPHRASE`. It does not need the auth key.

## 2. Check ownership and get the warning

Run the retire once without a confirmation:

```bash
npm run retire -- --server <name> --json
```

This run destroys nothing. It checks that the launchpad made the server: the
local stack, its resources and labels, and the live server at Hetzner, read
without changing anything. Then it stops, because no name was typed, and its
result carries the warning.

If it refuses the server, say why in plain words and stop. Nothing was changed.
The launchpad acts only on what it created; anything else is for the Hetzner
console.

## 3. The warning and the typed name

Show the warning as the script wrote it: which server, its public IP, that the
disk with `/data/coolify` and every hosted tool go with it, and that it cannot be
undone. Add that the machine is logged out of the tailnet and the firewall and
SSH key are deleted too, and that `.env.<name>` stays.

Then ask the person to type the server name to go ahead. Wait for their reply.

If the person would rather type it at a prompt themselves, give them this line
to run in their own terminal, inside this folder, and stop here:

```bash
npm run retire -- --server <name>
```

## 4. The destroy

Pass the person's reply, exactly as typed, inside single quotes:

```bash
npm run retire -- --server <name> --confirm '<their reply>' --json
```

Never pass `--confirm` with a name the person did not type in reply to the
warning. A server name holds only lowercase letters and digits, so a reply with
a quote mark in it cannot match: say so and do not run the command. If what they
typed does not match, the script refuses and destroys
nothing; tell them, and ask again only if they still want to go ahead.

Run it in the background if it may take more than a few minutes; `pulumi
destroy` usually finishes in one or two. Read the progress lines as they arrive
and tell the person where it is, one short line per step.

## 5. After

The result has `status: "retired"` and a `text` field. Show that text as it is.
Then go through what is left for the person:

- The console step in the text: remove the machine under Machines in the
  Tailscale admin console. Logging out expired the machine's key; it did not
  delete the machine, and the launchpad holds no credential that can. This is
  not done until they do it.
- `.env.<name>` is kept, because it holds their own Hetzner token and
  passphrase. They may delete it, and delete the token and the empty project in
  the Hetzner console, when they no longer need them.

If the result has `status: "stopped"` partway, show the detail and say what was
and was not destroyed, as the progress lines showed it. The manual clean-up in
[tests/rehearsal.md](../../tests/rehearsal.md), "Before the first real run",
takes a server down by hand when the script cannot.
