# Specification: `<title>`

| Field | Value |
|-------|-------|
| Change | `NNNN-<slug>` |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | PM Agent |
| Approver | Product Owner (G2) |
| Upstream | `<discovery.md, the request, earlier specs>` |
| Capabilities | `<capability slug, …>` — views in `docs/specs/` (`.ai/policies/artifacts.md` §12) |

<!-- Purpose: The required behavior of the change (WHAT) — the source of truth.
     Not in this artifact: components, classes, endpoint or table designs (unless the business itself imposes them), tasks, test cases, technology choices.
     Optional extra header row: Ticket — an issue-tracker key. -->

> **WHAT and WHY only.** This spec states user intent and business behavior. It never names a framework, language, database, protocol, API style, library, or architecture pattern (for example Angular, Spring Boot, PostgreSQL, REST). Technical details found in the request go to *Deferred technical notes*, unread by G2. A technology the business itself imposes — by contract, regulation, or an existing system the change must work with — is a constraint: record it as a requirement with its human source.

## Request and context

<!-- Core. The request as received, and the project context it lands in. -->

`<…>`

## Baseline

<!-- Conditional: the change touches current criteria of a capability. The current criteria of the touched capabilities that this change affects; `scripts/capability-views.py baseline <capability>` prints the candidates. Disposition: Kept · Superseded by AC<n> · Revoked. -->

| Criterion | Current behavior (short) | Disposition |
|-----------|--------------------------|-------------|
| `NNNN-AC<n>` | `<…>` | `<Kept · Superseded by AC<n> · Revoked>` |

## Goal

<!-- Core. -->

`<…>`

## Scope / out of scope

<!-- Core. -->

- **In scope:** `<…>`
- **Out of scope:** `<…>`

## Actors

<!-- Core. -->

- `<actor>`

## Requirements

<!-- Core. One row per requirement. Type: Functional or Non-functional; a non-functional requirement has a measurable target. Rationale: the goal it serves, e.g. discovery.md#goal-2. -->

| ID | Requirement | Type | Rationale |
|----|-------------|------|-----------|
| `R<n>` | `<…>` | `<Functional · Non-functional>` | `<…>` |

## Acceptance criteria

<!-- Core. One block per AC, numbered across the whole spec; each belongs to one requirement. Gherkin keywords stay in English; step text uses the artifact language.
     Given: the starting state, with concrete values. When: exactly one actor action or event. Then/And: observable, binary outcomes — no vague words such as "quickly" or "correctly", no UI or code detail.
     Data variations: "Scenario Outline" with an "Examples" table, one row per case. -->

### `AC<n>` — `<short title>`

- **Requirement:** `R<n>`

```gherkin
Given <starting state>
When <one action or event>
Then <observable outcome>
And <further observable outcome>
```

## Business rules

<!-- Conditional: a rule the ACs do not state on their own. Each rule is referenced by at least one AC. Source: the human source of the rule, or "Assumption". -->

| Rule | Source | ACs |
|------|--------|-----|
| `<…>` | `<…>` | `AC<n>` |

## Edge cases and error behavior

<!-- Conditional: a case not folded into an AC. Each case maps to an AC. -->

| Case | Expected behavior | AC |
|------|-------------------|----|
| `<…>` | `<…>` | `AC<n>` |

## Supersedes and revokes

<!-- Conditional: a criterion is superseded or revoked. One line per superseding AC, naming the criterion it replaces, and one line per criterion withdrawn with no replacement, with the reason (.ai/policies/artifacts.md §9). Matches the Baseline dispositions. -->

- `AC<n> Supersedes: NNNN-AC<n>`
- `Revokes: NNNN-AC<n> — <reason>`

## Assumptions

<!-- Conditional: an assumption awaits confirmation. Assumptions awaiting confirmation, each with the role that confirms it. -->

| ID | Assumption | Confirmed by |
|----|------------|--------------|
| `A<n>` | `<…>` | `<role>` |

## Open questions

<!-- Conditional: a question is open. Each open question with an owner; a deferred question states when it is answered. -->

| Question | Owner | Status |
|----------|-------|--------|
| `<…>` | `<role>` | `<open, or deferred until …>` |

## Clarifications

<!-- Core. One row per Clarify question (.ai/workflows/new-feature.md §6): the question, the Product Owner's answer, and the sections it changed. Answers are business decisions with the Product Owner as their source. -->

| Q | Question | Answer | Date | Updated |
|---|----------|--------|------|---------|
| `Q<n>` | `<…>` | `<option chosen, or the PO's words>` | `<YYYY-MM-DD>` | `<R#, AC#, business rule>` |

## Deferred technical notes

<!-- Conditional: the request held technical details. Technical details found in the request, kept verbatim for the Architect Agent. Not part of the WHAT; not reviewed at G2. -->

- `<…>` — Technical detail recorded; deferred to design for the Architect Agent's evaluation.

## Dependencies

<!-- Conditional: the change depends on other work. -->

- `<…>`

## User-visible ACs

<!-- Conditional: some ACs are not user-visible; otherwise all are. ACs whose behavior users see; the basis of the UAT script. -->

- `AC<n>`

## Change log

<!-- Conditional: the spec changed after Proposed. -->

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- Core. One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
