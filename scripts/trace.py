#!/usr/bin/env python3
"""Build a change's trace table — AC → tasks → tests → result — from the tests that carry each qualified AC ID."""

import argparse
import datetime
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402

SKIP_DIRS = ("docs/", ".ai/", ".claude/", ".cursor/", ".github/", "node_modules/", "scripts/")
SKIP_EXT = (".md", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".lock", ".pdf", ".zip", ".jar", ".woff", ".woff2")
MAX_BYTES = 1_000_000


def criteria(root, folder):
    doc = fa.source_doc(folder, root)
    if doc:
        return [c.id for c in doc.criteria()], os.path.basename(doc.path)
    plan = os.path.join(folder, "plan.md")
    if os.path.isfile(plan):
        return fa.plan_criteria(fa.read(plan)), "plan.md"
    return [], None


def task_map(folder):
    """AC → tasks from the plan's Task table; a change without a plan is the single task T1."""
    plan = os.path.join(folder, "plan.md")
    if not os.path.isfile(plan):
        return None
    mapping = {}
    for row in fa.table_rows(fa.section(fa.read(plan), "Task table") or ""):
        task = fa.bare(row[0])
        if re.fullmatch(r"T\d+", task) and len(row) >= 4:
            for ac in fa.expand_ac_list(row[3]):
                mapping.setdefault(ac, []).append(task)
    return mapping


def find_tests(root, change):
    pattern = re.compile(rf"\b{change}-AC(\d+)\b")
    found = {}
    for rel in fa.git(root, "ls-files").splitlines():
        if rel.startswith(SKIP_DIRS) or rel.lower().endswith(SKIP_EXT):
            continue
        path = os.path.join(root, rel)
        try:
            if os.path.getsize(path) > MAX_BYTES:
                continue
            with open(path, encoding="utf-8", errors="ignore") as fh:
                lines = fh.read().splitlines()
        except OSError:
            continue
        for n, line in enumerate(lines, 1):
            for m in pattern.finditer(line):
                name = re.sub(r"\s+", " ", line.strip())[:90]
                found.setdefault(f"AC{m.group(1)}", []).append((rel, n, name))
    return found


def junit_results(paths, change):
    """AC → list of 'pass' / 'fail' / 'skipped' from JUnit XML test cases whose name carries the qualified ID."""
    pattern = re.compile(rf"\b{change}-AC(\d+)\b")
    results = {}
    for path in paths:
        for case in ET.parse(path).iter("testcase"):
            name = f"{case.get('classname', '')} {case.get('name', '')}"
            outcome = "pass"
            if case.find("failure") is not None or case.find("error") is not None:
                outcome = "fail"
            elif case.find("skipped") is not None:
                outcome = "skipped"
            for m in pattern.finditer(name):
                results.setdefault(f"AC{m.group(1)}", []).append(outcome)
    return results


def build(root, folder, junit=()):
    change = os.path.basename(folder)[:4]
    acs, source = criteria(root, folder)
    tasks = task_map(folder)
    tests = find_tests(root, change)
    results = junit_results(junit, change) if junit else {}
    rows, gaps = [], []
    for ac in acs:
        hits = tests.get(ac, [])
        outcomes = results.get(ac, [])
        if not hits and not outcomes:
            result = "no test"
        elif "fail" in outcomes:
            result = "fail"
        elif outcomes and all(o == "skipped" for o in outcomes):
            result = "skipped"
        elif outcomes:
            result = "pass"
        else:
            result = "covered — suite result in Verification"
        if result in ("no test", "fail", "skipped"):
            gaps.append((ac, result))
        task = ", ".join(tasks.get(ac, [])) if tasks is not None else "T1"
        cells = "<br>".join(f"`{rel}:{n}` {name.replace('|', '/')}" for rel, n, name in hits[:3])
        if len(hits) > 3:
            cells += f"<br>… {len(hits) - 3} more"
        rows.append(f"| {ac} | {task or '—'} | {cells or '—'} | {result} |")
    return acs, source, rows, gaps


def markdown(root, rows):
    sha = fa.git(root, "rev-parse", "--short", "HEAD") or "uncommitted"
    head = [f"- **Run:** {datetime.date.today().isoformat()} on commit `{sha}` — `scripts/trace.py`", "",
            "| AC | Tasks | Tests | Result |", "|----|-------|-------|--------|"]
    return "\n".join(head + rows) + "\n"


def main():
    parser = argparse.ArgumentParser(
        description="Trace a change's ACs to the tests that carry their qualified IDs (AGENTS.md §10).",
        epilog="Exit codes: 0 every AC has a test and none failed · 1 a gap · 2 usage error")
    parser.add_argument("change", help="change ID or folder name, e.g. 0007")
    parser.add_argument("--junit", nargs="+", default=[], metavar="FILE",
                        help="JUnit XML reports; each AC's result then comes from its test cases")
    parser.add_argument("--write", action="store_true",
                        help="write the Trace table section of change.md, or of test-plan.md")
    args = parser.parse_args()

    root = fa.repo_root()
    folder = fa.find_change(root, args.change)
    acs, source, rows, gaps = build(root, folder, args.junit)
    if not acs:
        sys.stderr.write(f"Error: no ACs found in {os.path.relpath(folder, root)} "
                         "(change.md, spec.md, bug.md, or plan.md Invariants or Skeleton criteria).\n")
        return 2
    block = markdown(root, rows)
    print(block, end="")

    if args.write:
        for name in ("change.md", "test-plan.md"):
            path = os.path.join(folder, name)
            if os.path.isfile(path):
                text = fa.replace_section(fa.read(path), "Trace table", block)
                if text is None:
                    continue
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(text)
                sys.stderr.write(f"wrote the Trace table section of {os.path.relpath(path, root)}\n")
                break
        else:
            sys.stderr.write("Error: neither change.md nor test-plan.md has a 'Trace table' section.\n")
            return 2

    for ac, why in gaps:
        sys.stderr.write(f"gap: {ac} — {why}\n")
    sys.stderr.write(f"{len(acs)} AC(s) from {source}, {len(gaps)} gap(s)\n")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main())
