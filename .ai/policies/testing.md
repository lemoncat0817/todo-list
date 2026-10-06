# Testing Policy

## 1. Scope

This policy details `AGENTS.md` §4 (who owns tests), §9 (implementers write the tests for their own code), and §10 (verification, test integrity, the AC id in the test name, `RC-VERIFIED`). `AGENTS.md` takes precedence over this file.

The trace table, scenario ids, and the *Covers* link are `.ai/policies/artifacts.md` §6–§9. The autonomy levels for tests are the Code & tests rows of `.ai/policies/autonomy.md` §6. This policy does not add a level. Test-left triggers stay in `.ai/workflows/new-feature.md` §4. How a test name carries an AC id is a profile concern.

## 2. Ownership

| Tests | Owner |
|-------|-------|
| Unit tests of the code in the task, including component tests | The task's implementer. The Frontend Agent owns these for frontend tasks |
| Integration tests inside the task's declared scope | The Backend Agent, for a backend task. The test stays inside that scope: one module, or the backend application, and not a flow that crosses layers |
| Cross-layer integration, end-to-end, reproduction, characterization, and coverage-gap tests | QA Agent |
| UAT script | QA Agent. People execute it (`.ai/gates/g6-uat.md`) |

The Backend Agent's statement that it owns unit and integration tests means the integration tests inside the task's declared scope. Cross-layer integration belongs to the QA Agent.

The QA Agent does not change product behavior to make a test pass (`AGENTS.md` §4).

The Reviewer Agent checks that tests are meaningful (§6) and were not weakened (§4).

## 3. Levels

The levels in the test plan are Unit, Integration, E2E, Manual, and UAT. This policy adds none. A component test is recorded as Unit. UAT is not an automated test.

## 4. Integrity

Weakening a test or a check is any of these: skipping it, disabling it, deleting it, loosening an assertion, adding a suppression, or editing an Approved artifact so the work fits. `AGENTS.md` §10 and `.ai/policies/autonomy.md` §5 rule 3 forbid doing so to make progress.

The levels are already in `.ai/policies/autonomy.md` §6:

- Adding a new test is the row for adding new tests.
- Changing or deleting an existing test because an approved AC changed, and citing the superseding AC, is the row for a superseding AC.
- Changing, deleting, or skipping a test for any other reason, and adding a lint or compiler suppression, is the L3 row of that table.

A flaky test is an escalation. Rerunning it until it passes is not a pass.

The task loop in `.ai/workflows/implementation.md` §3 names the same acts. The definition's home is this section.

## 5. Evidence

Report the commands that were run and their results. State what failed or did not run (`AGENTS.md` §10). A result that was not run is `NOT RUN`. It is not a manual pass.

`RC-VERIFIED` is met when every AC has passing evidence, or a manual verification accepted as below, and the full suite is green (`.ai/workflows/implementation.md` §4.3). The evidence is the trace table (`.ai/policies/artifacts.md` §8), written by `scripts/trace.py` from the tests that carry each AC's qualified ID — in `change.md` for the Quick track, in `test-plan.md` otherwise.

The QA Agent records a manual verification in that table: the scenario, the outcome, and the evidence. The Code Owner accepts the record at G5. Acceptance is not a separate gate.

## 6. Proof

A test proves an AC when its name carries the qualified AC id (`AGENTS.md` §10) and the test asserts the observable result the AC states. A test that only reaches the code under test does not prove the AC (`.ai/gates/g5-pull-request.md`, criterion 3).

**From Given/When/Then to a test.** The mapping is mechanical; it adds nothing and drops nothing.

| AC part | Becomes | Rule |
|---------|---------|------|
| AC ID and title | Test name | The qualified ID, e.g. `0007-AC3: closed case rejects edits` |
| `Given` (+ `And`) | Arrange | Exactly the stated state and values; nothing unstated is assumed |
| `When` | Act | The single action or event, called once |
| `Then` (+ `And`) | Assert | One assertion per clause, on the observable outcome |
| `Scenario Outline` + `Examples` | Parameterized test | One case per row, the row's values in the case name |

The level follows the AC: an outcome inside one unit is a unit or component test; one that crosses layers or the UI is an integration or E2E test. An AC that is not Given/When/Then, has more than one `When`, or uses an unmeasurable word is not guessed at: propose a reading and escalate it to the PM role for the Product Owner.

A defect's reproduction test fails for the reported reason before the fix and passes after it (`.ai/workflows/bug-fix.md` stages 3 and 6; `.ai/workflows/quick.md` §3 step 4).

A refactor's in-scope behavior is covered by passing characterization tests before the change, or the gaps are listed for approval (`.ai/workflows/refactor.md` stage 2). The suite that guards the invariants stays green (stage 3).
