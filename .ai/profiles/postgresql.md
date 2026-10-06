# Profile: postgresql

## 1. Scope

This profile details `AGENTS.md` §9 (Implementation rules) for PostgreSQL and its migration tool, Liquibase: how they are used in a project. `AGENTS.md` sets the precedence: the constitution, policies, gates, workflows, and agents take precedence over this file. The project's code, configuration, and `docs/project.md` take precedence over the defaults in this profile (`AGENTS.md` §2, principle 10).

| Field | Value |
|-------|-------|
| Technology | PostgreSQL — database; Liquibase — database migration tool |
| Area in `docs/project.md` | Database |

A statement that ends with the note *verify against the official release notes* in parentheses is not confirmed by the framework's sources: it needs checking against the technology's official release notes.

## 2. Applicability and detection

- Applies when `docs/project.md` lists `postgresql` among the active profiles.
- Detected by Liquibase changelogs in the repository.
- The parts of this profile about Liquibase apply only when Liquibase is the migration tool; a project that uses PostgreSQL with another migration tool records that tool in `docs/project.md`.

## 3. Version policy

- This profile states no version. The versions of PostgreSQL and Liquibase come from `docs/project.md` and the build files.

## 4. Structure

- Every schema change is a changeset in a Liquibase changelog.

## 5. Conventions

- Default pairing: PostgreSQL as the database, Liquibase as the migration tool.

## 6. Testing

N/A — the framework's sources define no database-specific test convention.

## 7. Verification commands

N/A — the framework's sources define no default command; a migration check that the project uses is recorded in `docs/project.md`.

## 8. Risk triggers

Stack-specific actions, each with the row of `.ai/policies/autonomy.md` §6 that it falls under. The levels are the policy's; this profile raises none.

| Action | Policy row | Level |
|--------|------------|:-----:|
| Editing a Liquibase changeset that has already been applied in any environment | Data: Editing a migration that has already been applied anywhere | L3 |
| A destructive or irreversible changeset, or one that backfills or transforms data | Data: Destructive or irreversible migration; data backfill or transformation | L3 |

## 9. Review additions

Checks for a diff that touches this stack:

- Every edit to a changeset that has already been applied anywhere is named, with its policy row and level (§8).
- Every destructive or irreversible changeset is named, with its policy row and level (§8).
