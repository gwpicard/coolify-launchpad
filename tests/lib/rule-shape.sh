#!/usr/bin/env sh
# rule-shape.sh: shared scaffolding for the checks that guard a written rule.
#
# Several rules in this kit live as prose a coding agent reads. A machine cannot
# watch the conversation those rules produce without paying a model, so each one
# is guarded by reading its source: the rule is still there, and the check fails
# on a copy with the rule removed. That second half is the point. A check that
# cannot fail proves nothing.
#
# Every such check was written by copying the last one, about sixty lines at a
# time, and the copying went wrong twice in the same way: the assertion matched
# without regard to case while the mutation removed text with regard to it, so a
# rule written with a capital letter was never actually removed and its control
# could never fail. Folding to lower case here closes that for every caller at
# once.
#
# Use it like this:
#
#   . "$(dirname -- "$0")/lib/rule-shape.sh"
#
#   rs_init "Coverage-read checks"
#   rs_rule "counts pieces open and closed" 'open and closed'
#   rs_rule "the covered line" 'has a piece that builds it'
#   rs_guard "$READFILE" "the shipped coverage-read.md"
#   rs_require "/setup runs it" "$SETUP" 'references/coverage-read\.md'
#   rs_done
#
# Patterns are extended regular expressions, matched against the file folded
# onto one line and lowered, so write them in lower case and let ordinary
# rewrapping pass. rs_guard removes each pattern in turn and requires the whole
# rule set to fail without it.

# --- state ----------------------------------------------------------------

rs_pass=0
rs_dir=""

rs_init() {
  # rs_init <title>
  rs_dir=$(mktemp -d)
  # A caller that needs its own cleanup can set a trap after calling this one.
  trap 'rm -rf "$rs_dir"' EXIT
  : > "$rs_dir/rules"
  echo "$1:"
}

rs_fail() {
  echo "FAIL: $1" >&2
  exit 1
}

rs_ok() {
  echo "  ok: $1"
  rs_pass=$((rs_pass + 1))
}

rs_report() {
  # rs_report <description> <yes|no>: for an assertion a caller works out itself.
  if [ "$2" = yes ]; then
    rs_ok "$1"
  else
    rs_fail "$1"
  fi
}

# --- reading --------------------------------------------------------------

rs_fold() {
  # rs_fold <file>: the file on one line, lowered, spaces squeezed.
  tr '\n' ' ' < "$1" | tr -s ' ' | tr '[:upper:]' '[:lower:]'
}

rs_exists() {
  # rs_exists <file>...: stop early with a clear message rather than a grep error.
  for rs_f in "$@"; do
    [ -f "$rs_f" ] || rs_fail "missing file $rs_f"
  done
}

# --- the rule set ---------------------------------------------------------

rs_rule() {
  # rs_rule <description> <pattern>
  printf '%s\t%s\n' "$1" "$2" >> "$rs_dir/rules"
}

rs_reset() {
  # rs_reset: start a fresh rule set, for a check that guards a second file.
  # Without it the rules already asserted are demanded of the next file too.
  : > "$rs_dir/rules"
}

# rs_check <folded-file>: 0 when every rule is present, 1 otherwise. Names what
# is missing on the way out, so a real failure says which rule went.
# Its own variable names, because the caller loops over the same rules while
# calling this, and a shared name would come back empty on the second pass.
rs_check() {
  rs_ok_flag=0
  while IFS="$(printf '\t')" read -r rs_cdesc rs_cpattern; do
    [ -n "$rs_cpattern" ] || continue
    if ! grep -qE "$rs_cpattern" "$1"; then
      echo "  missing rule: $rs_cdesc"
      rs_ok_flag=1
    fi
  done < "$rs_dir/rules"
  return $rs_ok_flag
}

