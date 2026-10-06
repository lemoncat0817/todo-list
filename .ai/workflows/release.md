# Workflow: release

## 1. Scope

This workflow details `AGENTS.md` §3 (Lifecycle) from merged changes to production. `AGENTS.md`, `.ai/policies/`, and `.ai/gates/` take precedence over this file. Rules for every workflow are in `.ai/workflows/implementation.md` §7; one session runs every stage in the named role (`AGENTS.md` §3), and a Conditional template section that does not apply is left out.

| Field | Value |
|-------|-------|
| Purpose | Ship merged changes to production under explicit human authorization, and confirm they work there |
| Command | `/release <version>` |
| Starts with | Merged changes to ship |
| Ends when | Post-release verification complete and the release record closed |

## 2. Stages

The stage table uses: **Owner** = the role accountable for the output · **With** = contributing roles · **Exit** = binary criteria. Human Gates are defined in `.ai/gates/`; readiness checks (`RC-*`) in `.ai/workflows/implementation.md` §4.

| # | Stage | Owner | With | Output | Exit | Gate |
|---|-------|-------|------|--------|------|------|
| 1 | Scope | DevOps Agent | Tech Lead | `docs/releases/<version>.md`: included changes, delivery type (§3), draft release notes, known issues | Artifact language read from `docs/project.md` (`implementation.md` §7.1); delivery type recorded; every included change passed G5 | — |
| 2 | Release candidate → UAT environment | DevOps Agent | — | RC build, UAT deployment log | Pipeline green on the RC | — |
| 3 | UAT preparation | QA Agent | PM | UAT script derived from the included ACs | Every user-facing AC has a UAT step | — |
| 4 | UAT execution | **Business users / Product Owner** | QA records | UAT results in `release.md` | — | **G6** |
| 5 | Readiness | DevOps Agent | QA; Backend for migrations | Readiness checklist with evidence, runbook, rollback plan, **rollback criteria** | Verdict `READY` | — |
| 6 | Release decision | **Release Owner** | — | `GO` / `NO-GO` recorded | — | **G7** |
| 7 | Production deployment | DevOps Agent | — | Deployment log | Runbook completed | — |
| 8 | Post-release verification | DevOps Agent | QA | Smoke results, health and error-rate checks | Within thresholds — or pre-approved rollback executed and reported | — |
| 9 | Close | DevOps Agent | — | Release record closed; tag; notes ready to publish; included changes marked `Archived` in `docs/changes/INDEX.md` (§4) | Publishing to users is a human action unless pre-approved; every included change has an `Archived` row naming this release | — |

## 3. Delivery type

At Stage 1 the DevOps Agent records the delivery type in `release.md`, derived from the Environments section of `docs/project.md`:

| Delivery type | When | Stage 2 | Stage 7 | Stage 8 |
|---------------|------|---------|---------|---------|
| **Service** | `project.md` lists a production environment | As above: RC deployed to the UAT environment | Production deployment | As above |
| **Artifact** | No production environment: a local image, a package, or a Git tag milestone | RC built locally; UAT runs on the local or dev environment recorded in `project.md`, and the UAT Practice says so | `N/A — artifact delivery` | Checks on the built artifact in the environment where it runs |

An Artifact release needs no escalation for the missing UAT or production target. G6 still applies to user-facing changes, and G7 is still required: the Release Owner decides the tag and any publication. If the delivery type is unclear from `project.md`, the DevOps Agent escalates to the Release Owner.

## 4. Archive at close

At Stage 9 the DevOps Agent records each included change as `Archived` in `docs/changes/INDEX.md`, creating the file on the first release. One row per change; rows are appended, never removed:

```markdown
| Change | Title | State | Release | Archived on |
|--------|-------|-------|---------|-------------|
| `0007-password-reset` | Password reset | Archived | `1.3.0` | 2026-10-05 |
```

- Archiving moves nothing and edits nothing inside the change folder: the folder is already frozen (`.ai/policies/artifacts.md` §2), and its links stay valid.
- Agents leave archived folders out of broad searches for context and read them when tracing a requirement, a release, or a `Supersedes:` chain. A criterion in an archived spec that nothing supersedes or revokes is still current truth (`.ai/policies/artifacts.md` §9), and its capability view still lists it (§12).
- A change that was cancelled or not shipped is not archived by a release.
