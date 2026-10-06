#!/usr/bin/env python3
"""The /analyze consistency check (workflows/implementation.md §4.5) as a local script."""

import argparse
import datetime
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402

BLOCKING = {"A1", "A2", "A3", "A4", "A5", "A6"}
ROLES = {"PM", "Architect", "Tech Lead", "Frontend", "Backend", "QA", "Reviewer", "DevOps"}
BLOCK_FIELDS = ("Owner", "Covers", "Depends on", "Risk", "Source of truth", "Scope", "Constraints",
                "Done when", "Verification")
VAGUE = ("properly", "correctly", "appropriately", "as needed", "if possible", "reasonable", "works well",
         "and so on", "etc.", "適當", "正確地", "視需要", "盡量", "合理", "等等", "良好", "妥善")
NON_LAYER_ROOTS = {"docs", "test", "tests", "e2e", "scripts", ".github", ".ai"}
CONTRACT_DIR = "docs/architecture/openapi/"
PLACEHOLDER = re.compile(r"^`?<.*>`?$")


def table_dicts(text):
    """Rows of the first table in text as dicts keyed by its header cells."""
    lines = [l for l in fa.strip_comments(text or "").splitlines() if l.strip().startswith("|")]
    if len(lines) < 2:
        return []
    keys = [c.strip() for c in lines[0].strip().strip("|").split("|")]
    rows = []
    for line in lines[2:]:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(dict(zip(keys, cells + [""] * (len(keys) - len(cells)))))
    return rows


def task_blocks(plan_text):
    blocks = {}
    for title, body in fa.split_sections(fa.section(plan_text, "Task blocks") or "", 3):
        m = re.match(r"`?(T\d+)`?\s*(?:[—–-]\s*(.*))?$", title or "")
        if not m:
            continue
        fields = {"Title": (m.group(2) or "").strip()}
        for line in body.splitlines():
            f = re.match(r"^\s*-\s*([A-Za-z ]+):\s*(.*)$", line)
            if f and f.group(1).strip() not in fields:
                fields[f.group(1).strip()] = f.group(2).strip()
        blocks[m.group(1)] = fields
    return blocks


def scope_paths(scope):
    paths = []
    for token in re.findall(r"`([^`]+)`", scope or ""):
        token = token.strip()
        if " " in token or re.fullmatch(r"(\d{4}-)?(AC|T|R)\d+", token):
            continue
        if "/" in token or re.search(r"\.\w+$", token):
            paths.append(token.rstrip("/") + ("/" if token.endswith("/") else ""))
    return paths


def overlaps(a, b):
    a_dir, b_dir = a.rstrip("/") + "/", b.rstrip("/") + "/"
    return a == b or b.startswith(a_dir) or a.startswith(b_dir)


def is_enabler(covers):
    return "enabler" in fa.strip_code(covers).lower()


def enabler_reason(covers):
    m = re.search(r"Enabler\s*[:：—–-]\s*(.+)", fa.strip_code(covers), re.I)
    return m.group(1).strip() if m and not PLACEHOLDER.match(m.group(1).strip()) else ""


def git(root, *args):
    out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else ""


def plan_commit(root, rel):
    sha = git(root, "log", "-1", "--format=%h", "--", rel) or "uncommitted"
    dirty = subprocess.run(["git", "-C", root, "diff", "--quiet", "HEAD", "--", rel]).returncode != 0
    return sha + (" + uncommitted edits" if dirty and sha != "uncommitted" else "")


