#!/usr/bin/env sh
# A step that costs money, or creates or deletes something online, is announced
# before it runs, and /check-server changes nothing. The scripts cannot hold
# either rule: they run whatever the agent starts.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
SKILLS="$(dirname -- "$0")/../../skills"

rs_init "Announced before it runs; the check only reads"
rs_rule "announce before spending or creating" 'before any step that costs money, or creates or deletes something online, say what it will do and what it costs, and wait for the person to say go'
rs_rule "the announcement before the server exists" 'before the server is created, tell the person'
rs_rule "a plain yes" 'ask for a plain yes\. any other answer means do not launch'
rs_rule "no guessed price" 'never guess a figure'
rs_guard "$SKILLS/launch-server/SKILL.md" "/launch-server"

rs_reset
rs_rule "the destroy is announced" 'the destroy deletes a server, a firewall and an ssh key at hetzner, and logs the machine out of the tailnet\. say so before it runs'
rs_guard "$SKILLS/retire-server/SKILL.md" "/retire-server"

rs_reset
rs_rule "nothing that writes" 'run the check script and nothing that writes'
rs_rule "a fix is suggested, not applied" 'report it and suggest the fix; do not apply it in this command'
rs_guard "$SKILLS/check-server/SKILL.md" "/check-server"
rs_done
