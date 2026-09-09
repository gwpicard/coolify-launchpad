#!/usr/bin/env sh
# build-adapters.sh: regenerate the Claude Code command files from the canonical
# skills in skills/. Run it after changing a skill's description, or adding or
# removing a skill. The output is committed so a fresh clone works straight away.
#
# Single source of truth: skills/<name>/SKILL.md
# Generated:              .claude/commands/<name>.md
#
# The canonical file carries the Agent Skills frontmatter the reference
# validator accepts. The trigger rule lives here, in the generated file: every
# skill in this repository is a command a person types, so every adapter
# carries `disable-model-invocation: true`. A skill only the maintainers use
# lives under .agents/maintainer-skills/ and gets no adapter, so a skills
# installer never offers it to anyone.
#
# Usage:
#   build-adapters.sh          regenerate in place.
#   build-adapters.sh --check  generate into a scratch directory and diff against
#                              what is committed. Exits non-zero on drift.
#
# POSIX sh, no dependencies beyond awk/sed/grep/find/sort/diff.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILLS="$ROOT/skills"
# The inventory is written out rather than counted, so a renamed or forgotten
# skill is named in the error instead of hiding behind a matching count.
EXPECTED="check-server launch-server retire-server"
CLOSING="Type this command when you want it; it never starts on its own."

CHECK=0
case "${1:-}" in
  --check) CHECK=1 ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

[ -d "$SKILLS" ] || { echo "error: $SKILLS not found" >&2; exit 1; }

# Read one frontmatter field from a SKILL.md file, folding a block scalar onto
# one line.
field() {
  awk -v k="$1" '
    /^---[ \t]*$/ { fm++; next }
    fm==1 {
      if (block) {
        if ($0 ~ /^[ \t]+/) { sub(/^[ \t]+/, ""); printf "%s%s", separator, $0; separator=" "; next }
        print ""; exit
      }
      if ($0 ~ "^" k ":[ \t]") {
        sub("^" k ":[ \t]*", "")
        if ($0 == "|" || $0 == ">") { block=1; next }
        print; exit
      }
    }
    END { if (block) print "" }
  ' "$2"
}

generate_all() {
  OUT="$1"
  rm -rf "$OUT/.claude/commands"
  mkdir -p "$OUT/.claude/commands"

  found=""
  for dir in $(find "$SKILLS" -mindepth 1 -maxdepth 1 -type d | sort); do
    name=$(basename "$dir")
    file="$dir/SKILL.md"
    [ -f "$file" ] || continue
    found="$found $name"

    fm_name=$(field name "$file")
    desc=$(field description "$file")
    [ -n "$desc" ] || { echo "error: $name/SKILL.md has no description" >&2; exit 1; }
    [ "$fm_name" = "$name" ] || { echo "error: $name/SKILL.md declares name '$fm_name', which does not match its folder" >&2; exit 1; }

    # The closing sentence is the only text a client reads before deciding
    # whether to start a skill by itself, so it stays, and it stays last: the
    # short help below is the first sentence only.
    case "$desc" in
      *"$CLOSING") ;;
      *) echo "error: $name/SKILL.md description must end with: $CLOSING" >&2; exit 1 ;;
    esac
    if grep -q '^disable-model-invocation:' "$file" || grep -q '^user-invocable:' "$file"; then
      echo "error: $name/SKILL.md carries a trigger field; those belong only in the generated adapter" >&2
      exit 1
    fi

    short=$(printf '%s' "$desc" | sed 's/\([^.]*\.\).*/\1/')
    {
      printf '%s\n' "---"
      printf 'description: %s\n' "$short"
      printf 'disable-model-invocation: true\n'
      printf '%s\n' "---"
      printf '<!-- GENERATED from skills/%s/. Do not edit here; regenerate with tools/build-adapters.sh -->\n\n' "$name"
      printf 'Load and follow `skills/%s/SKILL.md`. It is the single source of truth for the `/%s` command. Treat anything typed after the command as the user'"'"'s request and pass it through unchanged.\n' "$name" "$name"
    } > "$OUT/.claude/commands/$name.md"
  done

  found=$(printf '%s' "$found" | sed 's/^ //')
  if [ "$found" != "$EXPECTED" ]; then
    echo "error: skills/ holds [$found]; expected [$EXPECTED]. Update EXPECTED in $0 when the inventory changes on purpose." >&2
    exit 1
  fi
}

if [ "$CHECK" -eq 1 ]; then
  SCRATCH=$(mktemp -d)
  trap 'rm -rf "$SCRATCH"' EXIT
  generate_all "$SCRATCH"
  if ! diff -rq "$ROOT/.claude/commands" "$SCRATCH/.claude/commands"; then
    echo "error: committed adapters do not match what skills/ generates. Run tools/build-adapters.sh and commit the result." >&2
    exit 1
  fi
  echo "adapters match: no drift"
  exit 0
fi

generate_all "$ROOT"
echo "Regenerated .claude/commands/ for: $EXPECTED"
