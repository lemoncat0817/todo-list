#!/usr/bin/env bash
usage() {
  cat <<'EOF'
Usage: scripts/verify-artifact-integrity.sh [--strict] [--change <NNNN>] [path ...]

Compares each approved spec.md, change.md, design.md, plan.md, and architecture.md with the
commit that its latest Approved row names in Version (policies/artifacts.md §5, §11).

  path               Directories or files, relative to the repository root (default: docs)
  --change <NNNN>    Check only docs/changes/<NNNN>-*; accepts an ID or a folder name
                     (--change 0004, --change=0004-export-orders); repeatable
  --strict           Also fail when an approved Version is not in this repository's history

Every artifact may change its header Status row, Change log, and Approval after approval.
A plan.md may also record execution: Status cells in the Task table, "- Status:" lines in
Task blocks, the Deviation log, and the Readiness checklist. A change.md (Quick track) may also
record Notes, Verification, the Trace table, and Convergence.

Exit codes: 0 no unapproved change · 1 unapproved change found · 2 usage error
EOF
}

set -euo pipefail

STRICT=0
PATHS=()
CHANGES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1 ;;
    --change)
      if [ $# -lt 2 ] || [ -z "$2" ]; then echo "Error: --change needs a change ID, e.g. --change 0004" >&2; exit 2; fi
      CHANGES+=("$2"); shift ;;
    --change=*)
      if [ -z "${1#--change=}" ]; then echo "Error: --change needs a change ID, e.g. --change=0004" >&2; exit 2; fi
      CHANGES+=("${1#--change=}") ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) PATHS+=("$1") ;;
  esac
  shift
done

if ! ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
  echo "Error: not inside a Git repository." >&2
  exit 2
fi
cd "$ROOT"

for change in ${CHANGES[@]+"${CHANGES[@]}"}; do
  case "$change" in
    */*|.*) echo "Error: --change takes a change ID or folder name, not a path: '$change'" >&2; exit 2 ;;
  esac
  matches=()
  for dir in docs/changes/"$change" docs/changes/"$change"-*; do
    [ -d "$dir" ] && matches+=("$dir")
  done
  if [ ${#matches[@]} -eq 0 ]; then
    echo "Error: no change folder matches '$change' (looked for docs/changes/$change and docs/changes/$change-*)." >&2
    exit 2
  fi
  if [ ${#matches[@]} -gt 1 ]; then
    echo "Error: '$change' matches more than one change folder: ${matches[*]}" >&2
    exit 2
  fi
  PATHS+=("${matches[0]}")
done
[ ${#PATHS[@]} -eq 0 ] && PATHS=(docs)

latest_approval() {
  awk -F'|' '
    /^## / { in_approval = ($0 ~ /^## +Approval *$/); next }
    in_approval && /^\|/ {
      outcome = $3; version = $6
      gsub(/^[ \t]+|[ \t]+$/, "", outcome)
      gsub(/[ \t`]/, "", version)
      if (outcome ~ /^Approved/) { gate = $2; gsub(/^[ \t]+|[ \t]+$/, "", gate); last = gate "\t" version }
    }
    END { if (last != "") print last }
  ' "$1"
}

# Transcribing an approval touches the Status row, Change log, and Approval; executing a plan records progress (workflows/implementation.md §3).
unapproved_lines() {
  awk -v kind="$4" '
    FILENAME == ARGV[1] || FILENAME == ARGV[2] {
      f = (FILENAME == ARGV[1]) ? 1 : 2
      if ($0 ~ /^## /) { sec[f] = $0; sub(/^## +/, "", sec[f]); sub(/[ \t]+$/, "", sec[f]) }
      section[f, FNR] = sec[f]
      next
    }
    /^@@ / {
      in_hunk = 1
      split($2, o, ","); split($3, n, ",")
      oline = substr(o[1], 2) + 0; nline = substr(n[1], 2) + 0
      next
    }
    !in_hunk { next }
    /^-/ { report(1, oline, $0); oline++; next }
    /^\+/ { report(2, nline, $0); nline++; next }
    function emit(side, line, s, text) {
      printf "    %s line %d [%s]: %s\n", (side == 1 ? "approved" : "current"), line, (s == "" ? "header" : s), text
    }
    function report(side, line, text,   s, body, key, n) {
      s = section[side, line]
      body = substr(text, 2)
      if (s == "Approval" || s == "Change log") return
      if (s == "" && body ~ /^\| *Status *\|/) return
      if (kind == "change" && (s == "Notes" || s == "Verification" || s == "Trace table" || s == "Convergence")) return
      if (kind == "plan") {
        if (s == "Deviation log" || s == "Readiness checklist") return
        if (s == "Task blocks" && body ~ /^[ \t]*- *Status:/) return
        if (s == "Task table" && body ~ /^\|/) {
          # A row may change only its last (Status) cell, so rows are paired at END by all other cells.
          key = body; sub(/\|[^|]*\|[ \t]*$/, "|", key); gsub(/[ \t]*\|[ \t]*/, "|", key)
          n = ++rows[side]; row_key[side, n] = key; row_line[side, n] = line; row_text[side, n] = text
          return
        }
      }
      emit(side, line, s, text)
    }
    END {
      for (i = 1; i <= rows[1]; i++) pool[row_key[1, i]]++
      for (i = 1; i <= rows[2]; i++) {
        k = row_key[2, i]
        if (pool[k] > 0) { pool[k]--; used[k]++ }
        else emit(2, row_line[2, i], "Task table", row_text[2, i])
      }
      for (i = 1; i <= rows[1]; i++) {
        k = row_key[1, i]
        if (used[k] > 0) used[k]--
        else emit(1, row_line[1, i], "Task table", row_text[1, i])
      }
    }
  ' "$1" "$2" "$3"
}

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t 'artifact-integrity')
trap 'rm -rf "$TMP"' EXIT

