---
name: bug-fix
description: Start the bug-fix workflow of the AI Engineering Framework.
argument-hint: "<defect report>"
disable-model-invocation: true
---

Run the bug-fix workflow for the defect report below.

1. `AGENTS.md` is in your context. Read `.ai/workflows/bug-fix.md` and `.ai/workflows/implementation.md` §7.
2. Triage first. A defect that fits `.ai/workflows/quick.md` §2 runs the Quick track; its opening message carries the triage.
3. Run every stage yourself, in its role (`AGENTS.md` §3). Use a subagent only for independent tasks run in parallel after `RC-CONTRACT`, and for the independent AI pre-review of a C3 or C4 change. Stop at every Human Gate with a one-line reply example; record the human's reply with `scripts/approve.py`. Keep to the time budget: report instead of waiting.

Defect report: $ARGUMENTS
