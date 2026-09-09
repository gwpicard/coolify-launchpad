#!/usr/bin/env sh
# validate.sh: the checks a machine can make on this repository's prose and
# shape. Each one exists because the written rule beside it has failed
# somewhere before, and a rule with no check is a rule that drifts.
#
# POSIX sh. Run from anywhere; it finds the repository from its own path.

set -u
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
fail=0
say() { printf '%s\n' "$*"; }
bad() { fail=1; say "FAIL: $*"; }

# Tracked and untracked-but-not-ignored files, so a fresh file is checked before
# it is committed.
files() { git ls-files -co --exclude-standard | grep -E "$1" || true; }

# The vendored humanizer discusses the patterns it removes, so it contains them
# on purpose. LICENSE is not ours to edit. This script holds the patterns it
# looks for, so it is exempt too.
PROSE=$(files '\.(md|yml|yaml|json|sh|mjs|ts)$' | grep -v '^\.agents/maintainer-skills/' | grep -v '^LICENSE$' | grep -v '^tools/validate\.sh$')

say "== No em or en dashes =="
hits=$(printf '%s\n' "$PROSE" | xargs grep -n -- '[—–]' 2>/dev/null || true)
[ -z "$hits" ] || bad "em or en dash found:
$hits"

say "== No banned words =="
# docs/maintaining.md is the one place the list itself lives, so it is exempt.
hits=$(printf '%s\n' "$PROSE" | grep -v '^docs/maintaining\.md$' \
  | xargs grep -n -i -w -E 'leverage|robust|comprehensive|seamless|crucial|foster|enhance|transformative|delve|navigate|empower|streamline|holistic' 2>/dev/null || true)
[ -z "$hits" ] || bad "banned word found:
$hits"

say "== No issue or pull request numbers in tracked files =="
# A number is a pointer the reader cannot follow, and once public it points at
# an unrelated issue in another repository's numbering. Say the thing instead.
hits=$(printf '%s\n' "$PROSE" | xargs grep -n -E '(^|[^A-Za-z0-9$}])#[0-9]{2,4}([^0-9]|$)' 2>/dev/null || true)
[ -z "$hits" ] || bad "issue or pull request cited by number:
$hits"

say "== Every local markdown link resolves =="
for f in $(files '\.md$'); do
  dir=$(dirname "$f")
  grep -o '](\([^)#]*\)' "$f" | sed 's/^](//' | grep -v '^[a-z]*:' | while read -r target; do
    [ -n "$target" ] || continue
    case "$target" in
      /*) p="$ROOT$target" ;;
      *)  p="$dir/$target" ;;
    esac
    [ -e "$p" ] || say "FAIL: $f links to $target, which does not exist"
  done
done | tee /tmp/validate-links.$$ >/dev/null
if grep -q FAIL /tmp/validate-links.$$; then cat /tmp/validate-links.$$; fail=1; fi
rm -f /tmp/validate-links.$$

say "== Written rules still hold =="
for t in tests/rules/*.sh; do
  [ -f "$t" ] || continue
  sh "$t" || bad "$t"
done

if [ "$fail" -ne 0 ]; then say "validate: FAILED"; exit 1; fi
say "validate: all checks passed"
