# Workflow: implementation

## 1. Scope

From an approved plan to a merged change, for the Standard and Full tracks; §7 holds the rules for every workflow. The Quick track has its own loop (`.ai/workflows/quick.md`).

| Field | Value |
|-------|-------|
| Command | `/implement <change>` — runs or resumes |
| Starts with | An approved plan (or a plan that needs no gate) |
| Ends when | G5 approved and merged |

## 2. Stages

| # | Stage | Role | Output | Exit | Gate |
|---|-------|------|--------|------|------|
| 0 | Readiness | Tech Lead | *Readiness checklist* of `plan.md` | Upstream approved (below); plan Approved if G4 was triggered; `RC-CONTRACT`, `RC-TESTLEFT`, `RC-CONSISTENT` met where they apply; branch created | — |
| 1 | Task loop | Each task's owner role | Code, tests, commit `Refs: NNNN-T#`, task → Done | *Done when* met with evidence | — |
| 2 | Verify and converge | QA | Full suite, once; run-it and `scripts/converge.py NNNN` (§7.7) | `RC-VERIFIED`; full suite green; every AC met | — |
| 3 | AI pre-review | Reviewer, as an independent subagent | `review.md` | `RC-REVIEWED` | — |
| 4 | Pull request | Runner | Body from `scripts/pr-body.py NNNN` | CI green | — |
| 5 | Human code review | **Code Owner** | PR approval | — | **G5** |
| 6 | Merge | **Code Owner** | Merged; change folder frozen | — | — |

**Upstream approved, by change type:** new-project walking skeleton — G3 and G4 Approved, *Skeleton criteria* in `plan.md` · new project's first slice — spec Approved, G3 Approved, skeleton merged · feature — spec Approved, design verdict recorded (G3 Approved if Significant) · bug — `bug.md` *Triage* names the source of expected behavior · refactor — invariants written as ACs in `plan.md` · G3 Approved wherever it was triggered.

**Capability views (Stage 2).** `scripts/converge.py` rebuilds the views of the capabilities the spec or `bug.md` declares; commit them with `Refs: NNNN`. It is a tool run, not a task; `scripts/pr-body.py` flags a view left stale.

**Merge (Stage 6).** The commit that records G5 touches only the approval record of code CI already passed; merge without waiting for CI to rerun on it, unless branch protection requires it.

## 3. Task loop (stage 1)

```text
for each task in dependency order:
    load     → the task block, the criteria it covers, the contract and design sections it touches
    implement within the task's scope
    verify   → targeted tests of the changed files, build, lint (non-interactive, under timeout) + task checks
    if red   → diagnose, fix, verify; escalate when the convergence budget is spent
    never    → skip/disable tests, weaken assertions, add suppressions, edit an Approved artifact to fit
    review   → read the task's own diff (below)
    commit   → "Refs: NNNN-T#"; mark the task Done with its evidence
```

**Self-review before commit:** every changed line is inside the task's scope; every covered criterion has evidence; nothing unrelated changed. An out-of-scope edit is reverted and recorded as a follow-up. Code that contradicts an approved criterion outside the task is neither fixed nor edited away: record it in the task's Status as a suspected code defect or a suspected outdated criterion, and a human decides (`.ai/policies/autonomy.md` §7 rule 11).

**Parallel tasks.** Independent tasks whose scopes do not overlap may run as parallel subagents once `RC-CONTRACT` is met. The handoff names the task block, the contract (or "no cross-layer contract affected"), the artifact language, and the exit criteria (§5).

**Budgets.** A task has 20 minutes. A command with no output for 5 minutes is checked, terminated if hung, and reported. Over budget: stop and report state, blocker, and recommendation.

## 4. Readiness checks

A readiness check is binary and evaluated by an agent; it is not a Human Gate.

### 4.1 `RC-CONTRACT` — contract exists for cross-layer work

Applies when a task spans layers, adds an API, changes a shared payload or persistence shape, or depends on an unclear data contract. **Met** when a concrete contract exists under `docs/architecture/openapi/`, `diagrams/`, or `adr/` (or a stronger repository convention) and the task names it. Not met: return to the Architect role; implementation does not guess.

