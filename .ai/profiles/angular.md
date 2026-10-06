# Profile: angular

## 1. Scope

This profile details `AGENTS.md` §9 (Implementation rules) for Angular: how it is used in a project. `AGENTS.md` sets the precedence: the constitution, policies, gates, workflows, and agents take precedence over this file. The project's code, configuration, and `docs/project.md` take precedence over the defaults in this profile (`AGENTS.md` §2, principle 10).

| Field | Value |
|-------|-------|
| Technology | Angular — frontend framework |
| Area in `docs/project.md` | Frontend |

A statement that ends with the note *verify against the official release notes* in parentheses is not confirmed by the framework's sources: it needs checking against the technology's official release notes.

## 2. Applicability and detection

- Applies when `docs/project.md` lists `angular` among the active profiles.
- Detected by the `angular.json` file of the frontend application.
- In the default monorepo layout, the frontend application is in `frontend/`; `docs/project.md` records the actual layout.

## 3. Version policy

- This profile states no version. The versions of Angular, of the libraries this profile names, and of the test runner come from `docs/project.md` and the build files.
- The build files that declare them are `package.json` and its lock file (verify against the official release notes).
- A convention below that depends on the version applies only where the project's version supports it.

## 4. Structure

- `angular.json` defines the workspace's projects and, for each, its build, test, and lint targets (verify against the official release notes).
- Unit tests sit next to the code they test, in `*.spec.ts` files (verify against the official release notes).

## 5. Conventions

- Components are standalone-first.
- Default libraries: Angular Material for UI components, Tailwind CSS for utility styling, and RxJS for asynchronous flows.
- Lint and formatting use the repository's existing tools, commonly ESLint and Prettier.

## 6. Testing

- Unit tests use the test runner the project declares, for example Jasmine with Karma, Jest, or Vitest.
- Which runner a new Angular workspace sets up by default depends on the Angular version (verify against the official release notes).
- A unit test carries the qualified AC ID in its name: `it('0007-AC2: shows the expired-link message', …)`.
- End-to-end tests use the tool recorded in `docs/project.md`, for example Playwright or Cypress, and carry the AC ID the same way: `test('0007-AC1: user requests a reset link', …)`.

## 7. Verification commands

Defaults; `docs/project.md` overrides them.

| Check | Default command |
|-------|-----------------|
| Build | `ng build` (verify against the official release notes) |
| Lint | `ng lint`, where the workspace configures a lint builder (verify against the official release notes) |
| Unit | `ng test --watch=false`, in a single run rather than watch mode (verify against the official release notes) |
| Targeted unit | `ng test --watch=false --include <path/to/file.spec.ts>` — only the spec files of the changed code (verify against the official release notes) |
| E2E | The command of the tool recorded in `docs/project.md` |

An agent never runs a test or dev server in watch mode as a verification step: watch mode never exits, so the session waits with no result. `docs/project.md` records the unit command with `--watch=false` (or the runner's single-run flag).

## 8. Risk triggers

Stack-specific actions, each with the row of `.ai/policies/autonomy.md` §6 that it falls under. The levels are the policy's; this profile raises none.

| Action | Policy row | Level |
|--------|------------|:-----:|
| Changing an HTTP interceptor that attaches credentials or handles authentication, authorization, or session state | Security: Authentication, authorization, session handling, cryptography | L3 |

Any other change to an HTTP interceptor falls under the row that matches what the change does.

## 9. Review additions

Checks for a diff that touches this stack:

- Every changed HTTP interceptor is named, with the policy row and level that apply to its change (§8).
