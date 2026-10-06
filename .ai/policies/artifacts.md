# Artifact Policy

## 1. Scope

This policy details `AGENTS.md` §7 (Artifact rules). `AGENTS.md` takes precedence over this file. It defines where artifacts live, the status vocabulary, how human approvals are recorded, the ID scheme, and the links that trace work from requirement to release.

## 2. Locations and lifecycle

| Artifact | Location | Lifecycle |
|----------|----------|-----------|
| Project profile | `docs/project.md` | Living |
| Project discovery | `docs/discovery.md` | Living |
| Architecture | `docs/architecture/architecture.md` | Living |
| API contracts | `docs/architecture/openapi/` | Living |
| Diagrams | `docs/architecture/diagrams/` | Living |
| Decision records | `docs/architecture/adr/ADR-NNNN-<slug>.md` | Append-only: never edited after approval; superseded by a new ADR |
| Change folder | `docs/changes/NNNN-<slug>/`. Quick track: `change.md` only for C2; none for C1, whose request and evidence live in the PR description. Standard and Full (C3, C4): `spec.md` or `bug.md`, `plan.md`, `test-plan.md`, `review.md`; `design.md` for a Minor or Significant verdict; `discovery.md` when a feature runs discovery | Frozen once the change is merged |
| Pull request description | On the hosting platform; its template is installed by the executor adapter | Frozen once the change is merged |
| Release record | `docs/releases/<version>.md` | Closed after post-release verification |
| Change index | `docs/changes/INDEX.md` | Append-only: one row per change, written when a release archives it |
| Capability view | `docs/specs/<capability>.md` | Living, non-authoritative, generated: `scripts/capability-views.py` rebuilds it from the change specs in the PR of every change that alters the capability's criteria (§12) |

- A feature change has `spec.md` and a bug fix has `bug.md`; a refactor states the invariants it must preserve as ACs in its `plan.md`; a Quick change holds its intent, ACs, and evidence in `change.md` (`.ai/workflows/quick.md`).
- Living artifacts change only through approved changes: `architecture.md` is updated in the same PR as the change whose `design.md` requires it; ADRs are appended; contracts evolve with the code.
- *Frozen*, *closed*, and *archived* describe an artifact's lifecycle. They are not Status values (§4).

## 3. Content rules

- Create every artifact from its template and keep the headings of the sections you keep; agents and reviewers navigate by them.
- **Core and Conditional sections.** Each template section is marked in its comment. A *Core* section is always present, written as short as the change allows. A *Conditional* section is present only when its condition holds; otherwise it is deleted, not answered `N/A`. A template without markers has only Core sections. The gate approver may ask for a deleted section.
- Secrets, credentials, and URLs carrying tokens: `.ai/policies/security.md` §2.
- A decision that is not in an artifact does not exist; the agent transcribes it (§5) or asks the human to.

## 4. Statuses

| State | Meaning | Who sets it |
|-------|---------|-------------|
| `Draft` | Being written | Owner agent |
| `Proposed` | **AI-generated recommendation**, submitted for a gate | Owner agent |
| `Approved` | **Human-approved decision** — downstream work may rely on it | Human approver only |
| `Rejected` | Not accepted | Human approver only |
| `Superseded` | Replaced by a later approved artifact | Owner agent, referencing the replacement |
| `Cancelled` | Work stopped by the approver | Human approver (an agent may record it) |

- These six values are the only Status values: `Draft → Proposed → Approved | Rejected`, later `Superseded`; or `Cancelled`.
- A plan for which G4 is not triggered, and `review.md` and `bug.md`, reach no gate, so this definition of Proposed does not say which Status they take. Which value they reach is left to the pilot.
- Every gated artifact starts with the same header and ends with the same approval block (§5.2), so status and approval can be found the same way everywhere.
- **`Archived` is a lifecycle state of a change folder, not a Status value.** A release sets it at Stage 9 (`.ai/workflows/release.md` §4) by adding the change to `docs/changes/INDEX.md` with the release version; artifact headers keep their Status. It marks the change as shipped, so agents can leave the folder out of broad context searches. It never hides current truth: an archived criterion that nothing supersedes still applies (§9).
- A change can be cancelled by its approver at any point; its artifacts are then marked `Cancelled` with the reason. Nothing is deleted — cancelled work is part of the audit trail.

Inside artifacts the same split is visible: ADRs have a **Recommendation** section (agent) and a **Decision** section (human); `review.md` reports `READY`, never "approved"; `release.md` has an agent **readiness verdict** and a human **release decision**.

## 5. Approval records

### 5.1 Rules

