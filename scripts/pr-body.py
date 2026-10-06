#!/usr/bin/env python3
"""Assemble a pull-request description (templates/pull-request.md) from a change folder's artifacts."""

import argparse
import importlib.util
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import framework_artifacts as fa  # noqa: E402

_spec = importlib.util.spec_from_file_location("fw_trace", os.path.join(HERE, "trace.py"))
trace = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(trace)
_spec = importlib.util.spec_from_file_location("fw_views", os.path.join(HERE, "capability-views.py"))
views = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(views)

CONTRACT = re.compile(r"(^docs/architecture/openapi/|(^|/)(openapi|asyncapi)[^/]*$)", re.I)
DATA = re.compile(r"(migration|changelog|liquibase|flyway|\.sql$)", re.I)
CONFIG = re.compile(r"(\.env\.example$|(^|/)application[^/]*\.(ya?ml|properties)$|(^|/)compose[^/]*\.ya?ml$|"
                    r"(^|/)Dockerfile|^\.github/workflows/|(^|/)package\.json$|(^|/)pom\.xml$|build\.gradle)")


def body_of(path, name):
    if not os.path.isfile(path):
        return None
    text = fa.strip_comments(fa.section(fa.read(path), name) or "").strip()
    return text or None


def tasks(folder, title):
    plan = os.path.join(folder, "plan.md")
    if not os.path.isfile(plan):
        return [f"- `T1` — {title}"], "L2"
    rows = [r for r in fa.table_rows(fa.section(fa.read(plan), "Task table") or "") if re.fullmatch(r"T\d+", fa.bare(r[0]))]
    risks = [fa.bare(r[5])[:2] for r in rows if len(r) > 5]
    highest = max(risks, default="L2")
    return [f"- `{fa.bare(r[0])}` — {r[1]}" for r in rows], highest


def commit_hygiene(root, base):
    commits = fa.git(root, "log", "--format=%h%x09%B%x1e", f"{base}..HEAD").split("\x1e")
    unrefd = [c.strip().split("\t")[0] for c in commits if c.strip() and "Refs:" not in c]
    if unrefd:
        return f"- Commit hygiene: commits without a `Refs:` trailer: {', '.join(unrefd)}"
    return "- Commit hygiene: every commit on the branch carries `Refs:`"


def view_check(root, doc):
    """One evidence line on the views of the capabilities the change declares, and the stale ones."""
    declared = doc.capabilities if doc else []
    if not declared:
        return None, []
    model = fa.capability_model(root)
    stale = []
    for slug in declared:
        if slug not in model:
            continue
        path = fa.view_path(root, slug)
        if not os.path.isfile(path) or fa.read(path) != views.render(root, model[slug]):
            stale.append(slug)
    if stale:
        names = " ".join(stale)
        return (f"- Capability views: **stale or missing** for {', '.join(f'`{s}`' for s in stale)} — "
                f"run `python3 scripts/capability-views.py build {names}` and commit"), stale
    return f"- Capability views: up to date for {', '.join(f'`{s}`' for s in declared)}", []


def ai_reviewer_in_ci(root):
    """True when a workflow under .github/workflows/ looks like an AI review; a name-and-content heuristic."""
    base = os.path.join(root, ".github", "workflows")
    if not os.path.isdir(base):
        return False
    for name in os.listdir(base):
        if name.endswith((".yml", ".yaml")) and re.search(r"review", name + fa.read(os.path.join(base, name)), re.I):
            return True
    return False


NO_AI_REVIEW = ("**No independent AI pre-review:** no review workflow was found under `.github/workflows/`; "
                "the only check is the runner's own {what}.")


def cosmetic(root, change, request):
    """PR body of a Cosmetic (C1) change, which has no change folder (workflows/quick.md §4)."""
    branch = fa.git(root, "rev-parse", "--abbrev-ref", "HEAD")
    m = re.search(r"(\d{4}-[\w-]+)$", branch)
    name = m.group(1) if m else change
    title = name[5:].replace("-", " ") if m else request[:60]
    base = fa.main_branch(root)
    changed = fa.git(root, "diff", "--name-only", f"{base}...HEAD").splitlines()
    out = [f"<!-- Title: [{change[:4]}] {title} -->", "",
           "| Field | Value |", "|-------|-------|",
           f"| Change | `{name}` — Cosmetic (C1), no change folder |", "| Status | Proposed |",
           "| Owner | Tech Lead Agent |", "| Approver | Code Owner (G5) |", "| Upstream | The request below |", "",
           "## Summary", "", f"> {request}", "", "Presentation only; no AC, business rule, or approved text changes.", "",
           "## Tasks included", "", f"- `T1` — {title}", "",
           "## Trace table", "", "No ACs: a Cosmetic change specifies no behavior (`.ai/workflows/quick.md` §4).", "",
           "## Verification evidence", "", "`<targeted tests and build: commands and results>`", "",
           commit_hygiene(root, base), f"- Files changed: {', '.join(f'`{f}`' for f in changed) or 'none'}", "",
           "## Risk", "", "- **Highest level:** L1", "",
           "## Deviations", "", "None", "",
           "## AI review result", "",
           "The CI review on this pull request." if ai_reviewer_in_ci(root) else NO_AI_REVIEW.format(what="self-check"), "",
           "## Screenshots", "", "`<before and after, the checked computed values, or the described visual check>`", "",
           "## Code Owner checklist", "",
           "<!-- The runner fills one row per criterion of .ai/gates/g5-pull-request.md. -->", "",
           "| G5 criterion | Self-check | Note |", "|--------------|------------|------|", ""]
    print("\n".join(out))
    return 0


