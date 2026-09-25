#!/usr/bin/env sh
# /launch-server still stops at the server block and names no step that belongs
# to coolify-devops. The launchpad decides that a server exists and how it is
# reached, never what runs on it; a skill that started describing the tailnet
# plumbing or the acceptance test would soon start doing them.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
DIR="$(dirname -- "$0")/../../skills/launch-server"

rs_init "/launch-server stops at the block"
rs_rule "the launch stops at the block" 'the launch stops at the server block\. everything after it belongs to `/setup-coolify-devops` on the server'
rs_rule "nothing after it is started" 'do not start any of that work'
rs_guard "$DIR/SKILL.md" "/launch-server"

rs_reset
rs_rule "no to-do is done from here" 'do not offer to do any of it from here'
rs_rule "the launch is over" 'then stop\. the launch is over'
rs_guard "$DIR/references/server-block.md" "the server block reference"

# The words that name coolify-devops's own steps. None may appear in the skill
# or its references.
AFTER='registrar|canary|docktail|dns pinner'
names_after() {
  grep -l -i -E "$AFTER" "$@" 2>/dev/null
}
FILES="$DIR/SKILL.md $DIR/references/interview.md $DIR/references/preflight.md $DIR/references/server-block.md"
rs_exists $FILES
# shellcheck disable=SC2086
found=$(names_after $FILES)
[ -z "$found" ] || rs_fail "a step after the block is named in: $found"
rs_ok "no step after the block is named"

copy="$rs_dir/with-a-later-step.md"
cp "$DIR/SKILL.md" "$copy"
printf '\n## 7. Deploy the registrar and the canary\n' >> "$copy"
[ -n "$(names_after "$copy")" ] || rs_fail "a later step added to a copy was not caught"
rs_ok "a later step added to a copy is caught"
rs_done