rs_guard() {
  # rs_guard <file> <what-it-is>: assert every rule, then prove each one is
  # load-bearing by removing it and requiring the check to fail.
  #
  # With RS_LIST set, say what would be asserted and assert nothing. The
  # mutation audit reads that to find a real rule in a real file to delete, so
  # it never has to keep its own copy of a sentence that lives somewhere else
  #.
  if [ -n "${RS_LIST:-}" ]; then
    while IFS="$(printf '\t')" read -r rs_ldesc rs_lpattern; do
      [ -n "$rs_lpattern" ] || continue
      printf '%s\t%s\t%s\n' "$1" "$rs_lpattern" "$rs_ldesc"
    done < "$rs_dir/rules"
    return 0
  fi

  rs_exists "$1"
  rs_fold "$1" > "$rs_dir/subject"

  if rs_check "$rs_dir/subject" >/dev/null; then
    rs_ok "$2 carries every rule"
  else
    rs_check "$rs_dir/subject"
    rs_fail "$2 is missing a rule"
  fi

  # One occurrence, not every occurrence. The subject is folded to a single
  # line, so a substitution without g removes only the first match, which is
  # what a careless edit does. Removing every copy is a weaker test: a rule
  # whose phrase also appears in a template or an example would pass it while a
  # real deletion sailed through, and two rules did exactly that. A rule
  # that fails here needs a pattern unique to the sentence stating it, and is
  # usually a rule stated in the wrong place. Do not put the g back.
  while IFS="$(printf '\t')" read -r rs_desc rs_pattern; do
    [ -n "$rs_pattern" ] || continue
    sed -E "s@$rs_pattern@@" "$rs_dir/subject" > "$rs_dir/mutant"
    if rs_check "$rs_dir/mutant" >/dev/null; then
      rs_fail "removing one copy of '$rs_desc' was not caught, so the phrase appears more than once and the rule is not guarded"
    fi
    rs_ok "removing '$rs_desc' is caught"
  done < "$rs_dir/rules"
}

# --- assertions in other files -------------------------------------------

rs_require() {
  # rs_require <description> <file> <pattern>
  [ -z "${RS_LIST:-}" ] || return 0
  rs_exists "$2"
  rs_fold "$2" > "$rs_dir/other"
  if grep -qE "$3" "$rs_dir/other"; then
    rs_ok "$1"
  else
    rs_fail "$1"
  fi
}

rs_require_absent() {
  # rs_require_absent <description> <file> <pattern>
  [ -z "${RS_LIST:-}" ] || return 0
  rs_exists "$2"
  rs_fold "$2" > "$rs_dir/other"
  if grep -qE "$3" "$rs_dir/other"; then
    rs_fail "$1"
  else
    rs_ok "$1"
  fi
}

rs_require_load_bearing() {
  # rs_require_load_bearing <description> <file> <pattern>: assert it, then show
  # the assertion notices when it goes. For the lines whose absence would be
  # silent, such as a refusal or an unattended-run rule.
  [ -z "${RS_LIST:-}" ] || return 0
  rs_require "$1" "$2" "$3"
  sed -E "s@$3@@g" "$rs_dir/other" > "$rs_dir/other-mutant"
  if grep -qE "$3" "$rs_dir/other-mutant"; then
    rs_fail "dropping '$1' would not be caught"
  fi
  rs_ok "dropping it is caught"
}

rs_require_twice() {
  # rs_require_twice <description> <file> <fixed-text>: the house rule is that a
  # behaviour is told in three places or it is not finished; the skill carries
  # one and WORKFLOW.md carries the other two. Counts matching lines, then
  # proves the count notices when every mention but the first is taken away, so
  # the control holds however many mentions the file grows later.
  [ -z "${RS_LIST:-}" ] || return 0
  rs_exists "$2"
  rs_told=$(grep -c "$3" "$2" || true)
  if [ "$rs_told" -ge 2 ]; then
    rs_ok "$1"
  else
    rs_fail "$1"
  fi
  awk -v needle="$3" '''
    { if (index($0, needle)) { if (seen) gsub(needle, ""); seen = 1 } print }
  ''' "$2" > "$rs_dir/told"
  rs_told=$(grep -c "$3" "$rs_dir/told" || true)
  if [ "$rs_told" -lt 2 ]; then
    rs_ok "leaving only one explanation is caught"
  else
    rs_fail "leaving only one explanation was not caught"
  fi
}

rs_require_order() {
  # rs_require_order <description> <file> <first-pattern> <second-pattern>: for a
  # rule whose position is the point, such as a warning that must be written
  # before the step that routes the work.
  [ -z "${RS_LIST:-}" ] || return 0
  rs_exists "$2"
  rs_first=$(grep -n -E "$3" "$2" | head -1 | cut -d: -f1)
  rs_second=$(grep -n -E "$4" "$2" | head -1 | cut -d: -f1)
  if [ -n "$rs_first" ] && [ -n "$rs_second" ] && [ "$rs_first" -lt "$rs_second" ]; then
    rs_ok "$1"
  else
    rs_fail "$1"
  fi
}

# --- finishing ------------------------------------------------------------

rs_done() {
  [ -z "${RS_LIST:-}" ] || return 0
  echo
  echo "$(basename -- "$0"): all $rs_pass checks passed"
}