### 4.2 `RC-TESTLEFT` — test scenarios exist when triggers apply

Applies when a test-left trigger applies (`.ai/workflows/new-feature.md` §4). **Met** when `test-plan.md` has scenarios for happy path, edge cases, invalid input, and regression, explicit enough to implement against. Not met: the triggered tasks wait.

### 4.3 `RC-VERIFIED` — every AC has passing evidence

**Met** when `scripts/trace.py` shows a test for every AC and none failing (or an approved manual verification is recorded), the full suite is green, and the run-it and converge records of §7.7 are written.

### 4.4 `RC-REVIEWED` — no unresolved blocking finding

Applies once `RC-VERIFIED` is met. **Met** when `review.md` says `READY` or `READY WITH SUGGESTIONS`, or a human override of `CHANGES REQUIRED` is recorded. Not met: findings return to the implementing role (§6).

### 4.5 `RC-CONSISTENT` — the artifacts agree before code

- **Applies to** C3 and C4, and to any change whose spec or `bug.md` has a `Supersedes:` or `Revokes:` line. N/A otherwise.
- **Met when** the plan's *Consistency check* records a run on the current plan with no open blocking finding. A finding closes by fixing the named artifact or by a human decision recorded beside it.
- **How:** `/analyze <change>` runs `python3 scripts/analyze.py <change> --write` while `plan.md` is Draft — before the G4 request, or before Stage 0 when G4 is not triggered. It writes only the *Consistency check* section; exit 1 means an open blocking finding. Agents do not repeat the checks by reading the artifacts.

  | ID | Blocking | Finding | Script decides |
  |----|----------|---------|----------------|
  | A1 | Yes | An AC, invariant, or expected behavior with no task | Every criterion appears in some task's *Covers* (ranges such as `AC1–AC5` count) |
  | A2 | Yes | A task that covers no AC and is not an `Enabler` with a reason | As stated; also a task covering an AC the spec does not define |
  | A3 | Yes | A plan decision absent from approved artifacts | The spec is not Approved; an L3 task has no approval reference; a task cites a missing ADR |
  | A4 | Yes | A cross-layer task without its contract | A task scope spans two top-level code folders or `docs/architecture/openapi/` while `RC-CONTRACT` is not Met |
  | A5 | Yes | A current criterion the change contradicts but its *Baseline* omits | A `Supersedes:`/`Revokes:` target missing from *Baseline* or with another disposition; a *Baseline* row that is not current; an empty *Baseline* for a capability with current criteria |
  | A6 | Yes | A plan step that breaks `AGENTS.md` or a profile | A task block missing a field of `AGENTS.md` §8; an owner that is not a role; a risk outside L1–L3; a dependency on an undefined task |
  | N1 | No | One concept named differently | *Task table* and task block disagree on title, owner, risk, or coverage |
  | N2 | No | A *Done when* that is not binary | A vague word such as "properly" or 「適當」 |
  | N3 | No | Overlapping scopes without a dependency | As stated |
  | N4 | No | A test-left trigger with no recorded decision | `RC-TESTLEFT` has no result |

  What the script cannot decide stays with the G4 approver and the Reviewer.

## 5. Handoffs

Only parallel tasks and the C3/C4 pre-review leave the session (`AGENTS.md` §3). A handoff names the role, objective, inputs (task block, contract or "no cross-layer contract affected", artifact language), blocked assumptions, and exit criteria. The Reviewer is told the implementing role, so findings return to it.

## 6. Rework loops

Review findings go back to the implementing role, then the delta is re-verified and re-reviewed — at most **2** cycles before escalating to the Technical Owner. Human G5 comments are handled the same way; agents may push fix commits but never dismiss or resolve a human's comment.

## 7. Rules for every workflow

### 7.1 Runner

The session that starts a workflow is its *runner*. It derives the current stage from the artifacts (§7.2), takes on each stage's role in turn (`AGENTS.md` §3–§4), checks entry and exit criteria, and **stops at every Human Gate**. It owns no artifact and makes no decision; in each role it owns what that role owns. A tool's plan mode, todo list, or subagent feature may mirror an artifact or a gate, never replace it.

