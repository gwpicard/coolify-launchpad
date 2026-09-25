#!/usr/bin/env sh
# Every description still ends with the closing sentence. It is the only text a
# client reads before deciding whether to start a skill by itself, so it stays,
# and it stays last, because the adapter builder takes the first sentence as the
# short help and a guard sentence at the front would become the help text.

. "$(dirname -- "$0")/../lib/rule-shape.sh"
SKILLS="$(dirname -- "$0")/../../skills"
CLOSING="Type this command when you want it; it never starts on its own."

rs_init "The closing sentence is still last"

# 0 when the description ends with the closing sentence, which appears once,
# and the first sentence is something else.
closing_ok() {
  case "$1" in *"$CLOSING") ;; *) return 1 ;; esac
  [ "$(printf '%s' "$1" | grep -o "never starts on its own" | wc -l | tr -d ' ')" = 1 ] || return 1
  first=$(printf '%s' "$1" | sed 's/\([^.]*\.\).*/\1/')
  [ "$first" != "Type this command when you want it; it never starts on its own." ]
}

for s in launch-server check-server retire-server; do
  desc=$(sed -n 's/^description: //p' "$SKILLS/$s/SKILL.md")
  if closing_ok "$desc"; then rs_ok "/$s ends with the closing sentence"; else rs_fail "/$s does not end with the closing sentence"; fi

  body=${desc%" $CLOSING"}
  if closing_ok "$body"; then rs_fail "/$s: removing the closing sentence was not caught"; fi
  rs_ok "/$s: removing it is caught"

  if closing_ok "$CLOSING $body"; then rs_fail "/$s: moving the closing sentence to the front was not caught"; fi
  rs_ok "/$s: moving it to the front is caught"

  if closing_ok "$desc More text after it."; then rs_fail "/$s: text after the closing sentence was not caught"; fi
  rs_ok "/$s: text after it is caught"
done
rs_done
