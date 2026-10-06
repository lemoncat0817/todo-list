# G7 — Release Gate

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | Authorize production deployment: go or no-go |
| Trigger | Every production release, including hotfixes |
| Input | `release.md` with readiness checklist and evidence, UAT outcome, runbook, rollback plan and criteria, known issues |
| Expected artifact | Release decision record in `release.md` |
| Approver | Release Owner (with Product Owner / Technical Owner as the project defines) |
| Waivable | No |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. UAT approved or validly waived
2. Every included change passed G5
3. Readiness checklist complete with evidence
4. Migrations rehearsed
5. Rollback plan validated and rollback criteria agreed
6. Release notes and communication ready
7. Deployment window agreed

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Prepare artifacts, notes, and runbook; dry-run in non-production |
| Agent must not, before approval | Deploy to production; run production migrations; change production configuration; announce the release |

## 5. After approval

DevOps Agent executes the runbook, verifies, and may roll back **only** when a pre-approved criterion is met.

## 6. Minimal reply

The approver may answer in one line, for example "G7 GO. Tag 0.1.0." / 「G7 GO，同意打 tag 0.1.0」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