1. **Only a human approves.** An agent never writes an approval on its own initiative, and never uses approval language ("approved", "LGTM", "accepted") about its own or another agent's work.
2. **Transcription is allowed, invention is not.** When the approver states a decision explicitly in the session, the agent may write it into the artifact's Approval table and must note that it recorded it at the approver's instruction. `scripts/approve.py` writes the row, the note, and the Version.
3. **An approval binds to a version.** The Version column holds the commit SHA of the artifact the human reviewed. A material change after that commit voids the approval (§5.4).
4. **The record is committed.** Git history of the Approval table is the audit trail.

### 5.2 Approval table

```markdown
## Approval
| Gate | Outcome                  | Approver        | Date       | Version | Conditions |
|------|--------------------------|-----------------|------------|---------|------------|
| G2   | Approved with conditions | <name> (Product Owner) | 2026-10-03 | 4f2a9c1 | AC5 wording to be confirmed with Support before G5 |
```

**Default:** the Approval table and the commit that records it.

**Team option:** where branch protection exists, put gated artifacts in their own PR; the human's PR approval is the record and the Approval row links to it. This gives platform-enforced identity at the cost of one extra PR per gate.

**Small teams:** one person may hold every owner role; `docs/project.md` records who holds which. The framework still requires the **moment** (stop, read, decide) and the **record**. A one-line "approved" in chat, transcribed per §5.1, is enough for a small change.

### 5.3 Gate outcomes

| Outcome | Effect |
|---------|--------|
| **Approved** | Status → `Approved`; the workflow continues |
| **Approved with conditions** | Continues; each condition is recorded with an owner and must be closed by the gate named in the condition (default: before G5) |
| **Changes requested** | Status → `Draft`; the owner agent revises and resubmits |
| **Rejected** | The change is cancelled, or returned to an earlier stage the approver names |
| **Waived** | Only for waivable gates, only by that gate's approver, recorded with reason in the Approval table |

Which gates may be waived: `AGENTS.md` §6.

A waiver recorded by the gate's approver satisfies a workflow requirement that the gate be approved (`.ai/workflows/implementation.md` §7.5). This table gives Waived no Status effect. Whether Status changes is left to the pilot.

### 5.4 Material and editorial changes

- **Material change** to an Approved artifact (scope, AC meaning, contract, data model, risk level) → the artifact returns to *Proposed* and re-enters its gate. Work that depends on it pauses.
- **Editorial change** (typo, formatting, clarification that changes no meaning) → allowed, noted in the artifact's change log, no re-approval.
- **Answers given with an approval.** An answer the approver states together with the approval is part of that decision. The runner transcribes it into the section it decides, and notes it in the change log (§5.1). It is not an editorial change. The approval binds to the commit that contains the answer: if that text was not in the commit the human reviewed, the runner commits it and the human accepts that commit before the Version is written.
- **Quick opening.** On the Quick track (`.ai/workflows/quick.md` §3) the human reviews the opening message, not a commit. The runner commits `change.md` with exactly the confirmed content and the answers given in the reply, and the approval binds to that commit. Any wording the opening message did not show is material and needs a new confirmation.
- When unsure whether a change is material, treat it as material.

### 5.5 Gate request

Every submission to a gate uses the same short message, so the human reviews decisions, not prose:

```text
Gate request: G2 Specification — change 0007-password-reset
Artifact:     docs/changes/0007-password-reset/spec.md @ 4f2a9c1
Decide:       1. Does a reset sign out existing sessions? (recommend: yes — security)
              2. Token lifetime 30 min? (from discovery; confirm)
Assumptions:  A1 email is the only reset channel
Risks:        R3 depends on mail-service availability
Self-check:   9/10 G2 criteria met; open: AC5 wording (see Open questions)
Reply with:   one line, e.g. "Approved. 1 and 2 as recommended." / 「Approved. 同意 1 與 2」
```

On the Quick track the opening message is the gate request for G2 (`.ai/workflows/quick.md` §3 step 2).

The human's reply may be that one line. The runner takes the gate, artifact, and Version from the gate request, transcribes the decision per §5.1, and moves to the next stage; it asks again only when the reply leaves a listed decision unanswered.

## 6. IDs