checked=0 changed=0 unverifiable=0
while IFS= read -r file; do
  approval=$(latest_approval "$file")
  [ -z "$approval" ] && continue
  gate=${approval%%$'\t'*}
  version=${approval#*$'\t'}
  checked=$((checked + 1))

  if ! printf '%s' "$version" | grep -Eq '^[0-9a-f]{7,40}$'; then
    echo "FAIL     $file — $gate Approved row has no commit SHA in Version ('$version')"
    changed=$((changed + 1))
    continue
  fi
  if ! commit=$(git rev-parse -q --verify "${version}^{commit}" 2>/dev/null) \
      || ! git cat-file -e "${commit}:${file}" 2>/dev/null; then
    echo "UNKNOWN  $file — $gate Version $version is not in this repository's history at this path"
    unverifiable=$((unverifiable + 1))
    continue
  fi

  git show "${commit}:${file}" > "$TMP/old"
  git diff --no-color --no-ext-diff -U0 "$commit" -- "$file" > "$TMP/diff"
  kind=other
  case "$file" in plan.md|*/plan.md) kind=plan ;; change.md|*/change.md) kind=change ;; esac
  findings=$(unapproved_lines "$TMP/old" "$file" "$TMP/diff" "$kind")
  if [ -n "$findings" ]; then
    echo "FAIL     $file — changed since $gate approval at $version without a new approval:"
    printf '%s\n' "$findings" | head -n 20
    total=$(printf '%s\n' "$findings" | wc -l)
    [ "$total" -gt 20 ] && echo "    … $((total - 20)) more changed lines"
    changed=$((changed + 1))
  else
    echo "OK       $file — matches $gate approval at $version"
  fi
done < <(git ls-files -- "${PATHS[@]}" | grep -E '(^|/)(spec|change|design|plan|architecture)\.md$' || true)

echo
echo "Checked $checked approved artifact(s): $changed failing, $unverifiable unverifiable."
if [ "$changed" -gt 0 ]; then
  echo "A material change returns the artifact to Proposed and its gate (policies/artifacts.md §5.4); a re-approval adds a new Approved row with the reviewed commit."
  exit 1
fi
if [ "$unverifiable" -gt 0 ] && [ "$STRICT" -eq 1 ]; then
  echo "--strict: an approved Version must be a commit in this repository."
  exit 1
fi
exit 0
