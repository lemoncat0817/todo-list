# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A client-first todo app (Vue 3 + Pinia + Vue Router + IndexedDB), deployed as a
static site to GitHub Pages. By default there is no backend — all data lives in
the browser's IndexedDB. An **optional** Supabase-backed sync layer (see
[Cross-device sync](#cross-device-sync-optional)) lets a signed-in user's data
follow them across devices; without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
set, that entire layer stays dormant and the app is exactly the client-only tool
it always was. See [README.md](README.md) for the user-facing feature list.

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
  path so the list and the counts can never disagree), `views.ts` (which tasks
  belong to a named view — today/upcoming/inbox/project/label — plus their
  grouping, titles and empty-state copy), `undo.ts` (a bounded
  command-pattern undo/redo stack), `task.ts` (normalization/validation of
  anything crossing a trust boundary, plus parent/child helpers).

  `filtering.ts` answers "does this task match?"; `views.ts` answers "what
  should the user see at this entry point, and how is it grouped?". They are
  separate because the predicates are stable while views are a product
  decision that keeps growing.

  `quickAdd.ts` parses one line of natural language ("明天下午3點 交報告 p1
  #工作 @公司") into task fields plus the tokens it consumed. Projects, tags
  and `now` are all parameters — that is what makes year/month/weekend
  boundaries testable instead of "correct on my machine today". Two invariants
  it must keep: **the user's text is the floor for the task name** (if parsing
  would leave the name empty, return the raw input and apply nothing), and
  **it reports what it consumed** so the UI can show the interpretation
  before submit rather than after.
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
- **`src/router/`** — view state lives in the URL (`/today`, `/upcoming`,
  `/inbox`, `/all`, `/active`, `/completed`, `/project/:id`, `/label/:id`)
  rather than store state, for deep-linking and to avoid persisting an
  out-of-range value. `/` redirects to `/today`: the question to answer on
  open is "what now", not "how much do I owe". Route names are deliberately
  identical to `ViewKind` so there is only one mapping table.
  Hash history (`createWebHashHistory`) is required because GitHub Pages has
  no SPA fallback for subpath deployments.
- **`src/components/`** — presentation only; business logic is expected to
  already live in `domain/`/`stores/` before it reaches a component. The shell
  is three panes (`AppSidebar` / `RouterView` / `TaskDetailPanel`); below
  1280px the detail pane becomes `TaskDetailDialog` and below 1024px the
  sidebar becomes a `<dialog>` drawer. Both wrap the same `TaskDetailForm` —
  the container decides *how it appears*, the form decides *what fields exist*.
  `useMediaQuery` picks one or the other with `v-if` rather than rendering both
  and hiding one with CSS: two copies would mean duplicate landmarks and
  duplicate focusable elements.

### Backup, PWA and reminders

`db/backup.ts` serializes/parses a versioned JSON file. Import runs through the
same `normalize*` functions as IndexedDB and legacy localStorage — a backup
file is user-editable, so it gets no more trust than any other external input.
It distinguishes "this file is not a backup" (reject the whole thing) from
"these rows are unrecoverable" (drop and report the count); conflating them
either loses data silently or refuses a mostly-good file. The whole import is
one undo command, which is what makes the destructive "replace" mode safe.

`public/sw.js` is hand-written and **network-first**, not cache-first: assets
are content-hashed but `index.html` is not, so cache-first would keep serving
an old `index.html` pointing at assets that no longer exist. It is registered
only in `import.meta.env.PROD`. Playwright blocks service workers
(`serviceWorkers: 'block'`) so cached responses can't leak between tests;
`deploy.spec.ts` verifies the *artifacts* instead.

Reminders (`composables/useDueReminders.ts`) poll once a minute rather than
scheduling a timer per task — tasks get rescheduled, completed and deleted, and
a pile of timers needing cancellation is where the bugs live. Without a server
there is no Web Push, so they only fire while the tab is open; the UI says so
explicitly rather than letting people believe they have a reliable alarm.

### Data flow

`main.ts` mounts the app immediately, then calls `store.init()` asynchronously
(loading state is a component concern, not a boot blocker). `init()` runs the
legacy-localStorage migration once, loads tasks/projects/tags/filters from
IndexedDB, then a `watch` on that state persists on every change — no
debounce, because debouncing creates a window where "act then immediately
reload" loses data. Writes are **per-record**: the store keeps a
`Map<id, JSON signature>` of what was last written and sends only changed rows
plus explicit deletes (`applyTaskChanges`). The signature is the full
serialized row rather than `updatedAt`, because undo puts an *older* object
back — a timestamp comparison would miss it. `flush()` is re-entrant-safe (concurrent calls coalesce)
and is also fired from `pagehide`/`visibilitychange` in `main.ts` to minimize
the async write window before a tab closes.

