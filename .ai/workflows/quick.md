# Workflow: quick

## 1. Scope

The Quick track of `AGENTS.md` §3: one session, one opening confirmation, at most one artifact, one G5. It replaces the C1 cosmetic path and the C2 minor-feature and micro-fix tracks.

| Field | Value |
|-------|-------|
| Command | `/quick <request>`; `/new-feature` and `/bug-fix` route here when the request sizes C1 or C2 |
| Artifact | `docs/changes/NNNN-<slug>/change.md` (`.ai/templates/change.md`); none for Cosmetic (§4) |
| Human stops | Opening OK (C2 only) · G5 |
| Budget | 15 minutes from the opening OK to the G5 request |
| Ends when | G5 approved and merged |

## 2. Fit

Quick applies only when **every** condition holds. Check them while reading the code; any failure means size up (§6).

| Type | Fits when |
|------|-----------|
| Cosmetic (C1) | Presentation only, one layer; no AC, business rule, or user-visible text changes that a current AC states or an existing test asserts (a mention elsewhere does not fix it); checkable by looking |
| Enhancement (C2) | A local change to an existing capability — a field, validation rule, sort order, UI interaction; 3–5 ACs say it all |
| Defect (C2) | Severity S3/S4; expected behavior comes from an existing AC or a recorded Product Owner decision; a unit or component test reproduces it |
| All | One task (a bundle counts as one); one module per layer; no contract, schema, security-sensitive, dependency, CI, or configuration change (no L3); no test-left trigger (`.ai/workflows/new-feature.md` §4) |

A capability with no view in `docs/specs/` yet is not a reason to size up.

**Bundles.** Up to 5 related items that each fit — for example three field validations and a button label on one form — run as one change: one opening message, one `change.md` with the ACs numbered across all items, one PR. When one item stops fitting, it leaves the bundle as its own change; the rest continue.

## 3. Steps

1. **Read** `docs/project.md` (artifact language, verification commands, active profiles), the code the request touches, and the views in `docs/specs/` for the touched capability. Nothing else unless a step needs it.
2. **Open** with one message in the artifact language, then wait. A Cosmetic change announces and proceeds without waiting.

   ```text
   Quick change: "note limit 100 characters"
   Size:     C2 Enhancement — one component, existing capability order-note
   Impact:   frontend/src/app/order/note-input.component.{ts,html}
   ACs:      AC1 Given a 100-character note, When the user types one more character, Then it is not added
             AC2 Given any note, When it is shown, Then the counter reads "<n>/100"
   Changes:  Supersedes 0002-AC4 (limit 200); Revokes 0002-AC6 (clear button) — reason: PO request
   Q1:       Paste beyond the limit? A. truncate  B. reject  — Recommended A: keeps typed text
   Reply "OK" (or "OK, Q1 B"), or name what to change.
   ```

   A defect lists the observed behavior, the expected behavior and its source, and the reproduction steps instead of new ACs. If the expected behavior has no source, the Product Owner decides it in this same reply. At most 3 questions, each with a recommended default; behavior only, never technology.
3. **Record.** On the reply, run `python3 scripts/new-change.py <slug> --type feat` (`fix` for a Defect), which takes the next number and creates the branch and `change.md`; fill it with exactly the content that was confirmed, applying the answers. Commit it with `Refs: NNNN`. For an Enhancement, the reply is the G2 approval: record it with `python3 scripts/approve.py NNNN change.md G2 --by "<Product Owner>"` and commit. A changed answer that widens scope goes back to step 2.
4. **Red.** One test per AC, named with its qualified ID (`NNNN-AC1: …`); run it with the targeted test command and see it fail for the stated reason. A defect's test fails for the reported reason.
5. **Green.** Implement inside the impact scope. Run the targeted tests of the changed files, plus build and lint when they are fast, non-interactively under `timeout`; the full suite runs in CI (step 9). Convergence budget: `AGENTS.md` §10. Write the root cause of a defect in `change.md` (cause, why tests missed it, blast radius).
6. **Run it.** Exercise the change through its real interface — browser, HTTP call, or CLI — once per AC, and record each result in *Verification*. Reuse a running app or dev server; start one only when the project's run command is non-interactive. An AC that cannot be run this way is recorded in *Verification* with the reason and listed in the G5 request.
7. **Converge.** Run `python3 scripts/converge.py NNNN`: it writes the trace table, rebuilds the views of the capabilities `change.md` declares, and lists the changed files and any commit without `Refs:`. Mark each AC *met*, *partial*, or *missing* in *Convergence*, and list every changed file the impact scope did not name as *unrequested*. A trace gap, partial, or missing returns to step 5; an unrequested change is reverted or justified.
8. **Records.** Commit what converge wrote — the trace table and any rebuilt view — with the change. No separate view run is needed.
9. **PR.** Commit with `Refs: NNNN-T1`, push, and open the PR with the body from `python3 scripts/pr-body.py NNNN`; a stale capability view it flags returns to step 8, and a missing AI review it flags is stated in the G5 request. CI runs the full suite and, where configured, the AI review. Send the G5 request once CI is green: what changed, the trace, the run-it results, anything open, and `Reply "G5 approved" to merge.` A red full suite returns to step 5. Without CI, run the full suite locally before the PR.
10. **Close.** On the Code Owner's approval, record it with `scripts/approve.py NNNN change.md G5 --by "<Code Owner>"`. Merge only when the Code Owner says so — without waiting for CI to rerun on the record commit, which touches only the approval record of code CI already passed, unless branch protection requires it — then say that nothing else is needed on the hosting platform.

## 4. Cosmetic changes

A Cosmetic change (C1) has no behavior to specify, so it writes no `change.md`. The runner announces size and impact, creates `chore/NNNN-<slug>` with `python3 scripts/new-change.py <slug> --type chore --artifact none`, makes the change, runs the targeted tests and the build, takes before and after screenshots or records the checked computed values or visual check, commits with `Refs: NNNN-T1`, and opens the PR with `python3 scripts/pr-body.py NNNN --request "<the request as received>"`, which records the request and the evidence in the PR description. CI and G5 run as for every change. If it turns out to change behavior, it becomes a C2 change with a `change.md` (§6).

## 5. Rigor that stays

G5 for every change; G2 for every enhancement; red before green; tests named by AC; the full suite green before G5; no weakened test; the convergence budget; L3 stops; scope self-review; evidence for every claim. Quick removes hand-offs and documents, never a check.

## 6. Size up

Stop as soon as a fit condition fails — for example, the cause spans layers, a contract must change, or a sixth AC is needed. Record the reason in `change.md` *Notes*, tell the human, and continue in the Standard track at the stage the work needs: an Enhancement becomes the draft spec of `.ai/workflows/new-feature.md` Stage 3; a Defect continues at Stage 3 of `.ai/workflows/bug-fix.md`. Moving back down needs the human who confirmed the size.

## 7. Resume

| `change.md` state | Next step |
|-------------------|-----------|
| No file, `chore/` branch with commits | §4: finish and open the PR |
| No file | 1–2 |
| Enhancement, Status `Draft` | 2: awaiting the opening OK |
| Approved, or Defect/Cosmetic in progress, *Verification* empty | 4–6 |
| *Verification* filled, *Convergence* empty | 7 |
| *Convergence* all met, no PR | 8–9 |
| PR open | Awaiting G5 |
