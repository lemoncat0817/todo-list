# Workflow: bug-fix

## 1. Scope

Restore specified behavior with proof, and learn why it broke. The WHAT already exists; the work is diagnosis. Rules for every workflow: `.ai/workflows/implementation.md` §7. A defect that fits the Quick track (`.ai/workflows/quick.md` §2: S3/S4, one layer and module, unit or component test, no L3) runs there instead.

| Field | Value |
|-------|-------|
| Command | `/bug-fix <defect report>` |
| Ends when | G5 approved and merged (hotfix → `release`) |

## 2. Stages

One session runs every stage in the named role (`AGENTS.md` §3).

| # | Stage | Role | Output | Exit | Gate |
|---|-------|------|--------|------|------|
| 1 | Intake | Runner | `NNNN-<slug>/bug.md` *Report*, branch — `scripts/new-change.py <slug> --type fix --artifact bug` | Observed, expected, environment, steps (or marked unknown) | — |
| 2 | Triage | Tech Lead | `bug.md` *Triage*: severity S1–S4, **source of expected behavior**, bug or change request, track | Unspecified expected behavior → **Product Owner decides**; a change request → `new-feature`; a Quick fit → `quick` | escalation |
| 3 | Reproduce | QA | A failing test named for the corrected behavior (manual only with a stated reason) | It fails for the reported reason | — |
| 4 | Root cause | Frontend or Backend | `bug.md` *Root cause*: cause, why tests missed it, blast radius | Supported by code evidence | — |
| 5 | Fix plan | Tech Lead | `plan.md` tasks, each with a risk level; `bug.md` *Fix plan* links it | Every corrected-behavior AC → a task | **G3** if architecture impact; **G4** if any L3 |
| 6 | → `implementation` | | The reproduction test fails before and passes after the fix | | G5 |
| 7 | → `release` (normal or hotfix) | | | | G6, G7 |

**Hotfix (S1 in production):** the same stages with short artifacts; G5 still required; `release` runs with UAT reduced to an agreed smoke test, recorded by the Release Owner. Then merge back to the main line, run the full regression, and complete the RCA.
