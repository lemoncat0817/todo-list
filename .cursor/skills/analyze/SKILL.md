---
name: analyze
description: Run the AI Engineering Framework consistency check on a change's draft plan, before G4 or the task loop.
disable-model-invocation: true
---

Run the consistency check for the change below with the local script. Do not repeat the checks by reading the artifacts: the script parses them in under a second.

1. Read `.ai/workflows/implementation.md` §4.5 only (`AGENTS.md` is already in your context). This session acts in the Tech Lead Agent role.
2. Run `python3 scripts/analyze.py <change> --write`, where `<change>` is an ID such as `0007` or a folder name under `docs/changes/`. It writes the *Consistency check* section of a `Draft` `plan.md` and nothing else.
   - Exit 2: report the script's message and stop. A plan that is not `Draft` changes only through `.ai/policies/artifacts.md` §5.4. If `scripts/analyze.py` or `python3` is missing, say so and point to `./ai-fw.sh doctor` or `.ai/policies/artifacts.md` §13; do not run the checks by hand.
   - Exit 0 or 1: the section is written; 1 means at least one open blocking finding.
3. Report the script's table to the operator, blocking findings first, each with the owner it returns to: a spec finding to the PM Agent, a design or contract finding to the Architect Agent, a plan finding to the Tech Lead Agent.
4. Stop. Fixing an artifact is its owner's work, and only a human closes a finding by decision. A finding the script cannot decide (§4.5, last paragraph) is added only if you already hold its evidence; do not search for one.

Change: the change ID entered with this command.
