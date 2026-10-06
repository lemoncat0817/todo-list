# Project Profile: `<project name>`

| Field | Value |
|-------|-------|
| Change | N/A — project-level artifact |
| Status | Draft · Proposed · Approved · Rejected · Superseded · Cancelled |
| Owner | Tech Lead Agent |
| Approver | Technical Owner (G1) |
| Upstream | `<intake answers; docs/discovery.md>` |

<!-- Purpose: The framework configuration for this project: stack, profiles, owners, environments, commands.
     Not in this artifact: secrets, credentials, or URLs carrying tokens; requirements; architecture rationale; tasks.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Identity

- **Name:** `<project name>`
- **Type:** `<web app, internal tool, API service, …>`
- **Repository layout:** `<directories and what each holds>`

## Business context summary

<!-- The problem, users, and goals in brief, with a link to discovery.md. -->

`<summary>`

## Owners

| Role | Held by |
|------|---------|
| Product Owner | `<person>` |
| Technical Owner | `<person>` |
| Code Owner | `<person>` |
| Release Owner | `<person>` |
| Security Owner | `<person, or N/A — reason>` |

## Stack and active profiles

| Area | Technology | Version | Profile |
|------|------------|---------|---------|
| Frontend | `<framework>` | `<version>` | `<profile>` |
| Backend | `<framework and language>` | `<versions>` | `<profile>` |
| Database | `<database and migration tool>` | `<versions>` | `<profile>` |
| Infrastructure | `<hosting and CI>` | `<versions>` | `<profile>` |

## Environments

| Environment | Purpose | Who may deploy |
|-------------|---------|----------------|
| dev | `<…>` | `<…>` |
| test | `<…>` | `<…>` |
| UAT | `<…>` | `<…>` |
| prod | `<…>` | `<…>` |

## Verification commands

<!-- One row per application. Targeted: the unit command limited to named test files, run during work (AGENTS.md §10); the full commands run before the PR or in CI. -->

| Application | Build | Lint | Unit | Targeted unit | Integration | E2E |
|-------------|-------|------|------|---------------|-------------|-----|
| `<application>` | `<command>` | `<command>` | `<command>` | `<command with a file placeholder>` | `<command>` | `<command>` |

## Conventions

- **Main branch:** `<branch>`
- **Change IDs:** `<format and first number>`
- **Artifact language:** `<language per artifact type>`

## Autonomy adjustments

<!-- Autonomy levels raised for this project, and convergence-budget settings; or "None — framework defaults apply". -->

`<adjustments>`

## External systems

| System | Purpose | Access |
|--------|---------|--------|
| `<system>` | `<…>` | `<configuration reference; no credential values>` |

## Framework version

`<installed framework version>`

## Change log

- `<YYYY-MM-DD>` — `<what changed>`

## Approval

<!-- One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
