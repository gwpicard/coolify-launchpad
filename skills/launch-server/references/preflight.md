# The preflight

Nothing is spent until every item here has been checked. Give the steps in this
order, one at a time, with the link to the matching section of
[docs/before-you-launch.md](../../../docs/before-you-launch.md). The order
matters in one place: the tag must exist in the tailnet policy before a key can
be made for it.

Every value the person creates goes into `.env.<name>`, written by the person in
their own editor. You check that it is present. You never see it.

## 1. A Hetzner project and a Read & Write token

Section: [A Hetzner project and token](../../../docs/before-you-launch.md#a-hetzner-project-and-token).

The person creates a new project in the Hetzner Cloud Console for this server,
then an API token in that project with the permission "Read & Write". Hetzner
shows the token once. It goes straight into `.env.<name>` as `HCLOUD_TOKEN`
(step 5 below), never into this conversation.

Say why a new project: the firewall is always named `coolify`, and Hetzner
allows one firewall of a name in each project.

The launchpad's token stays on this computer. It never goes to the server,
because a read and write token on the server could delete the server.

## 2. Tailscale on this computer

Section: [Tailscale on this computer](../../../docs/before-you-launch.md#tailscale-on-this-computer).

This computer must be signed in to the tailnet. The person creates the Coolify
admin account over the tailnet, and the launchpad reaches the server over it
once port 22 closes. MagicDNS and HTTPS must both be on for the tailnet, in the
admin console under DNS. The preflight checks that this computer is on the
tailnet; the launch checks MagicDNS and HTTPS on the new server.

## 3. The tailnet policy

Section: [The tailnet policy](../../../docs/before-you-launch.md#the-tailnet-policy).

The person opens Access controls in the Tailscale admin console and adds the
entries below. The launchpad holds no Tailscale credential that can edit the
policy, so this is theirs to do. Give them the block exactly, with
`you@example.com` replaced by their Tailscale login (ask for it; it is not a
secret). The login is shown on the Users page of the admin console,
https://login.tailscale.com/admin/users. It is not always an email address: a
person who signs in with GitHub has a login like `name@github`, and that exact
value is what the group needs.

```json
"groups": {
  "group:server-admins": ["you@example.com"]
},
"tagOwners": {
  "tag:server": ["group:server-admins"]
},
"ssh": [
  {
    "action": "accept",
    "src":    ["group:server-admins"],
    "dst":    ["tag:server"],
    "users":  ["root"]
  }
]
```

Tell them how to add it:

- A policy file has one `groups`, one `tagOwners` and one `ssh` section. If one
  already exists, add the new entry inside it, after a comma, rather than
  pasting a second section with the same name. The new `ssh` rule goes into the
  existing `ssh` list beside the default rule.
- A section that exists only as a comment can be replaced by the block's
  version.
- Save. The console checks the file and refuses one with a mistake in it, and
  says where.

Why each entry is there, in one sentence each if the person asks:

- `tagOwners` lets the group put `tag:server` on a machine. The auth key in
  step 4 can only carry a tag that is already listed here.
- The `ssh` rule lets the group reach `root` on tagged machines over Tailscale
  SSH. The default rule only reaches a person's own devices, and a tagged
  machine has no owner, so without this rule Tailscale SSH refuses everyone.
- The source is a group because Tailscale does not accept `autogroup:admin` as
  the source of an `ssh` rule.
- The action is `accept`. A `check` rule waits for someone to sign in in a
  browser, which cannot happen during a launch, and the launch stops on it.

If the policy restricts network access with its own `grants` or `acls`, the
group also needs to reach `tag:server` on port 8000. The default policy already
allows it.

The `autoApprovers.services` entry and the Tailscale OAuth client are not part of
this block. `/setup-coolify-devops` asks for them later, and the server block
lists them under "Still yours to do".

## 4. The auth key

Section: [The auth key](../../../docs/before-you-launch.md#the-auth-key).

After the policy is saved, the person generates an auth key on the Keys page of
the Tailscale admin console, with these settings:

| Setting | Value | Why |
|---|---|---|
| Reusable | off | The key reaches the server in user-data, which stays readable on the server for its whole life. A one-off key is spent once the server joins, so what stays readable can add no machine. |
| Ephemeral | off | An ephemeral machine is removed from the tailnet once it goes offline, so a long reboot could delete the server's place on the tailnet. |
| Pre-approved | on, when the form shows it | The form shows it only when the tailnet requires device approval. With it, the server joins without waiting for someone to approve it. |
| Tags | on, `tag:server` | The server joins already tagged, which also turns off key expiry for it. |
| Expiration | any | The key only has to last until the launch. |

The key goes into `.env.<name>` as `TAILSCALE_AUTH_KEY`. Each launch needs a new
key.

## 5. The env file

Section: [The env file](../../../docs/before-you-launch.md#the-env-file).

The person runs these two lines in their own terminal, then opens the file in
their own editor and fills in the three values:

```bash
cp .env.example .env.<name>
chmod 600 .env.<name>
```

- `HCLOUD_TOKEN`: the token from step 1.
- `PULUMI_CONFIG_PASSPHRASE`: a passphrase they choose. It encrypts the
  launchpad's record of the server in `.pulumi/`. It is needed again to check,
  resume or retire this server, so they should keep a copy in their password
  manager.
- `TAILSCALE_AUTH_KEY`: the key from step 4.

You may run the two lines for them if they ask, since neither reads or writes a
value. The values themselves are always typed by the person.

## 6. The machine checks

Run `npm run launch -- --server <name> --preflight`. It checks the spec, Node 20
or newer, the `pulumi` and `ssh` commands, the Tailscale command and that this
computer is on the tailnet, that each of the three keys is set, and that the file
is readable by its owner only. It reports key names and never a value. When the
Pulumi CLI is missing, point at
[Pulumi's install page](https://www.pulumi.com/docs/iac/download-install/).

## 7. The two confirmations

The preflight cannot read the tailnet policy or how the key was made; that would
take a Tailscale credential the launchpad does not hold. Ask these two
questions, one at a time, and go on only on two yeses:

1. "Is the policy saved with the `tagOwners` entry for `tag:server` and the
   `ssh` rule for `root` on `tag:server`, with action `accept`?"
2. "Was the auth key made with the tag `tag:server`, not reusable, not
   ephemeral, and pre-approved if the form offered it?"

The launch proves both on the real server: it reads the tag and the key expiry
back, and it proves the SSH grant from this computer before anything closes.
