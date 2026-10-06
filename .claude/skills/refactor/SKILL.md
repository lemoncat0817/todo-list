---
name: refactor
description: Start the refactor workflow of the AI Engineering Framework.
argument-hint: "<structural improvement>"
disable-model-invocation: true
---

Run the refactor workflow for the request below.

1. `AGENTS.md` is in your context. Read `.ai/workflows/refactor.md` and `.ai/workflows/implementation.md` §7.
2. Run every stage yourself, in its role (`AGENTS.md` §3). Use a subagent only for independent tasks run in parallel after `RC-CONTRACT`, and for the independent AI pre-review of a C3 or C4 change. Stop at every Human Gate with a one-line reply example; record the human's reply with `scripts/approve.py`. Keep to the time budget: report instead of waiting.

Request: $ARGUMENTS
