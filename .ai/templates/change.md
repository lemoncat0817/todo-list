# Change: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Type | Enhancement · Defect · Cosmetic |
| Size | C1 · C2 — `<deciding reason>` |
| Status | Draft |
| Owner | Runner (PM role for intent and ACs; implementer role for verification) |
| Approver | Product Owner (G2, Enhancement) · Code Owner (G5) |
| Upstream | `<the request; for a Defect, the AC or Product Owner decision behind the expected behavior>` |
| Capabilities | `<capability slug, …>` |

<!-- The single artifact of a C2 Quick change or bundle (.ai/workflows/quick.md); a Cosmetic change has none.
     Core sections are always present. A Conditional section that does not apply is deleted, never answered N/A.
     Status stays Draft until scripts/approve.py records a gate outcome; never set it by hand.
     Sections written after approval: Notes, Verification, Trace table, Convergence, Change log, Approval. -->

## Intent

<!-- Core. The request as received, and the goal in one sentence; a bundle lists each item. -->

`<…>`

## Acceptance criteria

<!-- Core for Enhancement and Defect; deleted for Cosmetic. 3–5 ACs, one Gherkin block each.
     Defect: the corrected behavior as ACs — the regression targets. -->

### `AC1` — `<short title>`

```gherkin
Given <starting state>
When <one action or event>
Then <observable outcome>
```

## Baseline

<!-- Conditional: the change touches current criteria of a capability. `scripts/capability-views.py baseline <capability>` prints the candidates. -->

| Criterion | Current behavior (short) | Disposition |
|-----------|--------------------------|-------------|
| `NNNN-AC<n>` | `<…>` | `<Kept · Superseded by AC<n> · Revoked>` |

## Supersedes and revokes

<!-- Conditional: matches the Baseline dispositions. -->

- `AC<n> Supersedes: NNNN-AC<n>`
- `Revokes: NNNN-AC<n> — <reason>`

## Clarifications

<!-- Conditional: one row per question asked in the opening message. -->

| Q | Question | Answer | Date |
|---|----------|--------|------|
| `Q<n>` | `<…>` | `<option chosen>` | `<YYYY-MM-DD>` |

## Defect

<!-- Conditional: Defect only. -->

- **Observed:** `<…>`
- **Steps:** `<…>`
- **Severity:** S3 · S4
- **Root cause:** `<cause>` · why tests missed it: `<…>` · blast radius: `<…>`

## Notes

<!-- Conditional: deviations with their approval reference, a size-up reason, follow-ups. -->

- `<…>`

## Verification

<!-- Core. Commands run with their results; one run-it row per AC (Cosmetic: the visual check). -->

- `<command>` → `<result>`

| AC | Run it | Result |
|----|--------|--------|
| `AC<n>` | `<what was done through the real interface>` | `<observed>` |

## Trace table

<!-- Core. Written by `scripts/converge.py NNNN`. -->

## Convergence

<!-- Core. Each AC against the diff; unrequested: every changed file outside the impact scope, or "None". -->

| AC | Status | Evidence |
|----|--------|----------|
| `AC<n>` | `<met · partial · missing>` | `<test, run-it row>` |

- **Unrequested:** `<None, or file — reason>`

## Approval

<!-- Core. One row per gate decision, recorded with `scripts/approve.py`. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
