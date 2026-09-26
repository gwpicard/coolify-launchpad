# Before you launch

The console steps a launch needs, in the order `/launch-server` asks for them.
The agent links to each section when you reach it. You can also do them all
before you start.

Every value you create here goes into one file on your computer, `.env.<name>`,
typed by you in your own editor. Do not paste a token, key or passphrase into
the chat. If one lands there by mistake, revoke it where you made it and make a
new one.

The exact policy block and the auth key settings live in
[the preflight reference](../skills/launch-server/references/preflight.md),
which the agent reads from. This page says where to click.

## A Hetzner project and token

1. If you have no Hetzner account, sign up, confirm your email and add a
   payment method. Hetzner may run an identity check on a new account, and that
   can take up to a day, so do this well before the launch.
2. Sign in to the [Hetzner Cloud Console](https://console.hetzner.cloud/).
3. Create a new project for this server. Use a new project for each launchpad
   server: the firewall is always named `coolify`, and Hetzner allows only one
   firewall of a name in each project.
4. Open the project, then Security, then API tokens, and generate a token with
   the permission "Read & Write".
5. Hetzner shows the token once. Put it straight into `.env.<name>` as
   `HCLOUD_TOKEN` (see [The env file](#the-env-file)).

The token stays on your computer. The launchpad never sends it to the server.

## Tailscale on this computer

1. Install Tailscale on this computer and sign in to your tailnet. The
   Tailscale app should then show that it is connected.
2. Open the [DNS page](https://login.tailscale.com/admin/dns) of the Tailscale
   admin console and note your tailnet name. It looks like `tailXXXX.ts.net`,
   and every address on your tailnet ends with it. If you want a different one,
   choose it now with Rename tailnet, before any machine joins. A later change
   can break links to the machines already on it.
3. On the same page, turn on MagicDNS, then turn on HTTPS certificates.

You create the Coolify admin account over the tailnet, and the launchpad
reaches the server over it once port 22 closes, so this computer has to be on
the tailnet during the launch.

## The tailnet policy

1. Open [Access controls](https://login.tailscale.com/admin/acls) in the
   Tailscale admin console.
2. Add the `groups`, `tagOwners` and `ssh` entries from
   [the preflight reference](../skills/launch-server/references/preflight.md#3-the-tailnet-policy),
   with your own Tailscale login in the group. The
   [Users page](https://login.tailscale.com/admin/users) shows it. If you sign in
   with GitHub it looks like `name@github`, and that is the value to use. Where a
   section already exists, add the entry inside it rather than pasting a second
   one.
3. Save. The console refuses a policy with a mistake and says where it is.

Do this before the auth key: the key form offers only tags the policy already
lists.

## The auth key

1. Open [Keys](https://login.tailscale.com/admin/settings/keys) in the Tailscale
   admin console and generate an auth key.
2. Reusable off. Ephemeral off. Tags on, with `tag:server`. Pre-approved on, if
   the form shows it; it appears only when your tailnet requires device
   approval. Any expiry will do.
3. Put the key straight into `.env.<name>` as `TAILSCALE_AUTH_KEY`.

Each launch needs a new key. The reasons for each setting are in
[the server model](server-model.md#the-auth-key).

## The env file

In a terminal, in the launchpad folder, with your server's name in place of
`<name>`:

```bash
cp .env.example .env.<name>
chmod 600 .env.<name>
```

Open `.env.<name>` in your editor and fill in the three lines:

- `HCLOUD_TOKEN`: the Hetzner token.
- `PULUMI_CONFIG_PASSPHRASE`: a passphrase you choose. It encrypts the
  launchpad's record of the server. You need it again to check, resume or retire
  the server, so keep a copy in your password manager.
- `TAILSCALE_AUTH_KEY`: the auth key.

Git ignores the file. The launchpad checks that each line is set and that only
you can read the file. It never prints a value.

## The tools

[Claude Code](https://docs.anthropic.com/en/docs/claude-code), where you type
`/launch-server`. Then Node 20 or newer, the
[Pulumi CLI](https://www.pulumi.com/docs/iac/download-install/), and `ssh`. There
is no Pulumi sign-in: the launchpad keeps its state in `.pulumi/` in this folder.
`npm run launch -- --server <name> --preflight` checks everything after Claude
Code and spends nothing.
