#!/usr/bin/env sh
# The admin-account ask comes a few minutes into a launch, and a person who has
# looked away misses it and pays a 20-minute wait and a resume. The launch can
# only print the ask; raising it where the person will see it is the agent's
# job, so the rule lives in the skill. A notification alone once failed to
# catch the person, and Coolify's limit on register submits once locked the
# form, so the repeat and the one careful submit are guarded too.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
SKILLS="$(dirname -- "$0")/../../skills"

rs_init "The admin-account ask is hard to miss"
rs_rule "a desktop notification where the harness has one" 'if this harness gives you a tool that sends a desktop or push notification, send one'
rs_rule "the chat message as well" 'tell them in the chat as well, at once'
rs_rule "the ask repeated when the person returns" 'when the person next writes anything while the step is still waiting, repeat the ask'
rs_rule "one submit, and the wait after a 429" 'submit the form once.*three register submits from one address in ten minutes.*http 429, wait ten minutes'
rs_guard "$SKILLS/launch-server/SKILL.md" "/launch-server"
rs_done
