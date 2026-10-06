# Git Policy

## 1. Scope

This policy details `AGENTS.md` §12 (Git rules). `AGENTS.md` takes precedence over this file. The autonomy levels for git actions are the Git rows of `.ai/policies/autonomy.md` §6. This policy does not add a level. The trace from requirement to commit is `.ai/policies/artifacts.md` §7; the git forms of that trace are §2 and §3 below.

## 2. Branches

One change has one branch. The name is a prefix plus the change id:

| Kind of change | Branch |
|----------------|--------|
| Feature, including a new project's change `0001` | `feat/NNNN-<slug>` |
| Bug fix | `fix/NNNN-<slug>` |
| Refactor | `refactor/NNNN-<slug>` |
| Other change | `chore/NNNN-<slug>` |

`AGENTS.md` §12 names `chore/`. This policy does not add a workflow for it.

The main branch is the one `docs/project.md` names. Push only to the change branch.

The runner creates the change branch when it creates the change folder, at the start of the workflow, so the branch exists before implementation. Preparing that branch before a gate is the preparation `.ai/gates/g4-plan.md` allows. It is not execution of a task.

A spike is a separate branch. It exists only when a human asked for it, it is thrown away, and it is never merged (`.ai/gates/g3-architecture.md`).

A project may record a branch-name exception in the Conventions of `docs/project.md`. The exception is that project's. It is not a second rule in this policy.

When two branches take the same change number, renumbering follows `.ai/policies/artifacts.md` §6. This policy does not restate it.

## 3. Commits

### 3.1 Task commits

A commit that implements a task carries the trailer `Refs: NNNN-T#`.

### 3.2 Planning commits

A commit that records planning artifacts, and does not implement a task, carries the trailer `Refs: NNNN`: the change number, with no task id. Planning artifacts include the change's discovery, spec, design, architecture records, ADRs, plan, bug report, test-plan scenarios, review, and the project-profile edits that belong to the change. The commit of an artifact submitted to a gate is one of these, and it is made before the approval is recorded (§4).

`AGENTS.md` §12 requires `Refs: NNNN-T#` on every commit. It does not describe `Refs: NNNN`. The Code Owner accepted this form at G5 of PR #8. `AGENTS.md` §12 is unchanged; this section is the form.

### 3.3 Merge into the main line

The merge message carries `Refs: NNNN` and the list of the change's tasks. `AGENTS.md` §12 does not describe this form. The Code Owner accepted this form at G5 of PR #8. `AGENTS.md` §12 is unchanged; this section is the form.

## 4. Who commits

An agent that has `vcs` commits and pushes its own work on the change branch only. When one session runs the workflow (`AGENTS.md` §3), it commits each artifact in the role that owns it, within the limits below.

**Explicit exception.** The runner may commit an artifact whose owner agent has no `vcs`:

| Owner without `vcs` | Artifacts the runner may commit |
|---------------------|---------------------------------|
| PM Agent | `discovery.md`, `spec.md` |
| Architect Agent | `architecture.md`, `design.md`, ADRs, contracts, the Technical context section of `discovery.md` |
| Tech Lead Agent | `plan.md`, `bug.md`, `docs/project.md`, the pull-request description |
| Reviewer Agent | `review.md` |

The exception has two limits:

1. The commit is on the change branch only. The runner does not commit product code, and does not commit to the main branch. The exception does not add `vcs` to those agents.
2. The commit of the artifact happens before the approval is recorded. The runner commits the artifact, the human reviews that commit, and the Approval table's Version is that commit's SHA. The runner records the approval only after that, and commits the record on the change branch afterwards.

## 5. History

Do not commit to the main branch, merge into it, or force-push it. Do not rewrite shared history (`AGENTS.md` §12; `.ai/policies/autonomy.md` §5, rule 4).

Once a change branch has been pushed, or a human has been asked to review a commit on it, an agent does not amend, rebase, or force-push that branch.

At G5 an agent also does not dismiss or resolve a human's comment, force-push away review history, or widen scope (`.ai/gates/g5-pull-request.md`). An agent may push fix commits for review comments.

Merge into the main branch is the Code Owner's act. Its level is the Git row of `.ai/policies/autonomy.md` §6. An agent carries out the merge only on an explicit instruction after that approval.

Closing a branch when a change is cancelled is the runner's step in `.ai/workflows/implementation.md` §7.4. Closing is not a force-push and not a merge to the main branch.

## 6. Pull requests

Open the pull request from `.ai/templates/pull-request.md`. The title form is the PR row of `.ai/policies/artifacts.md` §7.

The executor adapter copies that template to the hosting platform (§8). The pull request is ready for G5 when the stage exit in `.ai/workflows/implementation.md` is met; this policy does not restate the workflow.

## 7. Tags

The release tag is part of close (`.ai/workflows/release.md` stage 9). The DevOps Agent creates it only after a recorded G7 approval, pointing at the commit that approval names. No other agent creates it.

This is an exception to the change-branch limit in §4 and in the DevOps Agent's `vcs` scope. It allows no other write on the main branch. The Code Owner's merge (§5) is the other.

`.ai/policies/autonomy.md` assigns no level to creating a release tag. This policy assigns none either.

## 8. Team option

Where the main branch is protected, an agent cannot merge into it (§5).

A project may record approvals as pull-request reviews. `.ai/policies/artifacts.md` §5.2 is the rule for the approval record: each gated artifact is submitted in its own pull request, and the Approval row links to the human's review. This section adds the git conditions. Branch protection is in place, and the platform's code-owner rules map the human owner roles to paths. A project where one person holds every owner role is not required to use this option.

The executor adapter installs `.ai/templates/pull-request.md` onto the hosting platform. The platform path is part of the adapter's install steps, not of this policy.
