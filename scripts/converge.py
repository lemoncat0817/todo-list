#!/usr/bin/env python3
"""Run the mechanical half of converge in one step: trace, capability views, changed files, commit hygiene."""

import argparse
import fnmatch
import importlib.util
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import framework_artifacts as fa  # noqa: E402


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


trace = load("fw_trace", "trace.py")
views = load("fw_views", "capability-views.py")
prbody = load("fw_pr_body", "pr-body.py")

# Records the workflow itself writes; never "unrequested".
RECORD_PATHS = ("docs/changes/", "docs/specs/")


def write_trace(root, folder, rows):
    block = trace.markdown(root, rows)
    for name in ("change.md", "test-plan.md"):
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            text = fa.replace_section(fa.read(path), "Trace table", block)
            if text is not None:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
                return os.path.relpath(path, root)
    return None


def build_views(root, slugs):
    """Rebuild the views of the declared capabilities; returns (written, skipped)."""
    model = fa.capability_model(root)
    written, skipped = [], []
    for slug in slugs:
        if slug not in model:
            skipped.append(slug)
            continue
        path = fa.view_path(root, slug)
        text = views.render(root, model[slug])
        if not os.path.isfile(path) or fa.read(path) != text:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
            written.append(os.path.relpath(path, root))
    return written, skipped


def changed_files(root, base):
    committed = fa.git(root, "diff", "--name-only", f"{base}...HEAD").splitlines()
    working = fa.git(root, "status", "--porcelain", "--untracked-files=all").splitlines()
    return sorted({*committed, *(line[3:].split(" -> ")[-1] for line in working)} - {""})


def task_scopes(folder):
    plan = os.path.join(folder, "plan.md")
    if not os.path.isfile(plan):
        return None
    scopes = []
    for line in fa.read(plan).splitlines():
        m = re.match(r"\s*-\s*\*{0,2}Scope:?\*{0,2}:?\s*(.+)", line)
        if m:
            scopes += [p.strip().rstrip("/") for p in re.findall(r"`([^`]+)`", m.group(1))]
    return scopes


def in_scope(path, scopes):
    return any(path == s or path.startswith(s + "/") or fnmatch.fnmatch(path, s) for s in scopes)


def main():
    parser = argparse.ArgumentParser(
        description="Converge a change (AGENTS.md §10): write the trace table, rebuild the declared capability "
                    "views, list changed files and commits without Refs:. Marking each AC met, partial, or "
                    "missing stays with the runner.",
        epilog="Exit codes: 0 nothing open · 1 an open item to resolve before the PR · 2 usage error")
    parser.add_argument("change", help="change ID or folder name, e.g. 0007")
    parser.add_argument("--junit", nargs="+", default=[], metavar="FILE",
                        help="JUnit XML reports; each AC's result then comes from its test cases")
    parser.add_argument("--base", help="branch to diff against (default: the main branch)")
    args = parser.parse_args()

    root = fa.repo_root()
    folder = fa.find_change(root, args.change)
    change = os.path.basename(folder)
    base = args.base or fa.main_branch(root)
    open_items = []

    acs, source, rows, gaps = trace.build(root, folder, args.junit)
    if not acs:
        sys.stderr.write(f"Error: no ACs found in {os.path.relpath(folder, root)}.\n")
        return 2
    target = write_trace(root, folder, rows)
    print(f"Trace     {len(acs)} AC(s) from {source}, {len(gaps)} gap(s)"
          + (f"; wrote {target}" if target else "; no Trace table section to write"))
    for ac, why in gaps:
        open_items.append(f"trace gap: {ac} — {why}")

    doc = fa.source_doc(folder, root)
    declared = doc.capabilities if doc else []
    if declared:
        written, skipped = build_views(root, declared)
        print(f"Views     {', '.join(declared)}: "
              + (f"rebuilt {', '.join(written)} — commit them with this change" if written else "up to date"))
        for slug in skipped:
            print(f"          {slug}: no approved criteria yet; rerun after the gate approval is recorded")
    else:
        print("Views     no capability declared")

    files = [f for f in changed_files(root, base) if not f.startswith(RECORD_PATHS)]
    scopes = task_scopes(folder)
    print(f"Changed   {len(files)} file(s) against {base}, change records excluded")
    for path in files:
        flag = ""
        if scopes is not None and not in_scope(path, scopes):
            flag = "  ← outside every task Scope: revert or justify under Unrequested"
            open_items.append(f"unrequested: {path}")
        print(f"          {path}{flag}")
    if scopes is None and files:
        print("          compare each file with the impact scope of the opening message; list the others under "
              "Unrequested")

    hygiene = prbody.commit_hygiene(root, base)
    print("Commits   " + hygiene.split(": ", 1)[-1])
    if "without" in hygiene:
        open_items.append("commits without Refs: — add the trailer on an unmerged branch, or state it at G5")

    print()
    if open_items:
        print(f"Open items for {change}:")
        for item in open_items:
            print(f"- {item}")
        return 1
    print(f"Nothing open for {change}. Mark each AC met, partial, or missing in Convergence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
