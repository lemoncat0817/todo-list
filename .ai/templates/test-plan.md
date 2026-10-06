# Test Plan: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | QA Agent |
| Approver | Technical Owner (G4, scenarios when test-left applies) |
| Upstream | `<the ACs (spec.md, bug.md, or a refactor's plan.md), design.md, plan.md>` |

<!-- Purpose: How each AC is verified, and the evidence that it was.
     Not in this artifact: requirement changes, implementation code, pass claims without evidence.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Scope and assumptions

<!-- Conditional: scope or assumptions differ from the spec. -->

`<…>`

## Strategy

<!-- Conditional: test-left applies or levels are not obvious. Who writes which test level; environments; test data. -->

`<…>`

## Scenario matrix

<!-- Conditional: test-left applies (`RC-TESTLEFT`). One row per scenario.
     Scenario ID: category code and number, e.g. EC-02. Category codes: HP Happy Path · EC Edge Case · EH Error Handling · PF Performance · SC Security · RG Regression.
     Covers: the ACs the scenario verifies.
     Expected result: an observable state change, API outcome, or UI reaction.
     Level: Unit · Integration · E2E · Manual · UAT. -->

| Scenario ID | Category | Covers | Pre-conditions | Steps | Expected result | Level |
|-------------|----------|--------|----------------|-------|-----------------|-------|
| `HP-<nn>` | Happy Path | `AC<n>` | `<…>` | `<…>` | `<…>` | `<…>` |

## UAT script

<!-- Conditional: a release with user-visible ACs. Business-language steps for the user-visible ACs. -->

| Step | AC | Action | Expected result |
|------|----|--------|-----------------|
| `<n>` | `AC<n>` | `<…>` | `<…>` |

## Results

<!-- Core. Commands run and their results; one run-it row per user-visible AC; the converge result — each AC met, partial, or missing, and any unrequested change (.ai/workflows/implementation.md §7.7). Outcome: PASS · FAIL · NOT RUN. -->

| Scenario ID | Outcome | Evidence |
|-------------|---------|----------|
| `<…>` | `<…>` | `<…>` |

## Trace table

<!-- Core. Written by `scripts/trace.py NNNN --write`; a manual verification is added as its own row with its evidence. -->

| AC | Tasks | Tests / scenarios | Result |
|----|-------|-------------------|--------|
| `AC<n>` | `T<n>` | `<…>` | `<…>` |

## Residual risks and manual checks

<!-- Conditional: a residual risk or manual check. -->

`<…>`

## Change log

<!-- Conditional: the test plan changed after Proposed. -->

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- Conditional: G4 reviews the scenarios. One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
