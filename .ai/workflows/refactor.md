# Workflow: refactor

## 1. Scope

This workflow details `AGENTS.md` §3 (Lifecycle) for a refactor. `AGENTS.md`, `.ai/policies/`, and `.ai/gates/` take precedence over this file. Rules for every workflow are in `.ai/workflows/implementation.md` §7; one session runs every stage in the named role (`AGENTS.md` §3), and a Conditional template section that does not apply is left out.

| Field | Value |
|-------|-------|
| Purpose | Improve structure while **preserving behavior** — the defining constraint of this workflow |
| Command | `/refactor` |
| Starts with | A structural improvement with no behavior change |
| Ends when | G5 approved and merged |

## 2. Stages

The stage table uses: **Owner** = the role accountable for the output · **With** = contributing roles · **Exit** = binary criteria. Human Gates are defined in `.ai/gates/`; readiness checks (`RC-*`) in `.ai/workflows/implementation.md` §4.

| # | Stage | Owner | With | Output | Exit | Gate |
|---|-------|-------|------|--------|------|------|
| 1 | Intake | Runner | Tech Lead | `NNNN-<slug>/plan.md` — Refactor brief: motivation, scope, out of scope; branch and folder from `scripts/new-change.py <slug> --type refactor --artifact none` | Artifact language read from `docs/project.md` (`implementation.md` §7.1); refactor brief written: motivation, scope, out of scope | — |
| 2 | Baseline | QA Agent | implementer | Characterization tests for in-scope behavior; coverage note; baseline metrics if performance is a goal | All in-scope behavior is covered by passing tests, or the gaps are listed for approval | — |
| 3 | Preservation plan | Tech Lead Agent | Architect | `plan.md` — **invariants written as ACs** ("all existing API responses are unchanged for fixtures A–F"), small steps that each keep the suite green, rollback | Invariants written as ACs; small steps that each keep the suite green; rollback stated | **G3** if module boundaries, public contracts, or data structures change; **G4** if any L3 or coverage gaps were accepted |
| 4 | → `implementation` | | | Every step green; no behavior change; no feature work mixed in | | G5 |
| 5 | → next `release` | | | Regression suite is the evidence; UAT only if risk warrants | | G6 if risk warrants, G7 |

**Rule:** the moment a behavior change is needed, the refactor stops being a refactor. Split it: behavior changes go through `new-feature` or `bug-fix`.
