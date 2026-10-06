# G5 — Pull Request Gate (human code review)

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | A human accepts the code into the main line. AI-generated code is never trusted automatically |
| Trigger | Every change, without exception |
| Input | PR body from `scripts/pr-body.py`; the AI pre-review — `review.md` for C3/C4, the converge record and CI review for Quick (for Cosmetic, the request and visual evidence in the PR description); the trace table and run-it results (`test-plan.md` or `change.md`); green CI |
| Expected artifact | The PR (and the frozen change folder) |
| Approver | Code Owner (+ Security Owner where relevant — `.ai/policies/security.md` §3) |
| Waivable | No |
| Where it is recorded | The Code Owner's approval in the session, transcribed with `scripts/approve.py` into the Approval table of `review.md` (C3/C4) or `change.md` (Quick), completes G5. Without branch protection that requires a platform review, no separate approval in the hosting web UI is needed. When the approval also instructs the merge, the agent merges (`.ai/policies/git.md` §5) and reports the merged PR and merge commit, so the human has nothing left to click |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. The change does exactly what the approved spec and design say — no unapproved scope
2. Trace table complete; every user-visible AC was run through its real interface and the converge record shows every AC met and no unjustified unrequested change
3. Tests are meaningful, not merely present
4. CI green
5. No unresolved blocking AI finding, or a recorded human override
6. Security-sensitive parts reviewed by the Security Owner (`.ai/policies/security.md` §3)
7. Contracts, migrations, configuration, and `architecture.md` updated as required
8. Every deviation has an approval reference
9. The reviewer can explain the change

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Answer questions; push fix commits for review comments; re-run verification and AI review |
| Agent must not, before approval | Merge; dismiss or resolve a human's comment; force-push away review history; widen scope |

## 5. Minimal reply

The approver may answer in one line, for example "G5 Approved. Merge PR #2." / 「G5 Approved，同意合併 PR #2」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
