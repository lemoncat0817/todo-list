#!/usr/bin/env python3
"""Show where each change waits and what comes next, from the artifacts alone (the workflows' Resume tables)."""

import argparse
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402


def has_content(text):
    """True when a section holds more than its template placeholders."""
    if not text:
        return False
    body = fa.strip_comments(text)
    rows = [r for r in fa.table_rows(body) if not any("<" in c for c in r)]
    prose = [line for line in body.splitlines()
             if line.strip() and not line.strip().startswith("|") and "`<" not in line]
    return bool(rows or prose)


def approvals(doc):
    return {fa.bare(r[0]): fa.bare(r[1]) for r in fa.table_rows(doc.section("Approval") or "") if len(r) >= 2}


def load(folder, root, name):
    path = os.path.join(folder, name)
    return fa.load_doc(path, root) if os.path.isfile(path) else None


def quick_state(change, doc):
    if doc.type == "Enhancement" and doc.status != "Approved":
        return "Awaiting the opening OK (G2)", "reply OK, or name what to change (quick §3 step 2)"
    if approvals(doc).get("G5") == "Approved":
        return "G5 approved", "merge when the Code Owner says so (quick §3 step 10)"
    if not has_content(doc.section("Verification")):
        return "Implementing", "red → green → run it (quick §3 steps 4–6)"
    if not has_content(doc.section("Convergence")):
        return "Verified, not converged", f"python3 scripts/converge.py {change} (quick §3 step 7)"
    return "Converged", f"python3 scripts/pr-body.py {change}; open the PR and request G5 (quick §3 step 9)"


def task_counts(plan):
    rows = [r for r in fa.table_rows(plan.section("Task table") or "") if re.fullmatch(r"T\d+", fa.bare(r[0]))]
    done = sum(1 for r in rows if fa.bare(r[-1]).startswith("Done"))
    return done, len(rows)


def standard_state(change, folder, root):
    spec, bug = load(folder, root, "spec.md"), load(folder, root, "bug.md")
    design, plan = load(folder, root, "design.md"), load(folder, root, "plan.md")
    if bug and not has_content(bug.section("Triage")):
        return "Reported", "triage: severity and the source of expected behavior (bug-fix stage 2)"
    if spec and spec.status in ("Draft", "Proposed"):
        return f"Spec {spec.status}", f"/clarify {change}, then the G2 request (new-feature stages 3–4)"
    if design and design.status in ("Draft", "Proposed") and "Significant" in design.text:
        return "Design Significant, not approved", "the G3 request (new-feature stage 5)"
    if not plan:
        return "Spec approved, no plan", "design verdict and plan (new-feature stages 5–7)"
    if plan.status in ("Draft", "Proposed"):
        return f"Plan {plan.status}", f"/analyze {change}; the G4 request if an L3 task needs it (new-feature stage 7)"
    done, total = task_counts(plan)
    if done < total:
        return f"Tasks {done}/{total} done", f"/implement {change} (implementation §3)"
    if not os.path.isfile(os.path.join(folder, "review.md")):
        return "Tasks done", f"run it, python3 scripts/converge.py {change}, AI pre-review (implementation §7.7)"
    return "Reviewed", f"python3 scripts/pr-body.py {change}; open the PR and request G5"


def project_line(root):
    path = os.path.join(root, "docs", "project.md")
    if not os.path.isfile(path):
        return "Project   no docs/project.md — run /new-project"
    status = fa.bare(fa.header_fields(fa.read(path)).get("Status", "")).split(" ")[0]
    if status != "Approved":
        return f"Project   docs/project.md is {status or 'without a Status'} — awaiting G1 (/new-project)"
    return "Project   docs/project.md Approved"


def is_merged(root, rel, main_branch, on_main):
    """On the main branch, and this branch has not changed it since."""
    if not fa.git(root, "ls-tree", "-d", "--name-only", main_branch, rel):
        return False
    if on_main:
        return True
    return not fa.is_dirty(root, rel) and not fa.git(root, "diff", "--name-only", f"{main_branch}...HEAD", "--", rel)


def archived(root):
    path = os.path.join(root, "docs", "changes", "INDEX.md")
    return set(re.findall(r"`?(\d{4})-", fa.read(path))) if os.path.isfile(path) else set()


def other_branches(root, known, main_branch):
    """Unmerged changes that exist only on branches that are not checked out."""
    found = {}
    current = fa.git(root, "rev-parse", "--abbrev-ref", "HEAD")
    merged = set(fa.git(root, "branch", "--merged", main_branch, "--format=%(refname:short)").splitlines())
    for ref in fa.git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads").splitlines():
        m = re.search(r"/(\d{4})-[\w-]+$", ref)
        if m and ref != current and ref not in merged and m.group(1) not in known:
            found.setdefault(m.group(1), ref)
    return found


def main():
    parser = argparse.ArgumentParser(description="Where each change waits and what comes next (read-only).")
    parser.add_argument("--all", action="store_true", help="also list merged and archived changes")
    args = parser.parse_args()

    root = fa.repo_root()
    main_branch = fa.main_branch(root)
    on_main = fa.git(root, "rev-parse", "--abbrev-ref", "HEAD") == main_branch
    done = archived(root)
    print(project_line(root))
    print()

    rows, merged = [], 0
    for folder in fa.change_folders(root):
        name = os.path.basename(folder)
        change = name[:4]
        rel = os.path.relpath(folder, root)
        if is_merged(root, rel, main_branch, on_main):
            merged += 1
            if args.all:
                rows.append((name, "—", "Archived" if change in done else "Merged", "—"))
            continue
        quick = load(folder, root, "change.md")
        if quick:
            state, nxt = quick_state(change, quick)
            track = "Quick"
        else:
            state, nxt = standard_state(change, folder, root)
            track = "Standard"
        rows.append((name, track, state, nxt))

    for change, branch in sorted(other_branches(root, {os.path.basename(f)[:4] for f in fa.change_folders(root)}, main_branch).items()):
        rows.append((branch.split("/", 1)[-1], "—", f"on branch {branch}", f"git checkout {branch}"))

    if rows:
        print("| Change | Track | State | Next |")
        print("|--------|-------|-------|------|")
        for r in rows:
            print("| " + " | ".join(r) + " |")
    else:
        print("No change in progress. Start one with /quick, /new-feature, or /bug-fix.")
    if merged and not args.all:
        print(f"\n{merged} merged change(s) not shown (--all lists them).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
