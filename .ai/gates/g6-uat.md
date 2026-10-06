# G6 — UAT Gate

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | The business confirms that the release candidate meets its needs in a production-like environment |
| Trigger | Every release containing a user-facing change |
| Input | Release candidate in the UAT environment; UAT script from QA Agent; known-issues list |
| Expected artifact | UAT section of `release.md` |
| Approver | Product Owner, with the business users who executed UAT |
| Waivable | Yes (non-user-facing releases) |
| UAT practice | Both are supported: a separate UAT environment with business testers, or Product Owner acceptance on staging. The release record states which |
| Hotfix | Urgency changes how much is reviewed, not whether a human decides. A hotfix still passes G5 and G7; the Release Owner may reduce G6 to an agreed smoke test and record that. Follow-up obligations (full regression, completed RCA) are recorded as conditions |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. Every UAT scenario executed by people, results recorded
2. Each failure triaged by the Product Owner (fix now, accept as known issue, defer)
3. No open critical defect

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Prepare the UAT script; deploy the candidate to UAT (non-production); fix defects through `bug-fix` |
| Agent must not, before approval | Mark UAT passed; execute UAT on the business's behalf (automated tests are not UAT); promote to production |

## 5. Minimal reply

The approver may answer in one line, for example "G6 Approved. UAT passed, no blocking defect." / 「G6 Approved，UAT 通過」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