### Cross-device sync (optional)

Dormant unless `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are set
(`sync/config.ts`'s `isSyncConfigured`) — the "帳號與同步" sidebar entry
doesn't even render otherwise, so a fork without a Supabase project is a fully
working client-only app, not a broken button. Scope is deliberately narrow:
**single-user sync across a person's own devices**, not multi-user
collaboration (no shared projects, no realtime, no field-level merge). Those
are explicit non-goals for now, not gaps someone forgot.

**No `@supabase/supabase-js`.** Every other dependency choice in this repo is
justified by a measured gzip number (`idb` over Dexie, hand-rolled dates over
date-fns, hand-rolled recurrence over `rrule`), and the full SDK — auth +
postgrest + realtime + storage + functions — is disproportionate to the five
or six fixed operations sync actually needs. Split instead:
- **`sync/authClient.ts`** wraps `@supabase/auth-js` (GoTrue's real client, not
  the umbrella package) — token refresh/expiry/storage are security-sensitive
  enough to not reinvent. Measured: 23.16 kB gzip as its own chunk.
- **`sync/restClient.ts`** hand-rolls `fetch` calls against PostgREST — the
  query shapes are fixed (`fetchRowsSince`/`upsertRows`), so a general query
  builder buys nothing.
- Both are dynamically `import()`ed only when an account action actually runs
  (`stores/auth.ts`, `stores/sync.ts`) — a user who never signs in never
  downloads either, and the base bundle is unaffected.

**Sign-in is email OTP or OAuth (Google/GitHub), never a password.** No
reset/strength UI to build, no password to leak, and it matches the app's
existing low-friction ethos (no confirm dialogs anywhere, do-then-undo
instead). OAuth is scoped to providers with free, self-serve developer
consoles — Google Cloud Console and GitHub OAuth Apps both need no paid
account or app review for personal-scale use; Apple (`Sign in with Apple`
needs a paid $99/yr Apple Developer Program membership) and Facebook (now
needs Business verification for public use) were evaluated and skipped for
that reason, not forgotten.

OAuth forced a real architectural decision: `sync/authClient.ts` sets
`flowType: 'pkce'` (auth-js defaults to `'implicit'`) and
`detectSessionInUrl: true`. Implicit flow returns the session in the URL
*hash* (`#access_token=...`) and clears `location.hash` after reading it —
a direct collision with this app's hash-based routing (`#/today`). PKCE
returns a `?code=` *query* parameter instead; Vue Router's hash history never
reads `location.search`, so the two coexist by construction — confirmed by
reading `_getSessionFromURL` in `@supabase/auth-js` itself, not assumed.
`stores/auth.ts`'s `restore()` is the one place that has to know about this:
it now triggers the authClient `import()` not just when a previous session
was stored, but also when `?code=` (mid-login) or `?error=`/`error_description=`
(user cancelled at the provider, or the provider isn't configured yet) is
present in the URL — otherwise a fresh OAuth callback would silently do
nothing on a first-time sign-in.

**Pull is polling, not Realtime.** `stores/sync.ts` pulls on `start()`, every
30s, on `online`, and on `visibilitychange`, mirroring the polling pattern
already used by `useDueReminders.ts`. Realtime (websocket) would be the
natural upgrade *if* live multi-user collaboration is ever built — until then
it would only add `realtime-js`'s bundle weight for no behavioral benefit.

**Conflicts are row-level last-write-wins**, comparing `updatedAt`
(`sync/merge.ts`'s `mergeByUpdatedAt`). Two devices editing *different fields*
of the same row within the same sync window will have one edit lose entirely
— an accepted, documented tradeoff for a single-user feature, not a hidden
gap. `StoredProject`/`StoredTag`/`StoredFilter` gained an `updatedAt` field
for this (they didn't need one before sync existed); `domain/task.ts`'s
`normalize*` functions backfill it for pre-existing rows, so no IndexedDB
version bump was needed — adding a field to a schemaless object store never
requires one, only new stores/indexes do.

**Deletes are soft (tombstones), not real `DELETE`s.** Plain REST polling has
no delete-event feed the way Realtime would — a hard delete just makes a row
stop appearing in `SELECT`, indistinguishable from "never existed" to a
device that hasn't synced since. Both push (`sync/tableSync.ts`'s
`pushTable`) and the Postgres schema (`supabase/migrations/0001_init.sql`)
mark `deleted_at` instead; pull treats a tombstoned row as a removal via
`mergeByUpdatedAt`'s `remoteDeletedIds`. Tombstones accumulate with no GC —
acceptable at personal-task-list scale, called out rather than silently
deferred.

**The sync fingerprint is durable, the local one isn't — on purpose.**
`stores/tasks.ts`'s `persistedIndex` (what's in IndexedDB) is rebuilt fresh
from `loadTasks()` every session, because local storage only needs to know
"what's true now." The sync fingerprint (what's been pushed to the server)
is persisted separately in IndexedDB's `meta` store
(`META_SYNC_FINGERPRINT_*`), because it needs to survive a reload: a task
deleted locally while offline is *gone* from `loadTasks()`'s result by the
next launch, so only a fingerprint that remembers "this id used to exist"
can still produce the tombstone that tells other devices about the deletion.
Both fingerprints share one diffing algorithm, `domain/diff.ts`'s
`diffAgainstFingerprint` (extracted from what was inline in `tasks.ts`'s
`flush()`), applied against two independently-lived maps.

**Merge always re-reads local state after the network round-trip, never
before it.** `stores/sync.ts` pushes first, pulls second, and only then calls
`mergeByUpdatedAt` against a *fresh* read of `tasks.items`/`collections.*` —
not the snapshot captured when the sync cycle started. Two `await`s sit
between "diff computed" and "merge applied"; if a local edit that reassigns
the whole array (`remove`, `batchUpdate`, `undo`) happens in that window, a
merge built on the stale snapshot would silently discard it. `stores/sync.spec.ts`
has a dedicated regression test for this exact race.

`domain/filterQuery.ts` is a small recursive-descent parser producing an AST,
plus an evaluator. Parse errors are **returned**, never swallowed: a query with
a typo that silently matches everything makes the user believe their condition
held. Saved filters store the raw query string, not the AST — the AST's shape
will change as the language grows, a string can always be re-parsed.

The query lives in the URL (`/filter?q=...`), in `query` rather than a path
param because `&`, `|` and `#` would otherwise need layered escaping.

### Sorting, grouping and preferences

Sort/group choices live in `stores/prefs` (persisted), *not* in the URL: they
are "how I like to look at things", not "what I am looking at". Sharing a link
should hand someone the same list, not impose your sort order. `prefs` is a
separate store from `ui` because the persistence plugin writes the whole state
— mixing them is what previously persisted "search is open" and stranded users
on the search screen.

### Priority

Stored as `0`–`3` with `3` highest; displayed as `P1`–`P4` with `P1` highest
(a common convention many users already arrive with). The mapping lives in
`PRIORITY_LABELS`/`PRIORITY_ORDER` — don't renumber the stored values, that
would be a data migration for a labelling problem. CSS tokens are named by
strength (`--color-prio-high/mid/low`) rather than by P-number, precisely
because the two numbering schemes run in opposite directions.

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
- **Sync tests never hit real Supabase.** `sync/restClient.spec.ts` and
  `sync/tableSync.spec.ts` mock `globalThis.fetch`; `stores/auth.spec.ts` and
  `components/AccountDialog.spec.ts` `vi.mock('@/sync/authClient', ...)`
  wholesale (it's dynamically imported, which `vi.mock` intercepts
  transparently) plus `vi.mock('@/sync/config', () => ({ isSyncConfigured: true }))`
  since the default test env has no `VITE_SUPABASE_URL`. `e2e/account.spec.ts`
  intercepts the real GoTrue endpoints with `page.route` (`/auth/v1/otp`,
  `/verify`, `/logout` — miss one and the awaited call just hangs against a
  fake host until the test times out) — `playwright.config.ts`'s `webServer.env`
  sets fake-but-well-formed Supabase values so the gated UI has something to
  test at all, never a real project.
- **Three gotchas hit while writing these tests, worth not re-discovering:**
  happy-dom does not dispatch a native `submit` event when a
  `<button type="submit">` inside a `<form>` is clicked (real browsers do) —
  component tests must `find('form').trigger('submit')` directly, then
  `await flushPromises()` from `@vue/test-utils` since Vue doesn't await a
  `@submit.prevent` handler's returned promise. `vi.useFakeTimers()`
  combined with `fake-indexeddb` hangs indefinitely if IndexedDB calls happen
  while fake timers are active — `stores/sync.spec.ts` only switches to
  `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })`
  *after* an IndexedDB-touching `start()` has fully settled under real timers.
  And Vitest (via Vite's `loadEnv`) reads a developer's real `.env.local` by
  default — once anyone configures a real Supabase project for `pnpm dev`,
  every unit test would see `isSyncConfigured: true` unless overridden,
  making "not configured" tests pass or fail based on whose machine runs them
  rather than what the code does. `vitest.config.ts` pins
  `test.env.VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` to `''` explicitly so
  the unit test baseline is always "not configured" regardless of local
  `.env.local`; tests that need the configured branch still opt in via
  `vi.mock('@/sync/config', ...)`.