| ID | Format | Scope | Assigned by | Lives in | Example |
|----|--------|-------|-------------|----------|---------|
| Change | `NNNN-<slug>` (4 digits) | Project | Runner, at workflow start | Folder name under `docs/changes/` | `0007-password-reset` |
| Requirement | `R<n>` | Change | PM Agent | `spec.md` | `R1` |
| Acceptance criterion | `AC<n>` (numbered across the whole spec, not per requirement) | Change | PM Agent | `spec.md`, `bug.md`, `change.md`, refactor `plan.md` | `AC7` |
| Task | `T<n>` | Change | Tech Lead Agent | `plan.md` | `T3` |
| Test scenario | `<CAT>-<nn>` (category code and number) | Change | QA Agent | `test-plan.md` | `EC-02` |
| Decision | `ADR-NNNN` | Project | Architect Agent | `docs/architecture/adr/` | `ADR-0009` |
| Release | Version (SemVer recommended) | Project | DevOps Agent | `docs/releases/` | `1.3.0` |

**Local inside, qualified outside.** Inside a change folder IDs are short (`AC3`, `T2`). Anywhere else — code, tests, commits, other changes, release records — they are qualified with the change number: `0007-AC3`, `0007-T2`.

**Every change has ACs.** A feature's ACs specify new behavior; a bug's ACs specify the corrected behavior (its regression targets); a refactor's ACs specify the invariants it must preserve. One verification unit for every kind of work.

A bug's corrected-behavior ACs are written in the PM role during triage (`.ai/workflows/bug-fix.md` Stage 2), or in the Quick opening message for a Quick defect.

**Change number collisions** (two branches both create `0012-…`) are caught before the PR is opened: the runner checks that the number is still free on the main line and, if not, renumbers its own folder and the IDs in its own files. Commits already on the branch are summarised with corrected references in the merge message.

**Issue trackers.** The change number `NNNN` is the default ID. A team that uses an issue tracker may add an optional `Ticket:` field to the artifact header; the change number remains the ID.

## 7. Links

For any requirement, traceability shows where it was designed, which tasks implemented it, which tests prove it, who reviewed it, and which release shipped it — and the reverse, for any line of code or test. It needs no tooling: text IDs, one-directional links, and `git grep` / `git log`.

```text
Requirement   R1 ──┐                                   docs/changes/0007-…/spec.md
Acceptance    AC1 AC2 AC3                              (unit of verification)
                 │
Design        "Addresses: R1, AC2"                      design.md · ADR-0009
                 │
Plan / Task   T3  "Covers: AC2, AC3"                    plan.md
                 │
Code          commit trailer  "Refs: 0007-T3"            git history
                 │
Test          "0007-AC2: rejects an expired token"       test name / display name
                 │
Verification  trace from scripts/trace.py → PASS           test-plan.md or change.md
                 │
Review        traceability check, converge               review.md or change.md · PR (G5)
                 │
Release       "Included: 0007, 0009, 0012"              docs/releases/1.3.0.md (G6, G7)
```

**One rule: downstream points upstream.** Each link is written **once**, in the artifact created later, pointing at the artifact it serves. Upstream artifacts are never edited to add downstream references, so nothing has to be kept in sync in two places. The reverse direction is a search.

