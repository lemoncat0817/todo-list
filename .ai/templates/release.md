# Release: `<version>`

| Field | Value |
|-------|-------|
| Change | N/A — release record |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | DevOps Agent |
| Approver | Product Owner (G6) · Release Owner (G7) |
| Upstream | `<previous release record; included changes>` |

<!-- Purpose: Release record: scope, UAT, readiness, decision, deployment, post-release.
     Not in this artifact: secrets, agent-filled decision records, ticked checklist items without evidence.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Version and target window

- **Version:** `<version>`
- **Target window:** `<…>`
- **Delivery type:** Service · Artifact (`.ai/workflows/release.md` §3)

## Included changes

| Change | PR | User-visible |
|--------|----|--------------|
| `NNNN` | `<PR link>` | `<Yes · No>` |

## Release notes draft

<!-- Release notes, and the planned communication to users. -->

`<…>`

## Known issues

| Issue | Impact | Product Owner acceptance |
|-------|--------|--------------------------|
| `<…>` | `<…>` | `<…>` |

## UAT

### Practice

<!-- A separate UAT environment with business testers, or Product Owner acceptance on staging. -->

`<…>`

### Scope

<!-- Full UAT, or the agreed smoke test of a hotfix. -->

`<…>`

### Script

<!-- Business-language steps per included change. -->

`<…>`

### Results

| Change | Step | Result | Executed by |
|--------|------|--------|-------------|
| `NNNN` | `<…>` | `<…>` | `<…>` |

### Defects

| Defect | Severity | Product Owner triage |
|--------|----------|----------------------|
| `<…>` | `<…>` | `<Fix now · Accept as known issue · Defer>` |

### Outcome

<!-- The UAT outcome; the G6 record is in the Approval table. -->

`<…>`

## Readiness checklist

<!-- Each item with its evidence. -->

| Item | Evidence |
|------|----------|
| Pipeline on the tag | `<…>` |
| Migrations rehearsed | `<…>` |
| Configuration and secret *presence* verified | `<…>` |
| Monitoring and alerts | `<…>` |
| Rollback validated | `<…>` |
| Dependency and licence check | `<…>` |
| Security checks | `<…>` |

## Readiness verdict

<!-- The agent's verdict. -->

- **Verdict:** `READY` · `NOT READY`

## Deployment runbook

`<…>`

## Rollback plan and pre-approved rollback criteria

`<rollback plan>`

| Criterion | Threshold | Action |
|-----------|-----------|--------|
| `<…>` | `<…>` | `<…>` |

## Release decision

<!-- The G7 decision, also recorded in the Approval table. -->

- **Decision:** `GO` · `NO-GO`
- **Decided by:** `<…>`
- **Conditions:** `<…>`
- **Deployment window:** `<…>`

## Deployment log

| Time | Step | Result |
|------|------|--------|
| `<…>` | `<…>` | `<…>` |

## Post-release verification

| Check | Threshold | Result |
|-------|-----------|--------|
| `<…>` | `<…>` | `<…>` |

## Outcome and closure

`<…>`

## Change log

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
