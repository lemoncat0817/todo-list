# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A client-only todo app (Vue 3 + Pinia + Vue Router + IndexedDB). No backend — all
data lives in the browser's IndexedDB, deployed as a static site to GitHub Pages.
See [README.md](README.md) for the user-facing feature list.

## Commands

Node `^20.19.0 || >=22.12.0`, pnpm (`packageManager` pinned in package.json).

```sh
pnpm install
pnpm dev                # dev server
pnpm build               # production build (dist/)
pnpm preview              # serve the built dist/

pnpm typecheck            # vue-tsc --noEmit
pnpm lint                 # eslint .   (CI runs --max-warnings 0)
pnpm lint:fix

pnpm test                 # vitest run — all unit tests
pnpm test:watch           # vitest (watch mode)
pnpm test:e2e             # playwright test — full E2E incl. accessibility
```

Single test file / single test:

```sh
pnpm exec vitest run src/domain/recurrence.spec.ts
pnpm exec vitest run src/domain/recurrence.spec.ts -t "monthly rolls to last day"
pnpm exec playwright test e2e/a11y.spec.ts
pnpm exec playwright test e2e/a11y.spec.ts -g "no violations"
```

`pnpm test:e2e` builds and serves `dist/` on two ports (see Testing below), so it's
slower than unit tests — prefer `pnpm test` while iterating and save `test:e2e` for
before-commit verification.

## Architecture

Strict layering, dependencies point one direction only (outer → inner):

```
components/  →  stores/  →  domain/
                   ↓            ↑
                  db/  ────────┘
```

- **`src/domain/`** — pure functions, zero IO, zero Vue/Pinia imports. This is
  where business rules live: `dates.ts` (local-date-string arithmetic),
  `recurrence.ts` (RFC 5545-flavored recurrence expansion), `ordering.ts`
  (fractional sort-key math), `filtering.ts` (search/filter/count — one code
  path so the list and the tab counts can never disagree), `undo.ts` (a bounded
  command-pattern undo/redo stack), `task.ts` (normalization/validation of
  anything crossing a trust boundary, plus parent/child helpers).
- **`src/db/`** — the only place that talks to IndexedDB (via `idb`, chosen over
  Dexie to save ~30 kB gzip). `schema.ts` has the stored shapes and constants,
  `repositories.ts` does IO, `migrate.ts` is the one-time legacy-localStorage
  migration. Never depends on `stores/`; `db/index.ts` is the only import path
  other layers should use.
