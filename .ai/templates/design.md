# Design: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | Architect Agent |
| Approver | Technical Owner (G3, when the verdict is Significant) (+ Security Owner) |
| Upstream | `<spec.md, architecture.md, ADRs>` |

<!-- Purpose: Technical impact and design for one change; decides whether G3 is needed.
     Not in this artifact: new or changed requirements, task breakdown, code.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Summary

<!-- Core. -->

- **Addresses:** `R<n>, AC<n>`

`<summary>`

## Impact analysis

<!-- Core. -->

| Area | Impact | Notes |
|------|--------|-------|
| Frontend | `<…>` | `<…>` |
| Backend | `<…>` | `<…>` |
| Contracts | `<…>` | `<…>` |
| Data | `<…>` | `<…>` |
| Security | `<…>` | `<…>` |
| Configuration | `<…>` | `<…>` |
| Infrastructure | `<…>` | `<…>` |
| Operations | `<…>` | `<…>` |

## Verdict

<!-- Core. -->

- **Verdict:** None · Minor · Significant
- **Reason:** `<…>`

## Design

<!-- Conditional: a Minor or Significant verdict; keep only the subsections that apply. -->

### Interactions

`<…>`

### Contract changes

<!-- With references to the contract files. -->

`<…>`

### Data changes and migration reversibility

`<…>`

### Security

`<…>`

### Error handling

`<…>`

## ADRs proposed

<!-- Conditional: an ADR is proposed. -->

- `ADR-NNNN — <title>`

## Alternatives considered

<!-- Conditional: an alternative was weighed. -->

| Alternative | Why not chosen |
|-------------|----------------|
| `<…>` | `<…>` |

## Risks and mitigations

<!-- Conditional: a risk worth naming. -->

| Risk | Mitigation |
|------|------------|
| `<…>` | `<…>` |

## `architecture.md` sections to update in the same PR

<!-- Conditional: architecture.md changes. -->

- `<section — change>`

## Change log

<!-- Conditional: the design changed after Proposed. -->

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- Core. One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
