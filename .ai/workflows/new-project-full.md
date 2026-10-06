# Workflow: new-project — Full track

## 1. Scope

The Full track of `.ai/workflows/new-project.md` (`AGENTS.md` §3): every gate G1–G4 stops on its own, for a project that is large, cross-team, regulated, or security-sensitive (`.ai/workflows/new-project.md` §1). `AGENTS.md`, `.ai/policies/`, and `.ai/gates/` take precedence over this file. Rules for every workflow are in `.ai/workflows/implementation.md` §7; one session runs every stage in the named role, and a Conditional template section that does not apply is left out.

| Field | Value |
|-------|-------|
| Purpose | Take an empty repository to an approved, executable first plan before generating application code |
| Ends when | G4 approved; hands over to `implementation` for the walking skeleton (`.ai/workflows/new-project.md` §3) |

## 2. Intake form

| Field | Required | Who supplies it | Rule |
|-------|:--------:|-----------------|------|
| Project name | ✓ | Human | — |
| Project type (web app, internal tool, API service…) | ✓ | Human | — |
| Business context: problem, users, goals | ✓ | Human | Never invented by an agent |
| Initial requirements (free text is fine) | ✓ | Human | Never invented |
| Constraints: deadline, budget, compliance, mandated standards | ✓ | Human | "None known" is a valid answer |
| Frontend (framework and version) | ✓ | Human | Agent may *propose* from profiles, marked `(proposed)` |
| Backend (framework, language, and versions) | ✓ | Human | May be proposed |
| Database and migration tool | ✓ | Human | May be proposed |
| Infrastructure: hosting, CI, environments | ✓ | Human | May be proposed |
| Repository layout (monorepo `frontend/` + `backend/`, or separate) | ✓ | Human | Proposed default: monorepo |
| Human owners: Product, Technical, Code, Release, (Security) | ✓ | Human | One person may hold several roles |
| Artifact language | | Human | Per-project setting in `project.md` |
| Existing assets: designs, legacy systems, documents | | Human | — |

Intake rules: missing fields are requested **in one consolidated question**, not one at a time; nothing except `docs/project.md` is written during intake.

**Recommended defaults.** The consolidated question pre-fills every field an agent may propose, marked `(proposed)`, so the human confirms or overrides only what differs. Fields marked *Never invented* stay blank. Example for the profiles shipped with the framework:

```text
Frontend:          Angular, standalone components — version: confirm      (proposed)
Backend:           Spring Boot, Java LTS — versions: confirm                (proposed)
Database:          PostgreSQL with the project's migration tool            (proposed)
Infrastructure:    Docker Compose locally; CI on the repository host;
                   environments: dev, test — no production yet             (proposed)
Repository layout: monorepo frontend/ + backend/                           (proposed)
Owners:            you hold all five owner roles                           (proposed)
Artifact language: the language of this conversation                      (proposed)

Reply "defaults OK", or list only the lines to change.
```

## 3. Stages

The stage table uses: **Owner** = the role accountable for the output · **With** = contributing roles · **Exit** = binary criteria. Human Gates are defined in `.ai/gates/`; readiness checks (`RC-*`) in `.ai/workflows/implementation.md` §4.

| # | Stage | Owner | With | Output | Exit | Gate |
|---|-------|-------|------|--------|------|------|
| 1 | Intake | Runner | — | `docs/project.md` (Draft) | All required fields answered or marked *unknown — owner: X*; artifact language recorded (`implementation.md` §7.1) | — |
| 2 | Discovery | PM Agent | Architect Agent (technical context, constraints, risks) | `docs/discovery.md`, `project.md` → Proposed | Template complete; open questions resolved or deferred with an owner | **G1** |
| 3 | Specification | PM Agent | Architect (feasibility), QA (testability) | The first business slice's `spec.md` Draft, numbered after the skeleton change | WHAT only: technical details moved to *Deferred technical notes*; ACs in Given/When/Then (`new-feature.md` §7) | — |
| 4 | Clarify | PM Agent | Product Owner answers | *Clarifications*; spec updated; → Proposed | Every question answered, or recorded as an open question or assumption with an owner (`new-feature.md` §6); G2 checklist self-checked | **G2** |
| 5 | Architecture | Architect Agent | Tech Lead (buildability), DevOps (deployment view), QA (test strategy draft) | `architecture.md`, ADRs, first API contract, diagrams; intake stack and deferred technical notes evaluated | G3 checklist self-checked | **G3** |
| 6 | Plan | Tech Lead Agent | QA (`test-plan.md`), Architect (consulted) | The skeleton's `plan.md` (`.ai/workflows/new-project.md` §3); the slice's `plan.md` and `test-plan.md` | Every AC and skeleton criterion covered by a task | **G4** (always for a first plan) |
| 7 | Hand-over | Runner | — | — | Runner announces `/implement` for the skeleton change | — |

**Clarify in a new project.** Clarify runs as in `.ai/workflows/new-feature.md` §6, after G1: discovery has framed the problem, so questions target what `spec.md` still leaves open — lifecycle, roles and permissions, state sets, required data, error behavior. The stack captured at intake belongs to `project.md` and the Architecture stage, never to the spec.

**Exit conditions:** G1–G4 approved; `project.md` Approved; no open blocking question; the skeleton change ready for `implementation`.
