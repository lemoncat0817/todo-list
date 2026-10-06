# G2 — Specification Gate

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | Freeze WHAT this change must do; make the spec the source of truth |
| Trigger | Always in `new-project` (Lean: the reply to the opening, together with G1) and `new-feature`; for a Quick enhancement, the reply to the opening message (`.ai/workflows/quick.md` §3). In `bug-fix`, an unspecified expected behavior is escalated to the Product Owner instead |
| Input | Approved discovery, or a feature request plus project context |
| Expected artifact | `spec.md` (Proposed); for a Quick enhancement, the opening message, then `change.md` |
| Approver | Product Owner |
| Waivable | No |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first. For a Quick enhancement, criteria 2, 4, 7, and 9 are checked on the opening message; the others are met by the Quick fit (`.ai/workflows/quick.md` §2), and a change that needs them is not Quick.

1. Every requirement has an ID and a rationale
2. Every AC is observable, binary, numbered, and structured as a Given/When/Then block (one When, observable Then/And)
3. Scope and out-of-scope are explicit
4. Business rules come from a human source or are flagged as assumptions
5. NFRs are measurable
6. Edge cases and error behavior are specified
7. Baseline complete for every touched capability (absent for a new capability), and every superseded or revoked criterion listed under *Supersedes and revokes*
8. Clarify round completed and reflected in Clarifications (or Clarifications names what was checked); no blocking open question
9. No design (HOW) inside; technology preferences in the request moved to Deferred technical notes
10. User-visible ACs are marked for UAT

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Architect: draft impact analysis and design options (non-binding). QA: draft scenarios from draft ACs |
| Agent must not, before approval | Implement; change contracts or schema; treat draft ACs as final; plan tasks for execution |

## 5. Minimal reply

The approver may answer in one line, for example "G2 Approved. 1 and 2 as recommended." / 「Approved. 同意 1 與 2」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).
