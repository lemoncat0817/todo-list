# G4 — Plan Gate (conditional)

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | Approve the execution approach when it carries risk — and **batch the approval of L3 tasks up front** so implementation is not interrupted later |
| Trigger | The first plans of a new project (Lean: in one request with G3); any plan containing an L3 task; a refactor with accepted coverage gaps; any plan that deviates from the approved design. An L3 task whose approval is already recorded — normally in the G3 design — does not trigger G4; the plan cites that approval |
| Input | Approved spec and design/architecture; test plan |
| Expected artifact | `plan.md` (Proposed), `test-plan.md` scenarios where test-left applies |
| Approver | Technical Owner |
| Waivable | Yes |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. Every AC is covered by at least one task
2. Every task has owner, scope, verification, and binary *Done when*
3. Dependencies and order make sense (the walking skeleton is its own first change in a new project, `.ai/workflows/new-project.md` §3)
4. Every L3 task is listed with rationale and rollback
5. The plan introduces no decision missing from approved artifacts (otherwise: back to G3)
6. Test-left decision recorded
7. *Consistency check* recorded for the current plan with no open blocking finding (`RC-CONSISTENT`), or the section absent because `RC-CONSISTENT` does not apply

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Refine the plan; prepare branches; read code |
| Agent must not, before approval | Execute any task of this plan |

## 5. Minimal reply

The approver may answer in one line, for example "G4 Approved." / 「G4 Approved，同意偏離 1」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
