# Workflow: new-project — Adopt

## 1. Scope

The Adopt mode of `.ai/workflows/new-project.md` (`AGENTS.md` §3), for a repository that already has code (`scripts/adopt.py --check` exits 0). `AGENTS.md`, `.ai/policies/`, and `.ai/gates/` take precedence over this file.

## 2. Steps

The framework joins a repository that already has code: no walking skeleton and no first spec. Later work runs `/quick`, `/new-feature`, or `/bug-fix`.

1. **Scan.** `python3 scripts/adopt.py` prints the applications with their technology and versions, the candidate verification commands, CI, containers, databases, and the layout.
2. **Verify.** Run each candidate command once, non-interactively under `timeout`. A command that passes goes into *Verification commands*; one that fails or cannot run becomes `TODO(Technical Owner): <command> — <reason>`, never a guess.
3. **Draft `docs/project.md`** from the scan: identity, layout, stack with the matching profiles, verification commands, main branch, framework version from `.ai/VERSION`. Owners default to the operator holding every role, marked `(proposed)`; the business context summary is the operator's own words or `TODO(Product Owner)`, never invented. Environments that the repository does not show are `TODO`.
4. **One stop: G1.** One message: the drafted profile, which commands passed and which are `TODO`, and `Reply "OK" to approve docs/project.md, or name what to change.` The adoption is a change of its own: `python3 scripts/new-change.py adopt-framework --type chore --artifact none` before the first commit. Record the reply with `python3 scripts/approve.py - docs/project.md G1 --by "<Technical Owner>"`, commit with `Refs: NNNN`, and open the pull request; it passes G5 like any change.

Capability views are not seeded from existing code; each change creates the view of a capability when it first touches it (`.ai/policies/artifacts.md` §12).
