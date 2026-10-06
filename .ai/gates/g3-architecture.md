# G3 — Architecture Gate

## 1. Scope

This gate details `AGENTS.md` §6 (Human Gates). `AGENTS.md` and `.ai/policies/` take precedence over this file. Gate requests, approval records, and gate outcomes: `.ai/policies/artifacts.md` §5.

## 2. Definition

| Field | Definition |
|-------|------------|
| Purpose | Approve HOW: structure, contracts, data, security approach, deployment — before anything is built on it |
| Trigger | Always in a new project; in the Lean track it shares one request and one reply with G4 (`.ai/workflows/new-project.md` §2). Elsewhere when `design.md`'s verdict is **Significant**: new component or module boundary, breaking contract change, non-additive data change, new external dependency or integration, security-model change, infrastructure change, deviation from an Approved ADR. The Technical Owner may also require it |
| Input | Approved spec; current architecture and ADRs |
| Expected artifact | `architecture.md` (new project) or `design.md` (change), ADRs (Proposed), contracts, data model |
| Approver | Technical Owner; Security Owner co-approves when authentication, authorization, sessions, personal data, or cryptography is involved (`.ai/policies/security.md` §3) |
| Waivable | Yes |

## 3. Approval criteria

The approver decides against these criteria. The agent that submits the gate request self-checks them first.

1. Every requirement and NFR addressed or explicitly deferred
2. Each significant decision has an ADR with options and trade-offs
3. Contracts concrete (operations, payloads, errors, auth)
4. Data model and migration approach, including reversibility
5. Security addressed (authentication, authorization, data protection, secrets)
6. Operational concerns (configuration, observability, deployment)
7. Consistent with Approved ADRs or explicitly superseding them
8. Follows the selected profiles or justifies the deviation
9. Risks with mitigations

## 4. Before approval

| Field | Definition |
|-------|------------|
| Agent may, before approval | Tech Lead: draft a plan skeleton. Spikes only if a human asked, on a throw-away branch, never merged |
| Agent must not, before approval | Implement against unapproved contracts; run migrations; add dependencies; change shared contracts |

## 5. Minimal reply

The approver may answer in one line, for example "G3 Approved, including the listed L3 dependencies." / 「G3 Approved，L3 相依一併同意」. The runner transcribes it (`.ai/policies/artifacts.md` §5.5).

## 6. Recommended Gate Request format

To keep cognitive load low and enable rapid human approval, the submitting agent should summarize all proposed decisions and external dependencies directly in the gate request:

```text
Gate request: G3 Architecture — change NNNN-<slug>
Artifact:     docs/architecture/architecture.md (or docs/changes/NNNN/design.md)
Decide:       1. Decisions: ADR-0001 to ADR-NNNN (options and trade-offs)
              2. L3 External dependencies: list runtime packages & container images
              3. Architectural constraints and contract compliance
Risks:        List L3 risks with mitigations
Self-check:   N/N G3 criteria met
Reply with:   G3 Approved, including listed ADRs and L3 dependencies.
```
