# Plan: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | Tech Lead Agent |
| Approver | Technical Owner (G4, when triggered) |
| Upstream | `<spec.md or bug.md, design.md, test-plan.md>` |

<!-- Purpose: HOW TO IMPLEMENT and WHAT TO EXECUTE (tasks).
     Not in this artifact: new requirements, new architecture decisions, code, detailed test scenarios (test-plan.md holds them).
     Optional extra header row: Ticket — an issue-tracker key. -->

## Summary and approach

<!-- Core. -->

`<…>`

## Readiness checklist

<!-- Core. Result: Met · Not met · N/A. Evidence: the artifact and commit, the Approval row, or the reason. G4 row: triggered or not triggered, and why. -->

| Check | Result | Evidence |
|-------|--------|----------|
| Upstream approved for the change type | `<…>` | `<…>` |
| G3 | `<…>` | `<…>` |
| G4 | `<…>` | `<…>` |
| `RC-CONTRACT` | `<…>` | `<…>` |
| `RC-TESTLEFT` | `<…>` | `<…>` |
| `RC-CONSISTENT` | `<…>` | `<the Consistency check below; N/A — size C1; or N/A — size C2, no Supersedes: or Revokes:>` |
| Branch | `<…>` | `<type>/NNNN-<slug>` |

## Task table

<!-- Core. -->

| ID | Title | Owner | Covers | Depends on | Risk | Status |
|----|-------|-------|--------|------------|------|--------|
| `T<n>` | `<…>` | `<Role> Agent` | `AC<n>, … or Enabler` | `T<n>, or none` | `<L1 · L2 · L3>` | `<status>` |

## Task blocks

<!-- Core. One block per task. Title: the task's objective. Source of truth and Scope: repository-relative paths. Done when: binary criteria. -->

### `T<n>` — `<title>`

- Owner: `<Role> Agent`
- Covers: `AC<n>, …` (or `Enabler: <reason>`)
- Depends on: `T<n>, …` (or none)
- Risk: L1 · L2 · L3
- Source of truth: `<artifacts and IDs, e.g. spec.md#R1 · design.md · ADR-NNNN>`
- Scope: `<paths>`
- Constraints: `<…>`
- Done when: `<binary criteria>`
- Verification: `<commands and checks>`
- Status: Todo | In progress | Blocked (`<reason>`) | Done (`<evidence>`)

## Sequencing and parallelism

<!-- Conditional: more than one task. -->

`<…>`

## L3 items for G4

<!-- Conditional: any L3 task. Each L3 item with its rationale and rollback. Approval reference: where the approval is recorded, e.g. the G3 design, or G4. -->

| Task | Action | Rationale | Rollback | Approval reference |
|------|--------|-----------|----------|--------------------|
| `T<n>` | `<…>` | `<…>` | `<…>` | `<…>` |

## Verification strategy

<!-- Core. A link to test-plan.md, and the commands that verify the change. -->

`<…>`

## Risks and escalation points

<!-- Conditional: a risk worth naming. -->

| Risk or escalation point | Trigger | Response |
|--------------------------|---------|----------|
| `<…>` | `<…>` | `<…>` |

## Consistency check

<!-- Conditional: `RC-CONSISTENT` applies. The latest /analyze run (.ai/workflows/implementation.md §4.5), written by `scripts/analyze.py <change> --write`: date, plan commit, and one row per finding; "No findings" when clean. Resolution: the fix and its commit, or the human decision and who made it. -->

- **Run:** `<YYYY-MM-DD>` on plan commit `<sha>`

| ID | Check | Artifact and location | Finding | Resolution |
|----|-------|-----------------------|---------|------------|
| `F<n>` | `<A1–A6 · N1–N4>` | `<file#section>` | `<…>` | `<open · fixed in <sha> · decided by <role>: <…>>` |

## Deviation log

<!-- Conditional: added with the first deviation. Each departure from the spec, bug report, design, or this plan, with its approval reference. -->

| Date | Deviation | Departs from | Approval reference |
|------|-----------|--------------|--------------------|
| `<YYYY-MM-DD>` | `<…>` | `<…>` | `<…>` |

## Skeleton criteria (walking skeleton only)

<!-- Conditional: the walking-skeleton change of a new project (.ai/workflows/new-project.md §3). Technical criteria in place of a spec; scripts/trace.py and scripts/analyze.py read them. -->

| ID | Criterion |
|----|-----------|
| `AC<n>` | `<observable technical outcome, e.g. GET /health returns 200>` |

## Behavior preservation (refactor only)

<!-- Conditional: a refactor. -->

### Refactor brief

- **Motivation:** `<…>`
- **Scope:** `<…>`
- **Out of scope:** `<…>`

### Invariants

<!-- The behavior to preserve, written as ACs. -->

| ID | Invariant |
|----|-----------|
| `AC<n>` | `<…>` |

### Baseline evidence

<!-- Characterization tests, coverage note, and baseline metrics when performance is a goal. -->

`<…>`

### Rollback

`<…>`

## Change log

<!-- Conditional: the plan changed after Proposed. -->

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- Core. One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
