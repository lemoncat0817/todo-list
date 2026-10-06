#!/usr/bin/env python3
"""Start a change: take the next free NNNN, create its branch, and its folder from the artifact template."""

import argparse
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402

TYPES = ("feat", "fix", "refactor", "chore")
ARTIFACTS = ("change", "spec", "bug", "none")
NUMBER = re.compile(r"(?<!\d)(\d{4})-")


def used_numbers(root):
    """Every NNNN already taken on any local or remote branch, so parallel branches do not collide."""
    base = os.path.join(root, "docs", "changes")
    used = {int(d[:4]) for d in os.listdir(base) if re.match(r"\d{4}-", d)} if os.path.isdir(base) else set()
    refs = fa.git(root, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes").splitlines()
    for ref in refs:
        used |= {int(n) for n in NUMBER.findall(ref.rsplit("/", 1)[-1])}
        listing = fa.git(root, "ls-tree", "-d", "--name-only", ref, "docs/changes/")
        used |= {int(n) for n in re.findall(r"docs/changes/(\d{4})-", listing)}
    trailers = fa.git(root, "log", "--all", "--format=%B") if refs else ""
    used |= {int(n) for n in re.findall(r"^Refs:\s*(\d{4})\b", trailers, re.M)}
    return used


def template_path(root, artifact):
    for base in (os.path.join(root, ".ai", "templates"), os.path.join(root, "templates")):
        path = os.path.join(base, f"{artifact}.md")
        if os.path.isfile(path):
            return path
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Start a change (AGENTS.md §7, §12): next free number, branch <type>/NNNN-<slug>, "
                    "and docs/changes/NNNN-<slug>/<artifact>.md from the template.",
        epilog="Exit codes: 0 created · 2 usage error")
    parser.add_argument("slug", help="kebab-case name, e.g. note-limit")
    parser.add_argument("--type", choices=TYPES, required=True,
                        help="branch prefix: feat, fix, refactor, or chore (Cosmetic)")
    parser.add_argument("--artifact", choices=ARTIFACTS, default="change",
                        help="first artifact: change (Quick), spec (feature), bug (Standard defect), "
                             "none (Cosmetic or refactor; default: change)")
    parser.add_argument("--no-branch", action="store_true", help="stay on the current branch")
    args = parser.parse_args()

    if not fa.SLUG.match(args.slug):
        sys.stderr.write(f"Error: slug '{args.slug}' must be kebab-case: lowercase letters, digits, hyphens.\n")
        return 2
    root = fa.repo_root()
    number = f"{max(used_numbers(root), default=0) + 1:04d}"
    name = f"{number}-{args.slug}"
    branch = f"{args.type}/{name}"

    if not args.no_branch:
        if fa.git(root, "rev-parse", "--verify", "-q", f"refs/heads/{branch}"):
            sys.stderr.write(f"Error: branch {branch} already exists.\n")
            return 2
        out = subprocess.run(["git", "-C", root, "checkout", "-q", "-b", branch], capture_output=True, text=True)
        if out.returncode != 0:
            sys.stderr.write(f"Error: could not create branch {branch}: {out.stderr.strip()}\n")
            return 2

    created = None
    if args.artifact != "none":
        source = template_path(root, args.artifact)
        if not source:
            sys.stderr.write(f"Error: no {args.artifact}.md template under .ai/templates/ or templates/.\n")
            return 2
        folder = os.path.join(root, "docs", "changes", name)
        os.makedirs(folder, exist_ok=True)
        created = os.path.join(folder, f"{args.artifact}.md")
        with open(created, "w", encoding="utf-8") as fh:
            fh.write(fa.read(source).replace("NNNN-<slug>", name))

    print(f"Change    {name}")
    print(f"Branch    {branch}" + (" (not created: --no-branch)" if args.no_branch else ""))
    print(f"Artifact  {os.path.relpath(created, root) if created else 'none'}")
    print(f"Commits   Refs: {number} for records, Refs: {number}-T<n> for task work")
    return 0


if __name__ == "__main__":
    sys.exit(main())
