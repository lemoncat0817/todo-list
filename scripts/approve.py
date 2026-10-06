#!/usr/bin/env python3
"""Transcribe a human gate decision into an artifact's Approval table, bound to the commit the human reviewed."""

import argparse
import datetime
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402

GATES = {f"G{n}" for n in range(1, 8)}
# Gate outcomes and the Status each sets (policies/artifacts.md §5.3); Waived leaves Status unchanged.
OUTCOMES = {"Approved": "Approved", "Approved with conditions": "Approved", "Changes requested": "Draft",
            "Rejected": "Rejected", "Waived": None}
HEADER = "| Gate | Outcome | Approver | Date | Version | Conditions |\n|------|---------|----------|------|---------|------------|"
NOTE = "Recorded by an AI agent at the approver's instruction."


def resolve(root, change, artifact):
    if change in ("-", "none"):
        path = os.path.join(root, artifact)
    else:
        path = os.path.join(fa.find_change(root, change), artifact)
    if not os.path.isfile(path):
        sys.stderr.write(f"Error: {os.path.relpath(path, root)} does not exist.\n")
        sys.exit(2)
    return path


def add_row(text, row):
    if fa.section(text, "Approval") is None:
        return text.rstrip("\n") + f"\n\n## Approval\n\n{HEADER}\n{row}\n"
    out = []
    for title, body in fa.split_sections(text):
        if title is not None and title == "Approval":
            if "| Gate |" not in body:
                body = body.rstrip("\n") + f"\n\n{HEADER}\n"
            body = body.rstrip("\n") + f"\n{row}\n\n"
        out.append((f"## {title}\n" if title is not None else "") + body)
    return "".join(out).rstrip("\n") + "\n"


def set_status(text, outcome):
    return re.sub(r"^(\|\s*Status\s*\|)[^|\n]*(\|)", rf"\g<1> {outcome} \g<2>", text, count=1, flags=re.M)


def main():
    parser = argparse.ArgumentParser(
        description="Record a human gate decision (AGENTS.md §6). Run it only after the approver has said so.",
        epilog="Exit codes: 0 recorded · 2 usage error. The script edits the file and does not commit.")
    parser.add_argument("change", help="change ID (e.g. 0007), or '-' for a path from the repository root")
    parser.add_argument("artifact", help="file in the change folder (change.md, spec.md, …) or a path with '-'")
    parser.add_argument("gate", choices=sorted(GATES))
    parser.add_argument("--by", required=True, help="the human approver, e.g. 'Product Owner (maintainer)'")
    parser.add_argument("--outcome", choices=list(OUTCOMES), default="Approved")
    parser.add_argument("--conditions", default="None.", help="conditions stated by the approver")
    parser.add_argument("--version", help="reviewed commit; default: the last commit of the artifact")
    parser.add_argument("--no-status", action="store_true", help="leave the header Status row unchanged")
    args = parser.parse_args()

    root = fa.repo_root()
    path = resolve(root, args.change, args.artifact)
    rel = os.path.relpath(path, root)
    version = args.version
    if not version:
        if fa.is_dirty(root, rel) or not fa.last_commit(root, rel):
            sys.stderr.write(f"Error: commit {rel} first; an approval binds to the reviewed commit "
                             "(AGENTS.md §6). Or name it with --version.\n")
            return 2
        version = fa.last_commit(root, rel)
    if not re.fullmatch(r"[0-9a-f]{7,40}", version):
        sys.stderr.write(f"Error: --version must be a commit SHA, not '{version}'.\n")
        return 2

    if args.outcome in ("Approved with conditions", "Waived") and args.conditions.strip() in ("", "None."):
        sys.stderr.write(f"Error: '{args.outcome}' needs --conditions (the conditions, or the waiver's reason).\n")
        return 2
    conditions = args.conditions.strip().rstrip(".") + ". " + NOTE
    row = (f"| {args.gate} | {args.outcome} | {args.by} | {datetime.date.today().isoformat()} | "
           f"`{version}` | {conditions.replace('|', '/')} |")
    text = add_row(fa.read(path), row)
    if not args.no_status and OUTCOMES[args.outcome]:
        text = set_status(text, OUTCOMES[args.outcome])
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(row)
    sys.stderr.write(f"recorded {args.gate} {args.outcome} in {rel}; this transcribes a human decision — "
                     "commit it on the change branch.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
