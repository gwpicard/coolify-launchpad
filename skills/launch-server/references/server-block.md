# Reading the server block back

The block's format, and what each line means, are owned by
[docs/positioning.md](../../../docs/positioning.md), "The server block". This
file says how to hand it to the person.

## What the result carries

The launch's last line is a `result` with `status: "launched"`. Its `block` field
is the server block followed by the "Still yours to do" list, as the script
wrote it. Its `path` field is where it was written, `servers/<name>.block.txt`.
The same text is in that file, which Git ignores.

## How to show it

1. Show the block and the list exactly as written, inside one fenced block. Do
   not reword, shorten or reorder a line. The person carries this text to
   another session, and `/setup-coolify-devops` reads it as answers.
2. Under it, explain in plain words any line that says something was confirmed
   by the person rather than verified: the Admin line after `--admin-created`,
   and the Dashboard line in `internet` mode. Say that these rest on the
   person's word.
3. If the Coolify line names `127.0.0.1` instead of `localhost`, say that
   `localhost` did not answer on the server, so the env file points at the
   address that does.
4. Go through the "Still yours to do" list in order, one sentence each on what
   the item is for. None of it is done. Do not offer to do any of it from here:
   each one is a console step or happens on the server.
5. The first item, when present, is the Coolify API token. Repeat that it is
   created in the Coolify dashboard and added on the server, and that it never
   goes into a chat session, this one included. The item gives the line to
   append. Say to keep its single quotes and to append it, never to overwrite
   the env file this launch wrote.

## How to end

Say where the next step happens: on the server, over `ssh root@<tailnet-ip>`,
where the person starts Claude Code and runs `/setup-coolify-devops`, then pastes
the block when its interview begins. Say that `/check-server <name>` reads this
server back at any time, and `/retire-server <name>` destroys it.

Then stop. The launch is over.
