# G1 — Discovery Gate

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | Confirm the problem is understood and worth solving; agree goals, non-goals, constraints, and direction before specifying anything |
| Trigger | Always in `new-project` — in the Lean track, the reply to the opening, together with G2; in Adopt, the one stop on `docs/project.md` (`.ai/workflows/new-project.md` §1–§2); in `new-feature` when the Product Owner or Technical Owner asks for discovery (ambiguous, large, or cross-team requests) |
| Input | Intake answers, stakeholder material, existing systems |
| Expected artifact | `discovery.md` (Proposed) and, for new projects, `project.md` (Proposed) |
| Approver | Product Owner; Technical Owner confirms `project.md` |
| Who reads what | The gate request says it: the Product Owner reviews `discovery.md` (problem, goals, scope, open questions); the Technical Owner reviews `project.md` (stack, environments, verification commands, owners). One person holding both roles reads both |
| Waivable | Yes |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. Problem stated in business terms
2. Users and stakeholders identified
3. Measurable goals or success signals
4. Explicit non-goals
5. Constraints captured (time, budget, compliance, mandated technology)
6. Every assumption labelled with who confirms it
7. Risks and unknowns have owners
8. Open questions resolved or deferred with an owner
9. A recommended direction with at least one alternative
10. Technical context consistent with `project.md`
11. Stack choices recorded as human inputs, not agent decisions

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Research, ask clarifying questions, revise the discovery, explore technical options marked *exploratory* |
| Agent must not, before approval | Submit a spec as Proposed; make architecture decisions; scaffold code; create repositories, cloud resources, or pipelines; decide scope |

## 5. Minimal reply

The approver may answer in one line, for example "G1 Approved. Open questions: defaults as recommended." / 「G1 Approved，開放問題採推薦預設」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
