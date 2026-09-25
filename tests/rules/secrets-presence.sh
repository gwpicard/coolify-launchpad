#!/usr/bin/env sh
# Every skill still says to check that a secret is present and never to read
# it, and names the commands that once wrote a live token into a transcript.
# The script behind each command already reports key names only; this guards
# the other half, which is what the agent may run by itself.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
SKILLS="$(dirname -- "$0")/../../skills"

rs_init "Secrets are checked for presence, not read"
for s in launch-server check-server retire-server; do
  rs_reset
  rs_rule "presence, not value" 'check that a secret is present; never read its value'
  rs_rule "the commands that print a value" 'do not run `env \| grep`, do not `cat` an env file, do not `echo` a variable'
  rs_rule "no file-reading tool on the env file" 'do not open `\.env\.<name>` with a file-reading tool'
  rs_guard "$SKILLS/$s/SKILL.md" "/$s"
done
rs_done
