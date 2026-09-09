# Before you launch: the steps only you can do

The launchpad rents the server, installs Coolify, joins the tailnet and closes the firewall. It cannot open an account for you, pay for anything, or click in a web console that is signed in as you. This page is every one of those steps, in the order you need them, with a way to tell that each one worked.

Set aside about an hour the first time. Most of it is waiting for emails and reading pages you will only see once. Nothing here costs money until the last step of the launch itself, when the server is created, and the Hetzner console shows the monthly price before you agree to it.

Two rules hold for the whole page. Never paste a key, token or password into the chat with Claude Code. Every secret goes into a file on your own computer with a text editor, or straight into a web console. And do the steps in the order given: three of them depend on the one before.

## What you will end up with

| Account | Why the launchpad needs it | What you create there |
|---|---|---|
| Hetzner Cloud | It rents the server | A project and one API token |
| Tailscale | The server joins your private network and you reach it there | A tailnet, two policy entries, and one auth key |
| Coolify | It runs on the server | Nothing before the launch. One admin account during it |
| GitHub | Only if you want a release to be a push | Nothing before the launch |

## Part one: on your own computer

### 1. Install the tools

You need four programs on this computer. Install each one, then check it answers.

1. Claude Code. Follow the install page at https://docs.anthropic.com/claude-code. Check: type `claude --version` in a terminal and a version number appears.
2. Node, version 20 or newer. Get it from https://nodejs.org. Check: `node --version` prints `v20` or higher.
3. The Pulumi command line tool. On a Mac with Homebrew, `brew install pulumi`. Otherwise https://www.pulumi.com/docs/install. Check: `pulumi version` prints a version.
4. Tailscale, the app for this computer, from https://tailscale.com/download. Sign in with the account you will use for the team. Check: the Tailscale icon in your menu bar or tray says connected.

Done when all four checks pass.

### 2. Clone the launchpad

In a terminal:

```bash
git clone https://github.com/gwpicard/coolify-launchpad
cd coolify-launchpad
npm install
pulumi login file://$PWD/.pulumi
```

The last line tells Pulumi to keep its records inside this folder, on this computer, and nowhere else.

Done when `pulumi whoami` prints your computer's user name and no error.

### 3. Choose a passphrase

Pulumi encrypts the record of what it created. It needs a passphrase to do that. Choose one, and keep it in your password manager. If you lose it, the launchpad can no longer read its own records, and retiring the server becomes a console job.

You will put this passphrase in a file in step 9. Nothing to do yet except choose it.

## Part two: Hetzner

Hetzner is the company that rents you the server. Everything here happens at https://console.hetzner.cloud.

### 4. Create an account and a project

1. Sign up, confirm your email, and add a payment method. Hetzner asks for identity checks on some new accounts; that can take a day.
2. In the console, create a project. Name it after the team. The launchpad does not read the name.

Done when the project page opens and shows "Servers: 0".

### 5. Create the API token

1. Open the project. In the left menu choose Security, then the API tokens tab.
2. Click Generate API token. Give it the description `coolify-launchpad`. Choose Read and Write. The launchpad creates the server and the firewall, so read-only is not enough.
3. Copy the token now. Hetzner shows it once.
4. Paste it into your password manager, not into the chat.

Done when the token appears in the list with Read and Write beside it, and you hold a copy.

A note on what this token can do. It can delete every server in the project. It stays on this computer, in a file Git ignores, and the launchpad never copies it to the server.

## Part three: Tailscale

Tailscale is the private network. Every device you sign in becomes part of it, and the new server will too. Everything here happens at https://login.tailscale.com/admin.

### 6. Turn on MagicDNS and HTTPS

1. Open https://login.tailscale.com/admin/dns.
2. Under MagicDNS, click Enable if it is not already on.
3. Under HTTPS Certificates, click Enable HTTPS.
4. Note the tailnet name shown on this page. It looks like `tail1234.ts.net`. Every internal tool will live under it. You can rename it here, once, from a list Tailscale offers. Do that now if you want to, before anything joins.

Done when both switches read enabled and you have written down the tailnet name.

### 7. Add two entries to the access policy

The server will carry a tag, `tag:server`. A tag is a label that stands in for an owner, because a server has no person behind it. Two things must be true in the policy before the server can join: the tag must exist, and the people who run things must be allowed to reach a tagged machine over SSH.

1. Open https://login.tailscale.com/admin/acls/file.
2. You will see a text file in braces. Find the line that starts `"tagOwners"`. If there is none, add the whole entry below just inside the first opening brace.
3. Add these two entries. If `tagOwners` already exists, add only the `"tag:server"` line inside it. If `ssh` already exists, add only the rule inside it.

