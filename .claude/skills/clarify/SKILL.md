---
name: clarify
description: Run the Clarify stage of the AI Engineering Framework on a draft spec, before G2.
argument-hint: "<change-id or path to spec.md>"
disable-model-invocation: true
---

Run the Clarify stage for the spec below.

1. `AGENTS.md` is in your context. Read `.ai/workflows/new-feature.md` §5–§7 and `.ai/gates/g2-specification.md`.
2. Find the spec: a change ID such as `0007` means `docs/changes/0007-*/spec.md`; a path is used as given. Read the artifact language from `docs/project.md` (`.ai/workflows/implementation.md` §7.1). If the spec is not `Draft` or `Proposed`, stop and escalate: an Approved spec changes only through `.ai/policies/artifacts.md` §5.4 and §9.
3. This session acts in the PM Agent role for this stage, because the Product Owner answers here. As devil's advocate, read the spec as an implementer forced to guess and find the 3–5 boundaries that would change behavior if guessed differently, most impactful first. Questions are about behavior and business rules only, never technology.
4. Ask all questions in one message, in the format of `.ai/workflows/new-feature.md` §6 step 2: lettered options, a recommended default with a one-line reason, and the sections each answer changes. Then stop and wait for the Product Owner.
5. Update `spec.md` from the reply: one *Clarifications* row per question, each answer applied to the business rules and ACs it changes (Given/When/Then), an unanswered question kept in *Open questions* with an owner or turned into an *Assumption*. Technology found in the spec or the reply moves verbatim to *Deferred technical notes* (§7). An answer that widens scope returns to Specification.
6. If nothing material is undecided, write `N/A — no material ambiguity found` in *Clarifications* and name what was checked.
7. Self-check the G2 criteria, set Status to `Proposed`, and present the gate request (`AGENTS.md` §6). Stop at G2: only the Product Owner approves.

Spec: $ARGUMENTS
