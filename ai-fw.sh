#!/usr/bin/env bash
# AI Engineering Framework — install, upgrade, and check a project.
#
# Usage:
#   ai-fw.sh init    [--ref <tag|branch>] [--source <dir>] [--ai claude|cursor]... [options]
#   ai-fw.sh upgrade [--ref <tag|branch>] [--source <dir>] [options]
#   ai-fw.sh doctor  [--offline]
#
# Options for init and upgrade:
#   --dry-run                 show every file to add, update, or delete, and the CHANGELOG; write nothing
#   --force                   overwrite or delete managed files that were edited locally
#   --no-commit               leave the result uncommitted (default: one commit on a new branch)
#   --notes <file>            also write the CHANGELOG entries since the installed version to <file>
#   --with-claude-agents      also install the eight Claude Code subagents
#   --with-upgrade-workflow   also add the one-click upgrade GitHub Action
#   --with-ai-review          also add the AI pull-request review (sends diffs to external model APIs)
#
# Without --ref or --source, the latest release tag (vX.Y.Z) is used; --ref master gives unreleased work.
# Install into an existing project without a checkout:
#   curl -fsSL https://raw.githubusercontent.com/lemoncat0817/ai-engineering-framework/master/ai-fw.sh | bash -s -- init --ai claude

set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-git@github.com:lemoncat0817/ai-engineering-framework.git}"
UPSTREAM_HTTPS="https://github.com/lemoncat0817/ai-engineering-framework.git"

usage() { sed -n '3,21p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//' || echo "Usage: ai-fw.sh init|upgrade|doctor [options]"; }

latest_release_tag() {
  git ls-remote --tags --refs "$1" 'v*' 2>/dev/null | sed 's#.*refs/tags/##' \
    | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 | grep .
}

[ $# -ge 1 ] || { usage >&2; exit 2; }
COMMAND="$1"; shift
case "${COMMAND}" in
  init|upgrade|doctor) ;;
  -h|--help|help) usage; exit 0 ;;
  *) echo "Unknown command: ${COMMAND}" >&2; usage >&2; exit 2 ;;
esac

REF=""
SOURCE_DIR=""
OFFLINE=0
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || { echo "Error: --ref needs a value" >&2; exit 2; }; REF="$2"; shift ;;
    --ref=*) REF="${1#--ref=}" ;;
    --source) [ $# -ge 2 ] || { echo "Error: --source needs a directory" >&2; exit 2; }; SOURCE_DIR="$2"; shift ;;
    --source=*) SOURCE_DIR="${1#--source=}" ;;
    --offline) OFFLINE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) PASS+=("$1") ;;
  esac
  shift
done

command -v python3 >/dev/null || { echo "Error: python3 (3.8 or later) is required." >&2; exit 2; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Error: run this inside the project's Git repository." >&2; exit 2; }

if [ "${COMMAND}" = "doctor" ]; then
  [ -f "${ROOT}/scripts/ai_fw.py" ] || { echo "The framework is not installed here (no scripts/ai_fw.py); run ai-fw.sh init." >&2; exit 1; }
  LATEST=""
  [ "${OFFLINE}" -eq 1 ] || LATEST=$(latest_release_tag "${UPSTREAM_HTTPS}" || true)
  exec python3 -I "${ROOT}/scripts/ai_fw.py" doctor --root "${ROOT}" ${LATEST:+--latest "${LATEST}"}
fi

if [ -n "${SOURCE_DIR}" ]; then
  UPSTREAM=$(cd "${SOURCE_DIR}" && pwd)
  echo "Using local framework checkout: ${UPSTREAM}"
else
  if [ -z "${REF}" ]; then
    REF=$(latest_release_tag "${UPSTREAM_URL}" || latest_release_tag "${UPSTREAM_HTTPS}" || true)
    [ -n "${REF}" ] || { echo "Error: no release tag found upstream; name one with --ref, or --ref master." >&2; exit 1; }
  fi
  UPSTREAM=$(mktemp -d 2>/dev/null || mktemp -d -t 'ai-fw')
  trap 'rm -rf "${UPSTREAM}"' EXIT
  echo "Fetching framework ${REF}..."
  git clone --quiet --depth 1 --branch "${REF}" "${UPSTREAM_URL}" "${UPSTREAM}" 2>/dev/null \
    || git clone --quiet --depth 1 --branch "${REF}" "${UPSTREAM_HTTPS}" "${UPSTREAM}" 2>/dev/null \
    || { echo "Error: could not clone ${REF} from lemoncat0817/ai-engineering-framework." >&2; exit 1; }
fi

[ -f "${UPSTREAM}/scripts/ai_fw.py" ] || { echo "Error: ${UPSTREAM} predates ai-fw.sh (no scripts/ai_fw.py); use its upgrade.sh." >&2; exit 1; }
python3 -I "${UPSTREAM}/scripts/ai_fw.py" "${COMMAND}" --upstream "${UPSTREAM}" --root "${ROOT}" ${REF:+--ref "${REF}"} ${PASS[@]+"${PASS[@]}"}
