# Bug: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | Tech Lead Agent |
| Approver | N/A — no gate reviews this artifact |
| Upstream | `<the defect report; the AC or Product Owner decision behind the expected behavior>` |
| Capabilities | `<capability slug, …>` — views in `docs/specs/` (`.ai/policies/artifacts.md` §12) |

<!-- Purpose: Defect report, triage, reproduction, root cause, corrected behavior, and the fix in brief (the tasks are in plan.md).
     Not in this artifact: feature enhancements, opportunistic refactors, a changed expected behavior without a Product Owner decision.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Report

<!-- Core. -->

- **Observed:** `<…>`
- **Expected:** `<…>`
- **Environment:** `<…>`
- **Steps:** `<…>`
- **Frequency:** `<…>`
- **Evidence:** `<logs, screenshots, links>`

## Triage

<!-- Core. -->

- **Severity:** S1 · S2 · S3 · S4
- **Impact:** `<…>`
- **Source of expected behavior:** `<NNNN-AC<n>, or the recorded Product Owner decision>`
- **Bug or change request:** `<Bug, or Change request — reason>`
- **Track:** Standard (a defect that fits `.ai/workflows/quick.md` §2 uses `change.md` instead)

## Reproduction

<!-- Core. A failing test reference, or manual steps with the reason automation is impossible. -->

`<…>`

## Root cause

<!-- Core. -->

- **Cause:** `<…>`
- **Evidence:** `<…>`
- **Why tests missed it:** `<…>`
- **Blast radius:** `<…>`

## Corrected behavior

<!-- Core. The corrected behavior as ACs — the regression targets. -->

| ID | Criterion |
|----|-----------|
| `AC<n>` | `<…>` |

## Fix plan

<!-- Core. The fix in brief, with a link to plan.md, which holds the tasks. -->

`<…>`

## Follow-ups

<!-- Conditional: the pattern recurs elsewhere or a test gap remains. The same defect pattern elsewhere; test gaps. -->

- `<…>`

## Change log

<!-- Conditional: the record changed after triage. -->

- `<YYYY-MM-DD>` — `<what changed>`
