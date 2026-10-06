---
name: new-feature
description: Start the new-feature workflow of the AI Engineering Framework.
disable-model-invocation: true
---

Run the new-feature workflow for the request below.

1. `AGENTS.md` is in your context. Read `.ai/workflows/new-feature.md` and `.ai/workflows/implementation.md` §7.
2. Size the request (`.ai/workflows/implementation.md` §7.6). C1 or C2: run `.ai/workflows/quick.md` instead — its opening message is the assessment. C3 or C4: present the assessment and wait.
3. Run every stage yourself, in its role (`AGENTS.md` §3). Use a subagent only for independent tasks run in parallel after `RC-CONTRACT`, and for the independent AI pre-review of a C3 or C4 change. Stop at every Human Gate with a one-line reply example; record the human's reply with `scripts/approve.py`. Keep to the time budget: report instead of waiting.
4. Clarify (Stage 4): ask the Product Owner in one message, then update `spec.md`. Plan (Stage 7): run `python3 scripts/analyze.py <change> --write` when `RC-CONSISTENT` applies.

Request: the text entered with this command.