class Analysis:
    def __init__(self, root, folder):
        self.root, self.folder = root, folder
        self.rel = os.path.relpath(folder, root)
        self.findings = []
        self.plan_path = os.path.join(folder, "plan.md")
        self.plan = fa.read(self.plan_path)
        self.plan_header = fa.header_fields(self.plan)
        self.upstream = None
        for name in ("spec.md", "bug.md"):
            if os.path.isfile(os.path.join(folder, name)):
                self.upstream = fa.load_doc(os.path.join(folder, name), root)
                break

    def add(self, check, where, finding):
        self.findings.append((check, where, finding))

    def run(self):
        table = {fa.bare(r.get("ID", "")): r for r in table_dicts(fa.section(self.plan, "Task table"))
                 if re.fullmatch(r"T\d+", fa.bare(r.get("ID", "")))}
        blocks = task_blocks(self.plan)
        readiness = {fa.bare(r.get("Check", "")): r for r in table_dicts(fa.section(self.plan, "Readiness checklist"))}
        tasks = sorted(set(table) | set(blocks), key=lambda t: int(t[1:]))

        if self.upstream:
            required = [c.id for c in self.upstream.criteria()]
            source = os.path.basename(self.upstream.path)
        else:
            required = expand_invariants(self.plan)
            source = "plan.md#Invariants or Skeleton criteria"
        covers = {t: fa.expand_ac_list(table.get(t, {}).get("Covers", "") + " " + blocks.get(t, {}).get("Covers", ""))
                  for t in tasks}

        covered = {ac for acs in covers.values() for ac in acs}
        for ac in required:
            if ac not in covered:
                self.add("A1", f"{source}#{ac}", f"{ac} is covered by no task")

        for t in tasks:
            cov_text = table.get(t, {}).get("Covers", "") + " " + blocks.get(t, {}).get("Covers", "")
            unknown = [ac for ac in covers[t] if required and ac not in required]
            if unknown:
                self.add("A2", f"plan.md#{t}", f"covers {', '.join(unknown)}, not defined in {source}")
            if not covers[t] or unknown == covers[t]:
                if not is_enabler(cov_text):
                    self.add("A2", f"plan.md#{t}", "covers no AC and is not marked Enabler")
                elif not enabler_reason(blocks.get(t, {}).get("Covers", "")):
                    self.add("A2", f"plan.md#{t}", "Enabler without a reason in its task block")

        self.check_a3(tasks, table, blocks)
        self.check_a4(tasks, blocks, readiness)
        self.check_a5()
        self.check_a6_n1(tasks, table, blocks)
        self.check_n2_n3(tasks, blocks)
        self.check_n4(readiness)
        return self.findings

    def check_a3(self, tasks, table, blocks):
        if self.upstream and self.upstream.kind == "spec" and self.upstream.status != "Approved":
            self.add("A3", "spec.md#Status", f"the plan builds on a spec whose Status is {self.upstream.status or 'unset'}, not Approved")
        l3_rows = {fa.bare(r.get("Task", "")): r for r in table_dicts(fa.section(self.plan, "L3 items for G4"))}
        adr_dir = os.path.join(self.root, "docs", "architecture", "adr")
        adrs = set(re.findall(r"ADR-\d{4}", " ".join(os.listdir(adr_dir)))) if os.path.isdir(adr_dir) else set()
        for t in tasks:
            risk = fa.bare(blocks.get(t, {}).get("Risk", "") or table.get(t, {}).get("Risk", ""))
            if "L3" in risk:
                ref = fa.bare(l3_rows.get(t, {}).get("Approval reference", ""))
                if not ref or PLACEHOLDER.match(ref) or ref.startswith("N/A"):
                    self.add("A3", f"plan.md#{t}", "L3 task without an approval reference in L3 items for G4")
            for adr in re.findall(r"ADR-\d{4}", blocks.get(t, {}).get("Source of truth", "")):
                if adr not in adrs:
                    self.add("A3", f"plan.md#{t}", f"cites {adr}, which is not in docs/architecture/adr/")

    def check_a4(self, tasks, blocks, readiness):
        contract = fa.bare(readiness.get("RC-CONTRACT", {}).get("Result", ""))
        for t in tasks:
            paths = scope_paths(blocks.get(t, {}).get("Scope", ""))
            roots = {p.split("/")[0] for p in paths if "/" in p} - NON_LAYER_ROOTS
            touches_contract = any(p.startswith(CONTRACT_DIR) for p in paths)
            if (len(roots) > 1 or touches_contract) and not contract.startswith("Met"):
                why = f"spans {', '.join(sorted(roots))}" if len(roots) > 1 else "changes a contract"
                self.add("A4", f"plan.md#{t}", f"cross-layer task ({why}) while RC-CONTRACT is '{contract or 'unset'}'")

    def check_a5(self):
        doc = self.upstream
        if not doc or doc.kind != "spec":
            return
        baseline = doc.baseline()
        rows = dict(baseline or [])
        lines = doc.supersessions()
        referenced = sorted({q.split("-")[0] for q in [t for _, t, _ in lines] + list(rows)})
        model = fa.capability_model(self.root, exclude=[doc.change],
                                    seeds={slug: referenced for slug in doc.capabilities})
        base_current = {q for slug in doc.capabilities if slug in model for q, _, _ in model[slug].current}
        for new, target, reason in lines:
            disposition = rows.get(target)
            if disposition is None:
                self.add("A5", f"spec.md#Baseline", f"{'Supersedes' if new else 'Revokes'}: {target} is not listed in the Baseline")
            elif new and not re.search(rf"Superseded by `?{new}\b", disposition):
                self.add("A5", f"spec.md#Baseline", f"{target} is superseded by {new} but its disposition is '{disposition}'")
            elif not new and not disposition.startswith("Revoked"):
                self.add("A5", f"spec.md#Baseline", f"{target} is revoked but its disposition is '{disposition}'")
        targets = {t for _, t, _ in lines}
        for criterion, disposition in (baseline or []):
            if (disposition.startswith("Superseded") or disposition.startswith("Revoked")) and criterion not in targets:
                self.add("A5", f"spec.md#Baseline", f"{criterion} is marked '{disposition}' but no Supersedes: or Revokes: line names it")
            if base_current and criterion not in base_current:
                self.add("A5", f"spec.md#Baseline", f"{criterion} is not a current criterion of {', '.join(doc.capabilities)}")
        if base_current and not baseline:
            self.add("A5", "spec.md#Baseline", f"Baseline is empty or N/A, but {', '.join(doc.capabilities)} has "
                                               f"{len(base_current)} current criteria")
        if not doc.capabilities and (lines or baseline):
            self.add("A5", "spec.md#Capabilities", "the spec changes existing criteria but names no capability")

    def check_a6_n1(self, tasks, table, blocks):
        for t in tasks:
            if t not in blocks:
                self.add("A6", f"plan.md#{t}", "in the Task table but has no task block (AGENTS.md §8)")
                continue
            if t not in table:
                self.add("A6", f"plan.md#{t}", "has a task block but no Task table row")
            b = blocks[t]
            missing = [f for f in BLOCK_FIELDS if not b.get(f) or PLACEHOLDER.match(b[f])]
            if missing:
                self.add("A6", f"plan.md#{t}", f"task block lacks {', '.join(missing)} (AGENTS.md §8)")
            owner = fa.bare(b.get("Owner", ""))
            role = re.sub(r"\s*Agent\b.*$", "", owner)
            if owner and role not in ROLES:
                self.add("A6", f"plan.md#{t}", f"owner '{owner}' is not an agent role (AGENTS.md §4)")
            risk = fa.bare(b.get("Risk", ""))
            if risk and not re.match(r"L[123]\b", risk):
                self.add("A6", f"plan.md#{t}", f"risk '{risk}' is not one of L1, L2, L3 (L4 is a human decision)")
            for dep in re.findall(r"\bT\d+\b", fa.strip_code(b.get("Depends on", ""))):
                if dep not in tasks:
                    self.add("A6", f"plan.md#{t}", f"depends on {dep}, which the plan does not define")
            if t in table:
                row = table[t]
                for key in ("Owner", "Risk", "Title"):
                    a, c = fa.bare(row.get(key, "")), fa.bare(b.get(key, ""))
                    if key == "Risk":
                        a, c = a[:2], c[:2]
                    if a and c and a != c:
                        self.add("N1", f"plan.md#{t}", f"{key} differs: Task table '{a}', task block '{c}'")
                ta = fa.expand_ac_list(row.get("Covers", ""))
                tb = fa.expand_ac_list(b.get("Covers", ""))
                only_table, only_block = [x for x in ta if x not in tb], [x for x in tb if x not in ta]
                if ta and tb and (only_table or only_block):
                    self.add("N1", f"plan.md#{t}", "Covers differs between Task table and task block: "
                             f"only in the table {', '.join(only_table) or 'none'}; "
                             f"only in the block {', '.join(only_block) or 'none'}")

    def check_n2_n3(self, tasks, blocks):
        for t in tasks:
            done = blocks.get(t, {}).get("Done when", "")
            hits = [w for w in VAGUE if w in done.lower()]
            if hits:
                self.add("N2", f"plan.md#{t}", f"Done when uses '{hits[0]}', which is not binary")
        deps = {t: set(re.findall(r"\bT\d+\b", fa.strip_code(blocks.get(t, {}).get("Depends on", "")))) for t in tasks}

        def reaches(a, b, seen=()):
            return b in deps.get(a, set()) or any(reaches(x, b, seen + (a,)) for x in deps.get(a, set()) if x not in seen)

        for i, a in enumerate(tasks):
            for b in tasks[i + 1:]:
                shared = [p for p in scope_paths(blocks.get(a, {}).get("Scope", ""))
                          for q in scope_paths(blocks.get(b, {}).get("Scope", "")) if overlaps(p, q)]
                if shared and not reaches(a, b) and not reaches(b, a):
                    self.add("N3", f"plan.md#{a},{b}", f"scopes overlap on {shared[0]} with no dependency between them")

    def check_n4(self, readiness):
        row = readiness.get("RC-TESTLEFT")
        result = fa.bare(row.get("Result", "")) if row else ""
        if not result or PLACEHOLDER.match(result):
            self.add("N4", "plan.md#Readiness checklist", "RC-TESTLEFT has no recorded decision")