def main():
    parser = argparse.ArgumentParser(description="Print the pull-request body for a change (AGENTS.md §12).")
    parser.add_argument("change", help="change ID or folder name, e.g. 0007")
    parser.add_argument("--request", help="Cosmetic change (no change folder): the request as received")
    args = parser.parse_args()

    root = fa.repo_root()
    if args.request:
        return cosmetic(root, args.change, args.request)
    folder = fa.find_change(root, args.change)
    name = os.path.basename(folder)
    rel_folder = os.path.relpath(folder, root)
    doc = fa.source_doc(folder, root)
    first = fa.read(os.path.join(root, doc.path)).splitlines()[0] if doc else ""
    title = re.sub(r"^#\s*[\w ]+:\s*", "", first).strip().strip("`") or name

    change_md = os.path.join(folder, "change.md")
    summary = (body_of(change_md, "Intent") or body_of(os.path.join(folder, "spec.md"), "Goal")
               or body_of(os.path.join(folder, "bug.md"), "Report") or "`<what and why>`")
    task_lines, highest = tasks(folder, title)
    _, _, rows, gaps = trace.build(root, folder)
    verification = (body_of(change_md, "Verification") or body_of(os.path.join(folder, "test-plan.md"), "Results")
                    or "`<commands run and their results>`")
    deviations = (body_of(os.path.join(folder, "plan.md"), "Deviation log") or body_of(change_md, "Notes") or "None")
    l3 = body_of(os.path.join(folder, "plan.md"), "L3 items for G4")
    review = os.path.join(folder, "review.md")
    if os.path.isfile(review):
        result = fa.bare(fa.header_fields(fa.read(review)).get("Review result", "")) or "see review.md"
        ai_review = f"`{os.path.relpath(review, root)}` — {result}"
    elif ai_reviewer_in_ci(root):
        ai_review = "Quick track: the converge check in `change.md` and the CI review on this pull request."
    else:
        ai_review = NO_AI_REVIEW.format(what="converge check in `change.md`")

    base = fa.main_branch(root)
    changed = fa.git(root, "diff", "--name-only", f"{base}...HEAD").splitlines()
    hygiene = commit_hygiene(root, base)
    view_line, stale = view_check(root, doc)
    if view_line:
        hygiene += "\n" + view_line
    contract = [f for f in changed if CONTRACT.search(f)]
    data = [f for f in changed if DATA.search(f) and not f.startswith("docs/")]
    config = [f for f in changed if CONFIG.search(f)]

    out = [f"<!-- Title: [{name[:4]}] {title} -->", "",
           "| Field | Value |", "|-------|-------|",
           f"| Change | `{name}` |", "| Status | Proposed |", "| Owner | Tech Lead Agent |",
           "| Approver | Code Owner (G5) |", f"| Upstream | `{rel_folder}/` |", "",
           "## Summary", "", summary, "",
           "## Tasks included", "", *task_lines, "",
           "## Trace table", "", "| AC | Tasks | Tests | Result |", "|----|-------|-------|--------|", *rows, "",
           "## Verification evidence", "", verification, "", hygiene, "",
           "## Risk", "", f"- **Highest level:** {highest}", ""]
    if l3:
        out += [l3, ""]
    out += ["## Deviations", "", deviations, "",
            "## AI review result", "", ai_review, ""]
    if contract or data or config:
        out += ["## Contract, data, and configuration changes", ""]
        out += [f"- Contract: `{f}`" for f in contract] + [f"- Data: `{f}`" for f in data] + \
               [f"- Configuration: `{f}`" for f in config]
        out.append("")
    out += ["## Code Owner checklist", "",
            "<!-- The runner fills one row per criterion of .ai/gates/g5-pull-request.md. -->", "",
            "| G5 criterion | Self-check | Note |", "|--------------|------------|------|", ""]
    print("\n".join(out))
    for ac, why in gaps:
        sys.stderr.write(f"trace gap: {ac} — {why}\n")
    for slug in stale:
        sys.stderr.write(f"stale capability view: docs/specs/{slug}.md — run scripts/capability-views.py build {slug}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
