# Workflow: new-project

## 1. Scope

Start a project under the framework (`AGENTS.md` §3). `AGENTS.md`, `.ai/policies/`, and `.ai/gates/` take precedence over this file; rules for every workflow are in `.ai/workflows/implementation.md` §7, read when a stage needs them.

| Field | Value |
|-------|-------|
| Command | `/new-project [idea]` |
| Human stops before code | Lean: 2 · Full: 4 or more · Adopt: 1 |
| Ends when | Lean and Full: the skeleton's G5, then the first slice runs `implementation`. Adopt: G5 of the adoption |

**Mode.** Run `python3 scripts/adopt.py --check`. Exit 0 — the repository already has code: follow `.ai/workflows/new-project-adopt.md`. Exit 1: a new project; choose the track.

**Track.** Lean unless **any** of these holds, then Full (`.ai/workflows/new-project-full.md`): more than one epic, or an MVP that needs more than 10 ACs and cannot be cut thinner; more than one team; regulated, personal-data, or security-sensitive scope; more than about 20 working sessions expected. The runner proposes the track in the opening; the human confirms it. A track only moves up — to Full at any stop, continuing from the artifacts already approved.

## 2. Lean track

### Stop 1 — the opening: G1 and G2 in one reply

Read only this file before the opening. One message, in the conversation's language:

```text
New project: "lunch-board" — Lean (one product, one team, MVP ≤ 10 ACs)
Problem:   <the operator's own words: problem, users, goals>
Profile:   name lunch-board · type web app · language 繁體中文 ·
           owners: you hold all five roles (proposed) · stack: decided at stop 2
MVP slice: AC1 Given an open lunch round, When a member submits an order, Then it is listed
           AC2 …                                     (at most 10 ACs, Given/When/Then)
Out of scope: payments, multiple rounds per day
Q1:        Can a member edit an order after submitting? A. until the round closes  B. never
           Recommended A — matches how orders change in practice
Reply "OK" (or "OK, Q1 B"), or name what to change.
```

- Problem, users, goals, and requirements come from the operator, never invented. A missing one is asked in this message or marked `TODO(Product Owner)`; the opening does not wait on a field the MVP does not need.
- Proposable fields carry `(proposed)`. The stack is not asked here; technology the operator mentions is kept for stop 2, as in `.ai/workflows/new-feature.md` §7.
- 3–5 questions, each with lettered options and a recommended default, about behavior only (`.ai/workflows/new-feature.md` §6).
- When the Product Owner and the Technical Owner are different people, the opening goes to both: the Product Owner answers for the problem and the slice, the Technical Owner for the profile.

**On the reply:**

1. `python3 scripts/new-change.py walking-skeleton --type feat --artifact none` — the skeleton change takes the first number and the branch that carries the planning records.
2. Write `docs/project.md` from `.ai/templates/project.md` and commit with `Refs: <skeleton number>`.
3. `python3 scripts/new-change.py <slice-slug> --type feat --artifact spec --no-branch`; write the slice's `spec.md` with exactly what was confirmed, applying the answers, and commit. `discovery.md` is written only when the request is ambiguous or cross-team; then it waits for G1 on its own.
4. Record both gates: `python3 scripts/approve.py - docs/project.md G1 --by "<approver>"` and `python3 scripts/approve.py <slice> spec.md G2 --by "<Product Owner>"`. An answer that widens scope goes back to the opening.

### Stop 2 — the build proposal: G3 and G4 in one reply

1. **Design.** Propose the stack from the operator's notes and the installed profiles, each choice marked `(proposed)` with its reason. Write `docs/architecture/architecture.md` (Core sections), an ADR per significant choice, and the first contract when the slice crosses layers.
2. **Plan.** The skeleton's `plan.md`: its tasks and its *Skeleton criteria* (§3). The slice's `plan.md`: every AC covered by a task; `python3 scripts/analyze.py <slice> --write`.
3. **Request.** One message with two parts, each with its decisions and its self-check against `.ai/gates/g3-architecture.md` and `.ai/gates/g4-plan.md`, L3 items listed together (dependencies, data, security), and `Reply "OK" for G3 and G4, or approve one and name what to change in the other.`
4. **Record** each approved gate with `scripts/approve.py`: G3 on `architecture.md`, G4 on each plan. Commit.

### Then

Implement the skeleton (`.ai/workflows/implementation.md`) and open its pull request; the planning records go with it. After its G5, branch the slice from the main branch and run `/implement <slice>`.

## 3. Walking skeleton

Its own change, before any business slice, so the first pull request proves the toolchain and every later task builds on a deployable baseline. Its tasks create the repository structure, build, CI pipeline, a health endpoint, and one thin path through every layer of the chosen stack. Its *Skeleton criteria* in `plan.md` are technical and observable — for example `AC1` GET /health returns 200, `AC2` CI passes on the pull request — and its tests carry their qualified IDs like any AC.

**Repository basics:** the skeleton also delivers, and its *Done when* lists:

- a root `README.md` — what the project is, how to run it locally, the verification commands, and links to `AGENTS.md` and `docs/project.md`;
- a root `.gitignore` covering the stack's build output, IDE and OS files, and local environment files such as `.env`;
- a `.env.example` naming every environment variable the run configuration reads, with placeholder values and no secrets.

## 4. Resume

| State | Next |
|-------|------|
| No `docs/project.md` | §1 mode and track, then the opening |
| `project.md` and the slice `spec.md` without their approvals | Awaiting the opening reply |
| Both approved, no `architecture.md` | Stop 2 |
| `architecture.md` or a plan awaiting G3 or G4 | Awaiting the build-proposal reply |
| G3 and G4 recorded | Implement the skeleton (`/implement <skeleton>`) |
