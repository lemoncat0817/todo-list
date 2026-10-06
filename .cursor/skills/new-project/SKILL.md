---
name: new-project
description: Start the new-project workflow of the AI Engineering Framework.
disable-model-invocation: true
---

Run the new-project workflow.

1. `AGENTS.md` is in your context. Read `.ai/workflows/new-project.md` only; it names the other files when a mode, track, or stage needs them.
2. Run its §1 mode check. Adopt: follow `.ai/workflows/new-project-adopt.md`. Otherwise propose the track; for Lean, send the opening of §2 and wait; for Full, follow `.ai/workflows/new-project-full.md`.
3. Run every stage yourself, in its role (`AGENTS.md` §3). Use a subagent only for independent tasks run in parallel after `RC-CONTRACT`, and for the independent AI pre-review of a C3 or C4 change. Stop at every human stop with a one-line reply example; record each gate in the reply with `scripts/approve.py`. Keep to the time budget: report instead of waiting.

Operator's input: the text entered with this command.