- **`src/stores/`** (Pinia, Composition API style via `defineStore(id, () => {...})`)
  split by concern rather than one monolith:
  - `tasks.ts` — task CRUD, persistence orchestration (debounce-free flush to
    IndexedDB via a `watch`), and cross-store operations that need to know
    about tasks (e.g. `removeProject`/`removeTag` live here, not in
    `collections`, because collections shouldn't know tasks exist).
  - `collections.ts` — projects + tags (grouped together deliberately: same
    lifecycle, both small).
  - `history.ts` — the undo stack, store-agnostic so any store can push
    reversible commands onto it.
  - `ui.ts` — search/UI prefs, persisted to `localStorage` (not IndexedDB —
    needs synchronous read on boot) via the custom plugin in `infra/persist.ts`.
- **`src/infra/persist.ts`** — a small hand-rolled Pinia persistence plugin
  (replaces `pinia-plugin-persistedstate`: that package's Pinia 2 peer-dep
  pin blocked upgrading, and it silently swallowed write failures). Only
  used by `stores/ui.ts`; task/project/tag data goes through `db/` instead.
- **`src/router/`** — filter state (`all`/`active`/`completed`) lives in the
  URL (`/`, `/active`, `/completed`) rather than store state, for
  deep-linking and to avoid persisting an out-of-range value. Hash history
  (`createWebHashHistory`) is required because GitHub Pages has no SPA
  fallback for subpath deployments.
- **`src/components/`** — presentation only; business logic is expected to
  already live in `domain/`/`stores/` before it reaches a component.

### Data flow

`main.ts` mounts the app immediately, then calls `store.init()` asynchronously
(loading state is a component concern, not a boot blocker). `init()` runs the
legacy-localStorage migration once, loads tasks/projects/tags from IndexedDB,
then a `watch` on task/project/tag state persists on every change — no
debounce, because debouncing creates a window where "act then immediately
reload" loses data. `flush()` is re-entrant-safe (concurrent calls coalesce)
and is also fired from `pagehide`/`visibilitychange` in `main.ts` to minimize
the async write window before a tab closes.

### Recurrence

Recurring tasks are **expanded on completion**, not pre-generated: completing
a recurring task advances `dueDate` to the next occurrence and leaves it
uncompleted, rather than materializing future rows. Field names
(`freq`/`interval`/`byDay`/`byMonthDay`/`until`/`count`) intentionally mirror
RFC 5545 so a future `.ics` import/export is a mapping exercise, not a data
migration. `rrule` was evaluated and rejected (+13 kB gzip) in favor of the
small hand-written expander in `domain/recurrence.ts`.

### Ordering

Sort order uses interpolated floating-point keys (`domain/ordering.ts`), not
integer positions — a drag-and-drop reorder writes one row instead of
rewriting the whole list. Repeated inserts at the same spot shrink the gap
toward float precision limits; `needsReindex`/`reindex` detect and repair
that.

### Undo

Every mutating store action pushes an `{ label, undo, redo? }` command onto
`history` (`domain/undo.ts`, bounded at 50 entries) instead of a confirm
dialog. `Ctrl`/`Cmd`+`Z` and the toast's "復原" button both call
`history.undo()`.

## Conventions worth knowing

- **Bundle-size tradeoffs are deliberate and documented in comments** —
  `idb` over Dexie, hand-rolled dates over `date-fns`/Temporal, hand-rolled
  recurrence over `rrule`, `__VUE_OPTIONS_API__: false` in `vite.config.ts`.
  Don't reach for a heavier dependency without checking whether the comment
  next to the existing code already explains why it was avoided.
- **`vite.config.ts` `base: './'` is load-bearing** — GitHub Pages subpath
  deploys need relative paths; this is continuously verified by
  `e2e/deploy.spec.ts` against a subpath server started via
  `scripts/serve-subpath.mjs` (its base path defaults to `package.json`'s
  `name`, so renaming the repo doesn't require touching the script).
- Comments referencing `稽核 P<n>` / `U<n>` cite specific findings from a past
  accessibility/code audit — they explain *why* a piece of code looks the
  way it does, not just what it does. Read them before changing nearby code.
- All boundary-crossing data (IndexedDB rows, legacy localStorage,
  `localStorage`-persisted UI prefs) goes through a `normalize*`/`sanitize*`
  function that fails soft (drops/defaults bad fields, filters bad rows)
  rather than letting one malformed record break the whole list.
- Search normalization uses `String.prototype.normalize('NFKC')` before
  lowercasing, to make full-width/half-width and case differences
  transparently equivalent.
- Dates are local-date strings (`YYYY-MM-DD`), never `Date` objects crossing
  a boundary — see the rationale comment at the top of `domain/dates.ts`.

## Testing

- **Unit** (Vitest + happy-dom + `fake-indexeddb`): `src/test/setup.ts` resets
  a fresh `fake-indexeddb` instance and clears `localStorage` before every
  test so store persistence doesn't leak across tests. Co-located `*.spec.ts`
  files.
- **E2E** (Playwright, `e2e/`): builds `dist/` and serves it on two ports —
  `:4319` at root and `:4320` under `/<package.json name>/` (via
  `scripts/serve-subpath.mjs`) to continuously validate the GitHub Pages
  subpath deployment shape. `e2e/a11y.spec.ts` runs `@axe-core/playwright`
  across multiple app states (each view, editing, search, empty list) and
  must stay at zero violations (WCAG 2.1 AA). CI runs with `retries: 2` and
  `workers: 1` deliberately (see comments in `playwright.config.ts`) to
  separate flaky failures from real ones and avoid dev-server contention.
- CI (`.github/workflows/ci.yml`) runs typecheck/lint (`--max-warnings 0`)/unit
  tests/build in one job and E2E in a separate job; `deploy.yml` re-runs
  typecheck/test/build before publishing `master` to Pages.
