---
name: launch-server
description: Rent a server, install Coolify on it, join it to your Tailscale tailnet, lock the firewall to the lane you choose, and hand back a server block for coolify-devops. Use when a team needs a home for its tools and has no server yet. Runs on your own computer, inside this folder. Type this command when you want it; it never starts on its own.
license: MIT
compatibility: Run from a clone of coolify-launchpad on the operator's own computer, with Node 20 or newer, the Pulumi CLI, and this computer on the Tailscale tailnet. Needs network access to the Hetzner API and to the new server.
metadata:
  author: gwpicard
  version: "0.1.0"
---

# /launch-server

This command takes a person from no server to a Coolify server on their tailnet,
behind a firewall, with a server block that says what was built. You do the
talking and the script `npm run launch` does the work. Never run `pulumi`
yourself, and never run a step of the launch by hand over SSH.

The person may never have done this before. Before you ask them to do something,
say in one sentence what it is for. Ask one question at a time.

## Rules for the whole command

**Secrets.** Check that a secret is present; never read its value. The
launchpad's own preflight does that and names keys only. Do not run `env | grep`,
do not `cat` an env file, do not `echo` a variable, and do not read shell
history. Do not open `.env.<name>` with a file-reading tool either. A session
that did one of those once wrote a live token into its own transcript.

**A pasted token.** The person writes each secret into `.env.<name>` in their
own editor. Never offer to write one for them, and never ask them to paste one
here. If the person pastes a token, key or passphrase into this conversation
anyway, do not use it, repeat it, or write it anywhere. Tell them it is now in
the transcript, so they should revoke it where they made it, make a new one, and
put the new one straight into the file. Then carry on from the preflight.

**Money and online changes.** Before any step that costs money, or creates or
deletes something online, say what it will do and what it costs, and wait for
the person to say go. In this command that step is creating the server. Reading
a page, checking a file or running the preflight costs nothing and changes
nothing, so none of them needs an announcement.

**Where the launch ends.** The launch stops at the server block. Everything
after it belongs to `/setup-coolify-devops` on the server. Do not start any of
that work, and do not describe it beyond what the block's "Still yours to do"
list says. [docs/positioning.md](../../docs/positioning.md) explains the split.

## 0. Is this a launchpad checkout?

Run `node -p "require('./package.json').name"` in the current folder. It must
print `coolify-launchpad`. If it prints anything else, or there is no
`package.json`, tell the person this command works only inside a clone of the
launchpad, give them the three lines below, and stop.

```bash
git clone https://github.com/gwpicard/coolify-launchpad
cd coolify-launchpad
npm install
```

They then start Claude Code in that folder and type `/launch-server` again.

If `node_modules/` is missing, run `npm install` and say that you did.

## 1. Has a launch already started?

If the person typed a server name after the command, or pasted a "Not launched
yet" block, look for `servers/<name>.yaml` and `servers/<name>.block.txt`.

- A block file means the server was launched. Show the block as step 6 says, and
  suggest `/check-server <name>` rather than a new launch.
- A spec with no block may be a launch that stopped. Try the resume; it is safe
  either way. Go to step 5 and run it as that step says. A resume needs only
  `HCLOUD_TOKEN` and `PULUMI_CONFIG_PASSPHRASE`, creates no server, and stops
  with nothing spent when there is no server to resume.

## 2. The interview

Ask the six questions in [references/interview.md](references/interview.md), one
at a time, each with its best guess. Then write `servers/<name>.yaml` from the
answers in the shape of `servers/example.yaml`, show the file to the person, and
ask whether it is right. The name `example` is refused, because it is the
template.

## 3. Before you launch

Walk the person through [references/preflight.md](references/preflight.md) in
its order: the Hetzner project and token, Tailscale on this computer, the tailnet
policy, the auth key, and the env file. Each console step has a section in
[docs/before-you-launch.md](../../docs/before-you-launch.md). Give the person the
link to that section when they reach the step. Wait until they say a step is done
before you give the next one.

Then run the checks a machine can make:

```bash
npm run launch -- --server <name> --preflight
```

It reads the spec, checks Node, Pulumi, `ssh` and Tailscale on this computer,
checks that this computer is on the tailnet, and checks that the three secrets
are set in `.env.<name>` and that only the owner can read the file. It creates
nothing and spends nothing. If it names a problem, explain it in plain words,
wait for the person to fix it, and run it again.

