# Workflow: new-feature

## 1. Scope

A new or changed capability in an existing project, sized C3 or C4. Rules for every workflow: `.ai/workflows/implementation.md` §7. A request that sizes C1 or C2 runs the Quick track (`.ai/workflows/quick.md`) instead.

| Field | Value |
|-------|-------|
| Command | `/new-feature <request>` |
| Requires | An approved `docs/project.md` |
| Ends when | G5 approved and merged |

## 2. Stages

One session runs every stage in the named role (`AGENTS.md` §3).

| # | Stage | Role | Output | Exit | Gate |
|---|-------|------|--------|------|------|
| 1 | Context | Runner | `docs/changes/NNNN-<slug>/`, branch — `scripts/new-change.py <slug> --type feat --artifact spec` | Size confirmed (`implementation.md` §7.6); `project.md`, `architecture.md`, and the touched capability views read | — |
| 2 | Discovery *(conditional)* | PM | `NNNN/discovery.md` | Only when the request is ambiguous, cross-team, or large — the Product Owner or Technical Owner decides | G1 *(optional)* |
| 3 | Specify | PM | `spec.md` Draft: ACs in Given/When/Then; *Capabilities*; *Baseline* from `scripts/capability-views.py baseline`; `Supersedes:`/`Revokes:` | WHAT only (§7); thin slice (§5) | — |
| 4 | Clarify | PM | *Clarifications*; spec → Proposed | Every question answered or recorded as an open question or assumption with an owner (§6) | **G2** |
| 5 | Design | Architect | Design verdict (§3); `design.md` for Minor or Significant, with ADRs and contract updates | Verdict recorded; deferred technical notes evaluated | **G3** if Significant |
| 6 | Test design *(conditional)* | QA | `test-plan.md` scenarios | Test-left trigger applies (§4) | `RC-TESTLEFT` |
| 7 | Plan | Tech Lead | `plan.md`; `/analyze` when `RC-CONSISTENT` applies | Every AC → ≥ 1 task; risk per task; no task for capability views | **G4** if any L3 task |
| 8 | → `implementation` | | | | G5 |

Stages 5 and 6 may run together once G2 is approved. A design verdict of None is one line in `plan.md` *Summary and approach*; no `design.md` is written.

## 3. Design verdict

Owned by the Architect role; the Technical Owner may override it.

| Verdict | Means | Gate |
|---------|-------|------|
| None | Code changes inside existing modules only | — |
| Minor | Follows existing architecture and ADRs: an additive endpoint, an additive nullable column, a component on an existing pattern | — (seen at G5) |
| Significant | New component or module boundary; breaking contract; non-additive data change; new dependency or integration; security-model or infrastructure change; deviation from an Approved ADR | **G3** |

When the request expresses only business intent, the Architect role works out from the existing code whether the change is local; it does not widen scope to contracts or schema without cause.

## 4. Test-left triggers

Complex UI interaction (drag-and-drop, multi-select), stateful flows, dense validation rules, concurrency, security-sensitive behavior, historically fragile areas.

## 5. Spec size

- ACs state the behavior the Product Owner asked for; edge cases fold into them or go to *Out of scope*. Tests follow the ACs, at least one each.
- **Thin slices.** A spec past 10–12 ACs, or covering more than 3 independent user journeys, is too large for one change. The PM role proposes a vertical split before G2: the MVP slice stays; every other slice goes under *Out of scope* as a candidate change. The split is the Product Owner's decision (L4).

## 6. Clarify

Clarify finds what the draft leaves undecided before the Product Owner freezes it. Read the draft as an implementer forced to guess.

1. **Find 3–5 gaps** that would change behavior if guessed differently, most impactful first: lifecycle and removal, roles and permissions, state sets and transitions, required data, error and boundary behavior.
2. **Ask once, with defaults.** All questions in one message; each has 2–4 lettered options, a **recommended default** with a one-line reason, and the ACs it changes. The Product Owner may answer "defaults OK".

   ```text
   Q1/4  Can a case be deleted?
         A. Yes, by its creator   B. Only by a supervisor   C. Never; it is closed and archived
         Recommended: C — keeps the audit trail that R6 requires
         Changes: business rules; AC4, AC5
   ```

3. **Update the spec.** Each answer becomes a *Clarifications* row and is applied to the rules and ACs; an unanswered question stays in *Open questions* with an owner, or its default becomes an *Assumption* to confirm at G2. An answer that widens scope returns to Stage 3.
4. **Submit to G2** with the gate request. With nothing material undecided, *Clarifications* names what was checked.

Questions are about behavior and business rules, never technology.

## 7. WHAT and HOW stay apart

The spec answers *what* and *why*; design answers *how*. Technology in a request — framework, language, database, protocol, API style, architecture pattern — moves verbatim to *Deferred technical notes*, and the requester is told it was deferred to design; the requirement states the user need behind it. A technology the business imposes (contract, regulation, an existing system) is a requirement with its human source. The Architect role records in design what it adopted or rejected, and why.