def expand_invariants(plan_text):
    return fa.plan_criteria(plan_text)


def previous_resolutions(plan_text):
    found = {}
    for r in table_dicts(fa.section(plan_text, "Consistency check")):
        res = r.get("Resolution", "")
        if res and not res.strip("` ").startswith("open"):
            found[(fa.bare(r.get("Check", "")), fa.bare(r.get("Artifact and location", "")), r.get("Finding", ""))] = res
    return found


def markdown(findings, run_line, resolutions):
    out = [f"- **Run:** {run_line}", ""]
    rows = []
    for i, (check, where, finding) in enumerate(findings, 1):
        finding = finding.replace("|", "/")
        res = resolutions.get((check, where, finding), "open")
        rows.append(f"| F{i} | {check} | `{where}` | {finding} | {res} |")
    if not rows:
        out += ["No findings.", ""]
    out += ["| ID | Check | Artifact and location | Finding | Resolution |",
            "|----|-------|-----------------------|---------|------------|"] + rows
    return "\n".join(out) + "\n"


def write_section(plan_text, block):
    sections = fa.split_sections(plan_text)
    out = []
    for title, body in sections:
        if title is not None and title.lower().startswith("consistency check"):
            comment = re.search(r"<!--.*?-->", body, re.S)
            body = "\n" + (comment.group(0) + "\n\n" if comment else "") + block + "\n"
        out.append((f"## {title}\n" if title is not None else "") + body)
    return "".join(out)


