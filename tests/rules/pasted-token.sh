#!/usr/bin/env sh
# /launch-server still refuses a pasted token. The person writes every secret
# into .env.<name> in their own editor; a value pasted into the conversation is
# already in the transcript, so the skill must not use it and must say to
# replace it.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
DIR="$(dirname -- "$0")/../../skills/launch-server"

rs_init "/launch-server refuses a pasted token"
rs_rule "the person writes each secret" 'the person writes each secret into `\.env\.<name>` in their own editor'
rs_rule "never asks for a paste" 'never ask them to paste one here'
rs_rule "a pasted value is not used" 'if the person pastes a token, key or passphrase into this conversation anyway, do not use it, repeat it, or write it anywhere'
rs_rule "a pasted value is replaced" 'revoke it where they made it, make a new one'
rs_guard "$DIR/SKILL.md" "/launch-server"

rs_reset
rs_rule "the values are typed by the person" 'the values themselves are always typed by the person'
rs_rule "the agent never sees a value" 'you check that it is present\. you never see it'
rs_guard "$DIR/references/preflight.md" "the preflight reference"
rs_done
