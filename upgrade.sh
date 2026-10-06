#!/usr/bin/env bash
# AI Engineering Framework — upgrade (kept for existing habits and workflows; ai-fw.sh is the entry point).
#
# Usage:
#   ./upgrade.sh [--source <dir>] [--no-commit] [--with-claude] [--notes <file>] [--dry-run] [--force] [ref]
#
# Same as: ./ai-fw.sh upgrade [--ref <ref>] ... — see ./ai-fw.sh --help.

set -euo pipefail

ARGS=()
SOURCE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) [ $# -ge 2 ] || { echo "Error: --source needs a directory" >&2; exit 2; }; SOURCE_DIR="$2"; ARGS+=(--source "$2"); shift ;;
    --source=*) SOURCE_DIR="${1#--source=}"; ARGS+=(--source "${SOURCE_DIR}") ;;
    --with-claude) ARGS+=(--ai claude) ;;
    --notes) [ $# -ge 2 ] || { echo "Error: --notes needs a file" >&2; exit 2; }; ARGS+=(--notes "$2"); shift ;;
    -h|--help) sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) ARGS+=("$1") ;;
    *) ARGS+=(--ref "$1") ;;
  esac
  shift
done

HERE=$(cd "$(dirname "$0")" && pwd)
if [ -n "${SOURCE_DIR}" ] && [ -f "${SOURCE_DIR}/ai-fw.sh" ]; then
  exec bash "${SOURCE_DIR}/ai-fw.sh" upgrade ${ARGS[@]+"${ARGS[@]}"}
elif [ -f "${HERE}/ai-fw.sh" ]; then
  exec bash "${HERE}/ai-fw.sh" upgrade ${ARGS[@]+"${ARGS[@]}"}
fi

# A project upgraded by an older upgrade.sh has this file but not ai-fw.sh yet: fetch it once.
TMP=$(mktemp -d 2>/dev/null || mktemp -d -t 'ai-fw')
trap 'rm -rf "${TMP}"' EXIT
curl -fsSL https://raw.githubusercontent.com/lemoncat0817/ai-engineering-framework/master/ai-fw.sh -o "${TMP}/ai-fw.sh" \
  || { echo "Error: could not download ai-fw.sh from lemoncat0817/ai-engineering-framework." >&2; exit 1; }
bash "${TMP}/ai-fw.sh" upgrade ${ARGS[@]+"${ARGS[@]}"}