The preflight cannot see the tailnet policy or how the auth key was made. Ask the
person to confirm each, in two separate questions, worded as preflight.md words
them. Do not go on until both answers are yes. The launch proves both on the
real server before anything closes.

## 4. The announcement

Before the server is created, tell the person in a few short lines:

- A Hetzner server of type `<type>` in `<location>` is about to be created in
  their Hetzner project. Hetzner bills it by the hour from now until it is
  retired. Give a price only if the person has read it on Hetzner's own page;
  never guess a figure.
- The launch also creates an SSH key and a firewall named `coolify` in that
  project, and the server joins their tailnet with the auth key, which uses the
  key up.
- It takes about five minutes. About three minutes in, they must create the
  Coolify admin account in their browser, so they should stay at the screen
  until that ask comes. A missed ask costs a 20-minute wait and a resume.
- If it stops partway, the server may already exist, and it costs money until
  they resume or retire it.

Ask for a plain yes. Any other answer means do not launch.

## 5. The launch

The launch runs longer than a foreground command may last, so start it in the
background with its output going to a log file:

```bash
npm run launch -- --server <name> --json > servers/<name>.launch.log 2>&1
```

A background command may report only when it ends, which would be too late: the
admin account step needs the person within minutes. So do not wait for the
command to finish. Read the log file about every 30 seconds, or use a tool that
reports each new line as it is written, until a `result` line appears. Read only
the lines that are new since the last look. The log holds progress and no
secret. Git ignores it, and a later launch or resume overwrites it.

Each line is one JSON object. A `progress` line has `step`, `status`
(`started`, `done`, `skipped` or `failed`) and sometimes `detail` or `ask`. The
last line is a `result`. Tell the person where the launch is in one short line
per finished step. Do not paste the raw JSON. Every resume below runs the same
way, with `--resume` and its flags added before `--json`.

**The browser step.** A `started` line that carries an `ask` is the admin
account step. On a first launch it comes about three minutes in, and the person may have looked
away, so make it hard to miss. If this harness gives you a tool that sends a
desktop or push notification, send one saying the launch needs them in the
browser now. Tell them in the chat as well, at once, using the address in the
`ask` text:

1. Open `http://<tailnet-ip>:8000` in a browser on this computer, now.
2. Create the Coolify admin account there. Whoever reaches that page first owns
   the server, which is why nothing is open to the internet yet.
3. Turn on two-factor authentication for that account, where the `ask` text
   says. No real launch has confirmed that place yet, so if the setting is not
   there, ask the person to look through Coolify's settings for it.

The launch waits up to 20 minutes and carries on by itself once Coolify closes
its registration page. The person never types a password into this
conversation. On a resume where the account already exists, the step carries
no `ask`, so there is nothing to relay.

**If the wait runs out.** The launch stops when the registration page still
answers. Ask the person whether they created the account. If they say they did,
run the resume with `--admin-created`. The block then says the account was
confirmed by them, not verified.

**Internet mode.** With `dashboard: internet`, port 8000 opens to everyone, so
the launch stops before the firewall until two-factor authentication is on. Ask
the person to type `2fa on` once they have turned it on. Only then run the
resume with `--two-factor-on`. Never add that flag because it seems likely.

**When it stops.** The result has `status: "stopped"`, with `reached`, `finding`
and `then`. Show the failure block from
[docs/positioning.md](../../docs/positioning.md), filled from those fields, and
explain the finding in plain words. The troubleshooting table in
[docs/server-model.md](../../docs/server-model.md) says what most findings mean.
Then offer the ways forward that `then` names:

- `npm run launch -- --server <name> --resume --json`, once the finding is fixed.
  It runs the second phase again, changes nothing already written on the
  server, and creates no new server. It does replace the live firewall rules
  with the lane's, so say that in one line before it runs, for this resume and
  every other.
- `/retire-server <name>`, which destroys the server. It is a separate command
  with its own confirmation, so do not run the retire from here.

When the launch stopped before the server was created, the only way forward is
to fix the finding and launch again, after the announcement once more.

## 6. The server block

When the result has `status: "launched"`, read the block back as
[references/server-block.md](references/server-block.md) describes. Show the
block exactly as the script printed it, in a fenced block, then the "Still yours
to do" list, then where the block was written. End by saying that the next step
happens on the server, and stop.
