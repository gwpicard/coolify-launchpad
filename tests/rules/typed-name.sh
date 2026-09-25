#!/usr/bin/env sh
# /retire-server still requires the person to type the server name. The script
# accepts the typed name through --confirm, so the only thing between an agent
# and a destroyed server is this written rule: the reply to the warning is the
# confirmation, and the agent passes it on unchanged and never supplies it.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
FILE="$(dirname -- "$0")/../../skills/retire-server/SKILL.md"

rs_init "/retire-server requires the typed name"
rs_rule "nothing goes before the typed name" 'nothing is destroyed until the person types the server name in reply to the warning'
rs_rule "the argument and a yes do not count" 'the name typed after the command does not count, and neither does "yes"'
rs_rule "never typed for them" 'never type the name for them'
rs_rule "passed on exactly" 'pass their reply to the script exactly as they wrote it'
rs_rule "never --confirm without their reply" 'never pass `--confirm` with a name the person did not type in reply to the warning'
rs_rule "a first run that destroys nothing" 'this run destroys nothing'
rs_guard "$FILE" "/retire-server"

# The leading dash sits in a bracket so grep does not read the pattern as an option.
rs_require_absent "the destroy command is never shown with the name filled in" "$FILE" "[-]-confirm '?<name>"
rs_require "the destroy command carries the person's reply" "$FILE" "[-]-confirm '<their reply>'"
rs_done
