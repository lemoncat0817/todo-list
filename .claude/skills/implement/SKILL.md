---
name: implement
description: Run or resume the implementation workflow of the AI Engineering Framework for a change.
argument-hint: "<change, for example 0007>"
disable-model-invocation: true
---

Run or resume the implementation workflow for the change below.

1. `AGENTS.md` is in your context. Read `.ai/workflows/implementation.md`; a change folder with `change.md` resumes `.ai/workflows/quick.md` §7 instead.
2. Run every stage yourself, in its role (`AGENTS.md` §3). Use a subagent only for independent tasks run in parallel after `RC-CONTRACT`, and for the independent AI pre-review of a C3 or C4 change. Stop at every Human Gate with a one-line reply example; record the human's reply with `scripts/approve.py`. Keep to the time budget: report instead of waiting.

Change: $ARGUMENTS