```
"tagOwners": {
  "tag:server": ["autogroup:admin"],
},
"ssh": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:server"],
    "users":  ["root"],
  },
],
```

4. Click Save. Tailscale checks the file and refuses a mistake with a line number. A missing comma is the usual one.

Done when the page saves without an error and `tag:server` appears when you search the file.

Why the second entry matters. Tailscale's default policy lets you SSH to your own devices. A tagged server belongs to nobody, so without this rule nobody can reach it, and the launchpad would create a server it can never finish setting up.

### 8. Create the auth key

An auth key lets a new machine join your tailnet without a person signing in on it. The launchpad gives it to the server once, at creation.

1. Open https://login.tailscale.com/admin/settings/keys.
2. Click Generate auth key.
3. Set Description to `coolify-launchpad`.
4. Switch Reusable on. You may launch more than one server.
5. Leave Ephemeral off. An ephemeral machine is deleted when it goes offline for a while, and a server reboots.
6. Switch Tags on and choose `tag:server`. This option only appears because you saved the policy in step 7.
7. Leave Expiration at the default. It limits how long the key can be used to join, not how long the server stays.
8. Click Generate key. Copy it now. Tailscale shows it once.
9. Paste it into your password manager.

Done when the key appears in the list with the tag `tag:server` and you hold a copy.

## Part four: back on your own computer

### 9. Write the env file

Every launch has a name, one lowercase word, such as `office`. The secrets for it live in a file named after it.

1. In the `coolify-launchpad` folder, copy `.env.example` to `.env.office`, using your name in place of `office`.
2. Open the copy in a text editor. Fill in the three lines from your password manager: the Hetzner token, the Pulumi passphrase from step 3, and the Tailscale auth key.
3. Save it. Git ignores every file that starts with `.env.` except the example, so it can never be committed by accident.

Done when the file has three filled lines and no blank values.

### 10. Start the launch

Open Claude Code in the `coolify-launchpad` folder and type `/launch-server`. It asks six questions, one at a time, each with a suggested answer. Then it checks everything above before it spends anything: that the three values are set (it never reads them), that this computer is on the tailnet, that the tools answer. If a check fails, it tells you which step above to go back to.

## Part five: during the launch

There is one step in the middle that only you can do, and the launch waits for it.

### 11. Claim the Coolify admin account

When Coolify is running, the launch prints an address of the form `http://100.x.y.z:8000` and asks you to open it. Only devices on your tailnet can reach that address. Nothing is open to the internet yet, on purpose: whoever reaches this page first owns the server.

1. Open the address in your browser on this computer.
2. Fill in the registration form. Use your own email and a password from your password manager.
3. Once you are signed in, open Settings, then General, and turn on two-factor authentication. Coolify shows a code to scan with an authenticator app.
4. Go back to Claude Code. The launch notices that registration has closed and carries on. If it does not, tell it you are done.

Done when you are signed in to Coolify with two-factor authentication on, and the launch has moved to the next step.

If you chose to open the dashboard to the whole internet, the launch asks you to type `2fa on` before it opens the port. Type it only when it is true.

## Part six: after the launch

The launch ends by printing a server block and saving a copy in `servers/<name>.block.txt`. Under it is a short list headed "Still yours to do". Those steps belong to coolify-devops, the kit that runs on the server, and its setup command hands each one to you and checks it. They are listed here so you know what is coming.

- Create a Coolify API token, in Coolify under Keys and Tokens, with the read, write and deploy scopes. Never the root scope. You add it to a file on the server using a one-line command that coolify-devops prints for you.
- Sign in to Claude Code on the server, through Coolify's own terminal (Servers, then Terminal) or over Tailscale SSH.
- In the Tailscale policy, add an `autoApprovers` entry for `tag:server`, then create an OAuth client at https://login.tailscale.com/admin/settings/trust-credentials with the Devices Core and Services write scopes. coolify-devops gives you the exact text and tells you where the two values go.
- If you chose a public lane, a DNS token for the domain.
- If you chose to let a release be a push, the GitHub App, created once from Coolify's Sources page, after coolify-devops accepts the server.

Then, on the server, type `/setup-coolify-devops`. Its first interview is a confirmation of the block you carried over.

## If something goes wrong

The launch never leaves you guessing. It prints a "Not launched yet" block that names the last step that passed, one line about what failed, and the two things you can do: run it again with `--resume`, or retire the server and start over. The common causes and their fixes are in [docs/server-model.md](server-model.md), in the table at the end.

Two facts on this page are marked to be confirmed in the first real run and may change: how Coolify closes registration after the first account, and the exact wording of console buttons, which the vendors move from time to time. If a button is not where this page says, look for the same words nearby, and tell the maintainer so the page can be corrected.
