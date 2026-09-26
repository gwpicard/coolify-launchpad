#!/usr/bin/env sh
# The admin-account ask comes a few minutes into a launch, and a person who has
# looked away misses it and pays a 20-minute wait and a resume. The launch can
# only print the ask; raising it where the person will see it is the agent's
# job, so the rule lives in the skill.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
SKILLS="$(dirname -- "$0")/../../skills"

rs_init "The admin-account ask is hard to miss"
rs_rule "a desktop notification where the harness has one" 'if this harness gives you a tool that sends a desktop or push notification, send one'
rs_rule "the chat message as well" 'tell them in the chat as well, at once'
rs_guard "$SKILLS/launch-server/SKILL.md" "/launch-server"
rs_done
