# Project Profile: `todo-list`

| Field | Value |
|-------|-------|
| Change | N/A — project-level artifact |
| Status | Approved |
| Owner | Tech Lead Agent |
| Approver | Technical Owner (G1) |
| Upstream | `/new-project` Adopt. No `docs/discovery.md` — the operator stated no problem, users, or goals. |

<!-- Purpose: The framework configuration for this project: stack, profiles, owners, environments, commands.
     Not in this artifact: secrets, credentials, or URLs carrying tokens; requirements; architecture rationale; tasks.
     Optional extra header row: Ticket — an issue-tracker key. -->

## Identity

- **Name:** `todo-list`
- **Type:** web app (existing client-first static site; Adopt, not a new repository)
- **Repository layout:** `src/` application source (188 tracked files) · `e2e/` end-to-end tests (14) · `supabase/` SQL migrations and SQL tests (53) · `public/` static assets (3) · `.github/` CI and GitHub Pages deploy (2) · `scripts/` project scripts outside the framework (3) · root manifests and config (`package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `tsconfig.json`, `index.html`, `.nvmrc`, `.env.local.example`) · `docs/screenshots/` product images. Counts are from `scripts/adopt.py` on 2026-10-06.

## Business context summary

<!-- The problem, users, and goals in brief, with a link to discovery.md. -->

TODO(Product Owner): this request was `/new-project` with no problem, users, or goals. Adopt does not invent them and does not write `docs/discovery.md`.

## Owners

| Role | Held by |
|------|---------|
| Product Owner | you (proposed) |
| Technical Owner | you (proposed) |
| Code Owner | you (proposed) |
| Release Owner | you (proposed) |
| Security Owner | you (proposed) — the optional sync path handles sign-in and personal task data |

## Stack and active profiles

Installed profiles are `angular`, `spring-boot`, `postgresql`, and `docker`. None match this repository. The `postgresql` profile is detected by Liquibase changelogs; this repository uses SQL files under `supabase/migrations` and has no Liquibase. No profile is activated.

| Area | Technology | Version | Profile |
|------|------------|---------|---------|
| Frontend | Vue, TypeScript, Vite, Pinia, Vue Router, Tailwind CSS | Vue 3.5.41 · TypeScript 6.0.3 · Vite 8.2.1 · Pinia 4.0.3 · Vue Router 5.2.0 · Tailwind CSS 4.3.3 | none |
| Backend | No application server in the repository. Optional Supabase Auth, PostgREST, Realtime, and Edge Functions, called from the client. | `@supabase/auth-js` 2.112.4 · `@supabase/realtime-js` 2.112.4 | none |
| Database | Browser IndexedDB via `idb`. Optional Supabase Postgres; schema is SQL in `supabase/migrations` (not Liquibase). Postgres server version is not recorded in the repository. | `idb` 8.0.3 | none |
| Infrastructure | GitHub Actions (`.github/workflows/ci.yml`, `.github/workflows/deploy.yml`), GitHub Pages. Package runner pnpm. No Dockerfile or compose file. | pnpm 10.13.1 · Node engines `^20.19.0 \|\| >=22.12.0` · `.nvmrc` `v22.18.0` · commands below ran on Node v24.18.0 | none |

## Environments

| Environment | Purpose | Who may deploy |
|-------------|---------|----------------|
| dev | Local Vite server: `pnpm dev` | Whoever runs it locally |
| test | TODO(Technical Owner): the repository does not declare a test environment | TODO(Technical Owner) |
| UAT | TODO(Technical Owner): the repository does not declare a UAT environment | TODO(Technical Owner) |
| prod | GitHub Pages. `.github/workflows/deploy.yml` deploys the `github-pages` environment after CI succeeds on `master`, or on `workflow_dispatch`. When Supabase secrets are set, the same workflow can push SQL migrations before the Pages deploy. | TODO(Technical Owner): the workflow names no person. Proposed: Release Owner |

## Verification commands

<!-- One row per application. Targeted: the unit command limited to named test files, run during work (AGENTS.md §10); the full commands run before the PR or in CI. -->

Candidate commands from `scripts/adopt.py`, each run once under `timeout 240` on 2026-10-06. All three exited 0.

| Application | Build | Lint | Unit | Targeted unit | Integration | E2E |
|-------------|-------|------|------|---------------|-------------|-----|
| `todo-list` | `pnpm run build` | `pnpm run lint` | `pnpm run test` | `pnpm exec vitest run <file>` | none — `package.json` has no integration script | TODO(Technical Owner): `pnpm run test:e2e` — script exists and CI runs it; the adopt scan does not list it (`test:e2e`, not `e2e`); not run |

`pnpm run test` result: 96 files passed, 1107 tests passed, 3 skipped. The process also printed `ECONNREFUSED 127.0.0.1:3000` and still exited 0. Source not investigated.

Not a candidate, not run: `pnpm typecheck` (CI runs it). CI lint is `pnpm lint --max-warnings 0`; this session ran `pnpm run lint` only.

## Conventions

- **Main branch:** `master`
- **Change IDs:** `NNNN` (four digits). No `docs/changes/` yet. The adoption change is the first, `0001`, created after G1.
- **Artifact language:** English (proposed) — the language of this request. README and the product UI are 繁體中文; confirm if artifacts should be 繁體中文 instead.

## Autonomy adjustments

<!-- Autonomy levels raised for this project, and convergence-budget settings; or "None — framework defaults apply". -->

None — framework defaults apply.

## External systems

| System | Purpose | Access |
|--------|---------|--------|
| Supabase (optional) | Sign-in, row sync, Realtime, SQL migrations, Edge Functions | `.env.local.example` names `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Deploy names `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. No values here. Absent config leaves sync dormant. |
| GitHub Pages | Production static hosting | `.github/workflows/deploy.yml` |
| Web Push (optional) | Due and mention notifications | `.env.local.example` names `VITE_VAPID_PUBLIC_KEY`. The private key is not in the repository. |
| Resend (optional) | Invitation and daily-digest email | Named in comments in `.env.local.example` as Edge Function environment variables. No keys in the repository. |

## Framework version

`0.5.0-dev`

## Change log

- 2026-10-06 — Proposed from the Adopt scan for G1. `pnpm run build`, `pnpm run lint`, and `pnpm run test` exited 0.

## Approval

<!-- One row per gate decision; Version is the commit of the reviewed artifact. -->

| Gate | Outcome | Approver | Date | Version | Conditions |
|------|---------|----------|------|---------|------------|
| G1 | Approved | Technical Owner | 2026-10-06 | `7c74d34` | None. Recorded by an AI agent at the approver's instruction. |