def main():
    parser = argparse.ArgumentParser(
        description="Run the /analyze consistency check (A1–A6, N1–N4) on a change's plan.md.",
        epilog="Exit codes: 0 no open blocking finding · 1 open blocking finding · 2 usage error")
    parser.add_argument("change", help="change ID or folder name, e.g. 0007 or 0007-password-reset")
    parser.add_argument("--write", action="store_true",
                        help="replace the Consistency check section of a Draft plan.md with the result")
    args = parser.parse_args()

    root = fa.repo_root()
    folder = fa.find_change(root, args.change)
    rel_plan = os.path.relpath(os.path.join(folder, "plan.md"), root)
    if not os.path.isfile(os.path.join(root, rel_plan)):
        sys.stderr.write(f"Error: {rel_plan} does not exist; /analyze runs on a Draft plan.\n")
        return 2
    analysis = Analysis(root, folder)
    status = fa.bare(analysis.plan_header.get("Status", ""))
    if args.write and status != "Draft":
        sys.stderr.write(f"Error: {rel_plan} is {status or 'without a Status'}, not Draft. An Approved plan changes "
                         "only through .ai/policies/artifacts.md §5.4; the check was not written.\n")
        return 2
    if fa.section(analysis.plan, "Consistency check") is None and args.write:
        sys.stderr.write(f"Error: {rel_plan} has no 'Consistency check' section (.ai/templates/plan.md).\n")
        return 2

    findings = analysis.run()
    findings.sort(key=lambda f: (f[0] not in BLOCKING, f[0]))
    run_line = (f"{datetime.date.today().isoformat()} on plan commit `{plan_commit(root, rel_plan)}` — "
                "`scripts/analyze.py`")
    resolutions = previous_resolutions(analysis.plan)
    block = markdown(findings, run_line, resolutions)
    print(block, end="")

    if args.write:
        with open(os.path.join(root, rel_plan), "w", encoding="utf-8") as fh:
            fh.write(write_section(analysis.plan, block))
        sys.stderr.write(f"wrote the Consistency check section of {rel_plan}\n")

    open_blocking = [f for f in findings if f[0] in BLOCKING and resolutions.get((f[0], f[1], f[2].replace("|", "/")), "open") == "open"]
    sys.stderr.write(f"{len(findings)} finding(s), {len(open_blocking)} open blocking\n")
    return 1 if open_blocking else 0


if __name__ == "__main__":
    sys.exit(main())