| Where | Must reference | Form |
|-------|----------------|------|
| `spec.md` requirement | The goal it serves | `Rationale: discovery.md#goal-2` |
| `spec.md` superseding AC | The AC it replaces | `Supersedes: 0001-AC4` |
| `design.md`, ADR | Requirements / ACs addressed | `Addresses: R1, AC7` |
| `plan.md` task | ACs covered, sources of truth | `Covers: AC2, AC3` or `Enabler: <reason>` |
| Branch, commits, merge into the main line | The change and its tasks | As defined in `.ai/policies/git.md` §2 and §3 (branch `feat/0007-password-reset`; a task commit's trailer `Refs: 0007-T3`) |
| Automated test | The AC it proves | Qualified ID in the test's name or display name |
| `test-plan.md` scenario | ACs; evidence | `Covers: AC2` · result + test name / CI run |
| PR | The change; trace table | Title `[0007] Password reset` · body from `scripts/pr-body.py` |
| `release.md` | Included changes | `0007` + PR link per change |

How a test carries its AC ID is a profile concern.

## 8. Trace table

Written by `scripts/converge.py NNNN` (or `scripts/trace.py NNNN --write`) at verification time — in `test-plan.md`, or in `change.md` on the Quick track — from the tests that carry each qualified AC ID, with per-test results when JUnit reports are given. `scripts/pr-body.py` copies it into the PR description. It is the single view the Code Owner needs at G5. A manual verification is added as its own row with its evidence.

| AC | Tasks | Tests / scenarios | Result |
|----|-------|-------------------|--------|
| AC1 | T2, T4 | `0007-AC1: user requests a reset link` (automated test), HP-01 (E2E) | PASS — CI #812 |
| AC7 | T2 | EC-02 (Integration) | PASS — CI #812 |
| AC8 | T4 | HP-02 (Manual, screenshot) | PASS — verified by QA Agent, recorded |

A row without a passing result blocks `RC-VERIFIED`.

## 9. Requirements evolve append-only

Approved criteria are never edited after their change merges. A later change that alters behavior writes a **new** criterion that names the one it replaces:

```markdown
AC2  A reset link is valid for 15 minutes.        Supersedes: 0007-AC7
```

A criterion withdrawn with no replacement is **revoked**: the change's spec lists it under *Supersedes and revokes* with the reason, and no new criterion takes its place:

```markdown
- Revokes: 0007-AC9 — cases are no longer exported to the legacy archive
```

- The **current truth** is the set of criteria that no later criterion supersedes or revokes. The capability views (§12) collect it; one search for `Supersedes:` and `Revokes:` confirms it.
- Tests that proved a revoked criterion are removed in the revoking change, citing the `Revokes:` line. The line was approved at G2, which is the approval `AGENTS.md` §10 requires for changing an existing test.
- Tests that proved the old criterion are updated to cite the new one; that test change is L2 because it is traced (`AGENTS.md` §10).

## 10. Checking traceability

For a C3 or C4 change the **Reviewer Agent** runs the check and reports it in `review.md`. On the Quick track the runner's trace and converge records in `change.md` cover forward coverage and scope, `scripts/pr-body.py` reports commit hygiene, and the CI review and the Code Owner at G5 cover the rest:

| Check | Fails when |
|-------|-----------|
| Forward coverage | An AC has no task, or no passing evidence |
| Backward justification | A task covers no AC and is not marked `Enabler` with a reason |
| Scope | A changed file falls outside every task's declared scope |
| Commit hygiene | A commit on the branch has no `Refs:` trailer |
| Supersession | A test was changed or removed without a superseding AC or a `Revokes:` line |
| Capability view | `scripts/capability-views.py check` reports a view stale or missing for a capability this change tags, or a view was edited by hand outside its *Summary* (§12) |
| Risk | An L3 action has no approval reference |

**Typical queries (no tooling needed):**

```text
git log --grep "Refs: 0007-T3"
git grep -n "0007-AC2"
git grep -nE "Supersedes:|Revokes:" -- docs/changes
```

## 11. Integrity of approved artifacts

`scripts/verify-artifact-integrity.sh`, in the framework repository, checks §5.1 rule 3 mechanically. For every tracked `spec.md`, `change.md`, `design.md`, `plan.md`, and `architecture.md` under the given paths (default `docs/`), or under the change folder that `--change <NNNN>` names, it takes the last `Approved` row of the Approval table and diffs the file against the commit in its Version column.

| Result | Means | Exit |
|--------|-------|------|
| `OK` | Since the approved commit, only the header Status row, *Change log*, and *Approval* changed — the edits that transcribing an approval makes. In `plan.md`, also the execution record described below | 0 |
| `FAIL` | Any other line changed, or an `Approved` row has no commit SHA in Version | 1 |
| `UNKNOWN` | The Version is not a commit in this repository at this path, for example after a history rewrite or in copied examples | 0; 1 with `--strict` |

- G4 locks a plan's technical approach, task breakdown, and each task's scope, not its progress. Executing the plan (`workflows/implementation.md` §3) records progress in it, and the check accepts exactly those edits: the Status cell of a *Task table* row whose other cells are unchanged, `- Status:` lines in *Task blocks* (moving `Todo` to `In progress`, `Blocked`, or `Done` with its evidence), the *Deviation log*, and the *Readiness checklist*. Any other change to a task — title, owner, coverage, dependencies, risk, scope, constraints, *Done when*, verification, or an added or removed task — still fails.
- A `change.md` also records execution after its G2 approval: *Notes*, *Verification*, *Trace table*, and *Convergence*. Any other change to it fails.
- During feature work, run it with `--change <NNNN>` (for example `--change 0004` or `--change 0004-export-orders`) to check only the current change, so that legacy artifacts not yet migrated do not block it. An ID that matches no folder under `docs/changes/` is a usage error (exit 2). A release or a full audit still runs it without `--change`.
- The check cannot tell an editorial change from a material one, so it reports both. A material change follows §5.4. An editorial change is confirmed by the gate's approver with a new `Approved` row whose Version is the new commit and whose Conditions say `Editorial: <change log line>`; that row is the new baseline.
- Its output is review evidence: run before the AI review, a `FAIL` becomes a blocking finding in `review.md`. `ai-fw.sh` installs it in the project's `scripts/` with the other framework scripts (§13). Adding it to CI changes a CI check (L3, `AGENTS.md` §14).

## 12. Capability views

A capability view, `docs/specs/<capability>.md` from `.ai/templates/capability-spec.md`, collects the current criteria of one user-facing capability, so that the current truth (§9) takes one read instead of a search across change folders.

- **Not authoritative.** Each criterion is copied verbatim from an approved change spec and links to it. When a view and a change spec disagree, the change spec wins and the view is regenerated (L1). Spec ≠ code checks (`.ai/policies/autonomy.md` §7 rule 11) cite the change spec's criterion, not the view.
- **Capability slugs.** A capability is a user-facing behavior area, such as `case-assignment`, not a module. The header of `spec.md`, `bug.md`, and `change.md` names the capabilities a change touches; the PM Agent proposes the slug and the Product Owner confirms it at G2.
- **Generated, not written.** `scripts/capability-views.py build` writes every view from the approved change specs: a spec's criteria join each capability its *Capabilities* row names, and its `Supersedes:` and `Revokes:` lines move the criteria they name to *History*. No agent copies criteria into a view, and no plan has a task for it. Only the *Summary* is written by hand; the generator keeps it.
- **Updated with the change, off the critical path.** After the last task is Done and before the AI pre-review, the runner runs the generator and commits the result on the change branch with `Refs: NNNN` (`.ai/policies/git.md` §3.2). The view on the main branch stays current, and no task waits for it. A change that alters no criterion — a bug fix restoring specified behavior, a refactor, a C1 change — leaves the views untouched, and the generator writes nothing.
- **Created on first touch.** The first change that tags a capability creates its view. An older spec without a *Capabilities* row joins the view when the tagged spec names one of its criteria in *Baseline*, `Supersedes:`, or `Revokes:`; its criteria that nothing supersedes or revokes become current criteria. The generator prints each change it joined this way, and the PM Agent confirms them in the PR. An older spec the inference misses is named with `--from NNNN`.
- **Baseline.** A spec that changes an existing capability lists, in its *Baseline* section, every current criterion of that capability it touches, with a disposition: Kept, Superseded by `AC<n>`, or Revoked. G2 criterion 7 checks it. `scripts/capability-views.py baseline <capability>` prints every current criterion as a candidate row — add `--from NNNN` for a capability that has no view yet — so the PM Agent keeps the rows the change touches instead of searching the change folders.

## 13. Framework scripts

| Script | Does | Used by |
|--------|------|---------|
| `scripts/verify-artifact-integrity.sh` | Checks that approved artifacts changed only as §11 allows | Reviewer Agent, release |
| `scripts/analyze.py <change> [--write]` | Runs the `/analyze` checks and writes the plan's *Consistency check* (`.ai/workflows/implementation.md` §4.5) | Tech Lead Agent, `/analyze` |
| `scripts/capability-views.py build · check · baseline` | Generates, checks, and seeds the capability views (§12) | Runner, PM Agent, Reviewer Agent |
| `scripts/trace.py <change> [--write] [--junit FILE …]` | Builds the trace table from the tests that carry each AC ID (§8) | Runner, QA Agent |
| `scripts/converge.py <change> [--junit FILE …]` | Converge in one run: writes the trace table, rebuilds the declared capability views, lists changed files and commits without `Refs:` (`AGENTS.md` §10) | Runner |
| `scripts/new-change.py <slug> --type <feat·fix·refactor·chore> [--artifact change·spec·bug·none]` | Takes the next change number free on every branch, creates the branch and the first artifact from its template | Runner |
| `scripts/approve.py <change> <artifact> <gate> --by <approver>` | Transcribes a human gate decision into the Approval table, bound to the reviewed commit (§5.1) | Runner |
| `scripts/pr-body.py <change>` | Assembles the PR description from the change folder | Runner, Tech Lead Agent |
| `scripts/adopt.py [--check]` | Scans an existing codebase for `/new-project` Adopt mode: applications, versions, candidate verification commands, CI, layout | Runner |
| `scripts/status.py [--all]` | Reports where each change waits and its next step, from the artifacts and branches; read-only | Runner, `/status` |
| `scripts/framework_artifacts.py` | The artifact parser the Python scripts share | — |
| `scripts/ai_fw.py` | The installer behind `ai-fw.sh`: init, upgrade, doctor, and `.ai/manifest.json` | `ai-fw.sh` |

- The Python scripts need Python 3.8 or later and no packages. Each run takes under a second.
- `ai-fw.sh` installs and updates these files and lists them in `.ai/manifest.json`; any other file in `scripts/` belongs to the project.
- Running a script is L1. Adding one to CI changes a CI check (L3, `AGENTS.md` §14).

