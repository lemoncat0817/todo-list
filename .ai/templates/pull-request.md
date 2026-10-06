<!-- Pull request title: `[NNNN] <title>` -->

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | Tech Lead Agent |
| Approver | Code Owner (G5) (+ Security Owner) |
| Upstream | `docs/changes/NNNN-<slug>/` |

<!-- Purpose: PR description that gives the Code Owner everything needed for G5.
     Not in this artifact: claims without evidence, agent-written "approved" or "LGTM", secrets.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Summary

<!-- Core. What and why, written for the reviewer. -->

`<…>`

## Tasks included

<!-- Core. -->

- `T<n> — <title>`

## Trace table

<!-- Core. From `scripts/trace.py`; `scripts/pr-body.py NNNN` assembles this whole description. -->

| AC | Tasks | Tests / scenarios | Result |
|----|-------|-------------------|--------|
| `AC<n>` | `T<n>` | `<…>` | `<…>` |

## Verification evidence

<!-- Core. Commands run, results, CI link. -->

`<…>`

## Risk

<!-- Core. The highest autonomy level in the change; each L3 item with its approval reference. -->

- **Highest level:** L1 · L2 · L3

| L3 item | Approval reference |
|---------|--------------------|
| `<…>` | `<…>` |

## Deviations

<!-- Core. Departures from the spec, design, or plan, each with its approval reference — or an explicit "None". -->

`<…>`

## AI review result

<!-- Core. A link to review.md, its result, and open suggestions. -->

`<…>`

## Contract, data, and configuration changes

<!-- Conditional: a contract, migration, or configuration file changed. Migrations called out. -->

`<…>`

## Screenshots

<!-- Conditional: a UI change. -->

`<…>`

## Code Owner checklist

<!-- Core. Self-check against the G5 approval criteria, one row per criterion number. -->

| G5 criterion | Self-check | Note |
|--------------|------------|------|
| `<n>` | `<Met · Open>` | `<evidence, or what is open>` |

## Change log

<!-- Conditional: the PR changed after review started. -->

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- Conditional: the project records approvals in the PR (`.ai/policies/git.md` §8). One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