**Language.** At the first stage the runner reads *Artifact language* from `docs/project.md` and uses it for every artifact and every message to the human, including gate requests; a bare slash command does not change it. Identifiers stay as defined: headings, Status values, gate and verdict names, IDs.

**Gate requests** end with a one-line reply example, such as `Reply "G2 approved", or name what to change.` A one-line approval is enough; the runner records it with `scripts/approve.py` and continues.

### 7.2 Resume from artifacts

The runner never relies on chat history:

| Folder state | Stage |
|--------------|-------|
| `change.md` present, or a Cosmetic branch | Quick track (`.ai/workflows/quick.md` §7) |
| `spec.md` Draft or Proposed | Specification / awaiting G2 |
| `spec.md` Approved, no design verdict | Impact analysis |
| `design.md` Significant, not Approved | Awaiting G3 |
| `plan.md` Draft or Proposed | Planning / awaiting G4 |
| `plan.md` Approved (or G4 not triggered), open tasks | Task loop |
| All tasks Done, no `review.md` (C3/C4) | Verify, converge, review |
| PR open | Awaiting G5 |
| PR merged | Done; waiting for a release |

Otherwise the stage is the first in the workflow's table whose exit criteria are not met.

### 7.3 Proportionality and change control

Templates mark sections *Core* or *Conditional*; a Conditional section that does not apply is left out (`AGENTS.md` §7). A small change keeps every Core section and writes it short. Change control after approval: `.ai/policies/artifacts.md` §5.4.

### 7.4 Cancellation

An approver can cancel a change at any point. The runner marks its artifacts *Cancelled* with the reason and closes the branch.

### 7.5 Waived gates

Where a workflow requires a waivable gate (G1, G3, G4, G6), a waiver recorded by that gate's approver in the artifact's Approval table satisfies it, including in §7.2. G2, G5, and G7 cannot be waived.

### 7.6 Change assessment

Before any workflow starts, the runner sizes the request against `AGENTS.md` §3 and `.ai/policies/autonomy.md` §10, reading `docs/project.md`, the code involved, and the capability views it touches (`scripts/capability-views.py baseline <capability> --from NNNN` where no view exists — a missing view never raises the size). It writes nothing yet.

- **C1 or C2:** the assessment is the opening message of `.ai/workflows/quick.md` §3 step 2 — size, impact, and the ACs together, answered once.
- **C3 or C4:** propose size, impact (layers, modules, contracts, data), whether an approved spec is superseded or revoked, and the workflow with its gates; wait for the Product Owner or Technical Owner.

```text
Change assessment: "add bulk case import"
Size:      C3 Feature — new capability; existing architecture; no contract break expected
Impact:    case module (frontend, backend); new upload endpoint (additive)
Spec:      new spec; no approved AC superseded
Proposal:  new-feature — Specify → Clarify → G2 → design → Plan → implementation → G5
Reply "OK", or name the size or workflow to use instead.
```

A bare workflow command confirms the workflow, not the size. If unsure, size up; sizes move down only with the human who confirmed them.

### 7.7 Run it and converge

Before the PR of every change (`AGENTS.md` §10):

1. **Run it.** Exercise each user-visible AC through the real interface — browser, HTTP call, CLI — and record what was done and observed. A change with no user-visible behavior says so.
2. **Trace and views.** `python3 scripts/converge.py NNNN` writes the trace table, rebuilds the declared capability views, and lists the changed files — flagging any outside every task *Scope* — and commits without `Refs:`. A trace gap is fixed before going on.
3. **Converge.** Load only the AC IDs and titles and the diff against the main branch. Mark each AC *met*, *partial*, or *missing*, and list changed files no task or impact scope named as *unrequested*. Partial or missing becomes a new task (Standard) or returns to the loop (Quick); unrequested work is reverted or justified. Record the result in `test-plan.md` *Results* (or `change.md` *Convergence*).
