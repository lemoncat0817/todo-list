"""Parsing helpers for framework artifacts, shared by the scripts in this folder."""

import os
import re
import subprocess
import sys
from dataclasses import dataclass, field

AC_ID = re.compile(r"\bAC(\d+)\b")
QUALIFIED_AC = re.compile(r"\b(\d{4})-AC(\d+)\b")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
FENCE = re.compile(r"^\s*(```|~~~)")
APPROVED_STATUSES = {"Approved"}
CLOSED_STATUSES = {"Rejected", "Cancelled"}


def repo_root():
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sys.stderr.write("Error: not inside a Git repository.\n")
        sys.exit(2)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def strip_comments(text):
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def strip_code(text):
    return re.sub(r"`", "", text)


def split_sections(text, level=2):
    """Return [(title, body)] for headings of the given level, ignoring headings inside code fences."""
    marker = "#" * level + " "
    sections, title, body, in_fence = [], None, [], False
    for line in text.splitlines(keepends=True):
        if FENCE.match(line):
            in_fence = not in_fence
        if not in_fence and line.startswith(marker):
            if title is not None or body:
                sections.append((title, "".join(body)))
            title, body = line[len(marker):].strip(), []
        else:
            body.append(line)
    sections.append((title, "".join(body)))
    return sections


def section(text, name, level=2):
    for title, body in split_sections(text, level):
        if title is not None and title.lower().startswith(name.lower()):
            return body
    return None


def table_rows(text):
    """Rows of every Markdown table in text, as lists of stripped cells, without header and rule rows."""
    def cells(line):
        return [c.strip() for c in line.strip().strip("|").split("|")]

    def is_rule(line):
        s = line.strip()
        return s.startswith("|") and all(re.fullmatch(r":?-{2,}:?", c) for c in cells(s) if c)

    rows = []
    lines = strip_comments(text).splitlines()
    for i, line in enumerate(lines):
        if not line.strip().startswith("|") or is_rule(line):
            continue
        if i + 1 < len(lines) and is_rule(lines[i + 1]):
            continue
        rows.append(cells(line))
    return rows


def plan_criteria(plan_text):
    """ACs a plan holds itself: a refactor's Invariants, or a walking skeleton's Skeleton criteria."""
    bodies = [section(section(plan_text, "Behavior preservation") or "", "Invariants", 3),
              section(plan_text, "Skeleton criteria")]
    return [bare(r[0]) for body in bodies if body for r in table_rows(body) if re.fullmatch(r"AC\d+", bare(r[0]))]


def header_fields(text):
    fields = {}
    for title, body in split_sections(text):
        for row in table_rows(body):
            if len(row) >= 2:
                fields.setdefault(row[0], row[1])
        break
    return fields


def bare(cell):
    return strip_code(cell).strip()


def expand_ac_list(text):
    """Local AC IDs named in text; ranges such as AC1–AC5, AC1-AC5, AC1 to AC5, AC1 至 AC5 are expanded."""
    text = QUALIFIED_AC.sub("", strip_code(text))
    text = re.sub(r"\bAC(\d+)\s*(?:–|—|-|~|to|至|到)\s*AC(\d+)\b",
                  lambda m: " ".join(f"AC{n}" for n in range(int(m.group(1)), int(m.group(2)) + 1)), text)
    seen = []
    for n in AC_ID.findall(text):
        if f"AC{n}" not in seen:
            seen.append(f"AC{n}")
    return seen


def ac_sort_key(ac_id):
    m = re.search(r"(?:(\d{4})-)?AC(\d+)", ac_id)
    return (int(m.group(1) or 0), int(m.group(2))) if m else (0, 0)


@dataclass
class Criterion:
    id: str
    title: str
    requirement: str
    body: str


@dataclass
class Doc:
    path: str
    kind: str
    change: str
    folder: str
    text: str
    header: dict = field(default_factory=dict)

    @property
    def status(self):
        return bare(self.header.get("Status", "")).split(" ")[0]

    @property
    def type(self):
        return bare(self.header.get("Type", "")).split(" ")[0]

    @property
    def is_defect(self):
        return self.kind == "bug" or (self.kind == "change" and self.type == "Defect")

    @property
    def capabilities(self):
        value = self.header.get("Capabilities", "")
        value = value.split("—")[0]
        return [c for c in re.findall(r"`([^`]+)`", value) if SLUG.match(c)] or \
               [c.strip() for c in strip_code(value).split(",") if SLUG.match(c.strip())]

    def section(self, name):
        return section(self.text, name)

    def criteria(self):
        """Acceptance criteria in heading form (### `AC1` — title) or table form (| `AC1` | … |)."""
        found = {}
        bodies = [section(self.text, name) for name in ("Acceptance criteria", "Corrected behavior")]
        for body in filter(None, bodies):
            for title, sub in split_sections(body, 3):
                if title is None:
                    for row in table_rows(sub):
                        self._table_criterion(row, found)
                    continue
                m = re.match(r"`?(AC\d+)`?\s*(?:[—–-]\s*(.*))?$", title)
                if not m:
                    continue
                lines = sub.strip("\n").splitlines()
                requirement = ""
                kept = []
                for line in lines:
                    req = re.match(r"\s*-\s*\*\*Requirement:\*\*\s*(.*)", line)
                    if req and not requirement:
                        requirement = bare(req.group(1))
                        continue
                    kept.append(line)
                found[m.group(1)] = Criterion(m.group(1), (m.group(2) or "").strip().strip("`"), requirement,
                                              "\n".join(kept).strip("\n"))
        return [found[k] for k in sorted(found, key=ac_sort_key)]

    @staticmethod
    def _table_criterion(row, found):
        ident = bare(row[0])
        if not re.fullmatch(r"AC\d+", ident) or len(row) < 2:
            return
        if len(row) >= 3 and re.fullmatch(r"R\d+", bare(row[1])):
            requirement, text = bare(row[1]), row[2]
        else:
            requirement, text = "", row[-1] if len(row) == 2 else row[1]
        if not text or text.startswith("<") or text == "`<…>`":
            return
        found[ident] = Criterion(ident, short_title(text), requirement, text)

    def supersessions(self):
        """[(new AC or None, qualified target, reason or None)] from Supersedes: and Revokes: lines."""
        results = []
        text = strip_comments(self.text)
        for line in text.splitlines():
            plain = strip_code(line)
            if "Supersedes:" in plain:
                head, _, tail = plain.partition("Supersedes:")
                news = AC_ID.findall(re.sub(r"\d{4}-AC\d+", "", head))
                new = f"AC{news[0]}" if news else None
                for target in QUALIFIED_AC.finditer(tail):
                    results.append((new, f"{target.group(1)}-AC{target.group(2)}", None))
            for m in re.finditer(r"Revokes:\s*(\d{4})-AC(\d+)\s*(?:[—–:-]+\s*(.*))?", plain):
                results.append((None, f"{m.group(1)}-AC{m.group(2)}", (m.group(3) or "").strip() or None))
        unique = []
        for item in results:
            if item not in unique:
                unique.append(item)
        return unique

    def baseline(self):
        body = self.section("Baseline")
        if body is None:
            return None
        rows = []
        for row in table_rows(body):
            m = QUALIFIED_AC.search(strip_code(row[0]))
            if m and len(row) >= 2:
                rows.append((f"{m.group(1)}-AC{m.group(2)}", bare(row[-1])))
        return rows

    def approval_date(self):
        date = ""
        for row in table_rows(self.section("Approval") or ""):
            if len(row) >= 4 and bare(row[1]).startswith("Approved"):
                date = bare(row[3])
        return date


def short_title(text, limit=48):
    plain = strip_code(text).strip()
    first = re.split(r"(?<=[。．!?！？])|(?<=\.)\s", plain, maxsplit=1)[0].rstrip("。. ")
    return first if len(first) <= limit else first[:limit].rstrip() + "…"


def load_doc(path, root):
    rel = os.path.relpath(path, root)
    folder = os.path.basename(os.path.dirname(path))
    m = re.match(r"(\d{4})", folder)
    text = read(path)
    kind = os.path.splitext(os.path.basename(path))[0]
    return Doc(rel, kind, m.group(1) if m else "", folder, text, header_fields(text))


def change_folders(root):
    base = os.path.join(root, "docs", "changes")
    if not os.path.isdir(base):
        return []
    return sorted(os.path.join(base, d) for d in os.listdir(base)
                  if re.match(r"\d{4}", d) and os.path.isdir(os.path.join(base, d)))


def find_change(root, change):
    if "/" in change or change.startswith("."):
        sys.stderr.write(f"Error: expected a change ID or folder name, not a path: '{change}'\n")
        sys.exit(2)
    matches = [d for d in change_folders(root)
               if os.path.basename(d) == change or os.path.basename(d).startswith(change + "-")]
    if len(matches) != 1:
        what = "no change folder" if not matches else "more than one change folder"
        sys.stderr.write(f"Error: {what} matches '{change}' under docs/changes/.\n")
        sys.exit(2)
    return matches[0]


SOURCE_NAMES = ("spec.md", "bug.md", "change.md")


def source_doc(folder, root):
    """The artifact that holds a change's criteria: spec.md, bug.md, or change.md (Quick track)."""
    for name in SOURCE_NAMES:
        path = os.path.join(folder, name)
        if os.path.isfile(path):
            return load_doc(path, root)
    return None


def source_docs(root):
    """spec.md, bug.md, and change.md of every change, in change order."""
    docs = []
    for folder in change_folders(root):
        for name in SOURCE_NAMES:
            path = os.path.join(folder, name)
            if os.path.isfile(path):
                docs.append(load_doc(path, root))
    return docs


def is_effective(doc):
    """A spec or an Enhancement change.md counts once Approved at G2; a defect or cosmetic record counts unless closed."""
    if doc.kind == "spec" or (doc.kind == "change" and doc.type == "Enhancement"):
        return doc.status in APPROVED_STATUSES
    return doc.status not in CLOSED_STATUSES


@dataclass
class Capability:
    slug: str
    sources: list
    inferred: list
    current: list
    history: list


def view_path(root, slug):
    return os.path.join(root, "docs", "specs", f"{slug}.md")


def view_upstream_changes(root, slug):
    path = view_path(root, slug)
    if not os.path.isfile(path):
        return []
    return re.findall(r"docs/changes/(\d{4})-", header_fields(read(path)).get("Upstream", ""))


def capability_model(root, exclude=(), seeds=None):
    """Current criteria and history of every capability, computed from the change specs alone."""
    seeds = seeds or {}
    docs = [d for d in source_docs(root) if is_effective(d) and d.change not in exclude]
    by_change = {}
    for d in docs:
        if d.change not in by_change or d.kind == "spec":
            by_change[d.change] = d

    replaced = {}
    for d in docs:
        for new, target, reason in d.supersessions():
            replaced.setdefault(target, []).append((f"{d.change}-{new}" if new else None, reason, d))

    slugs = set(seeds)
    for d in docs:
        slugs.update(d.capabilities)
    specs_dir = os.path.join(root, "docs", "specs")
    if os.path.isdir(specs_dir):
        slugs.update(os.path.splitext(f)[0] for f in os.listdir(specs_dir) if f.endswith(".md"))

    model = {}
    for slug in sorted(slugs):
        tagged = [d.change for d in docs if slug in d.capabilities]
        legacy = set(seeds.get(slug, [])) | set(view_upstream_changes(root, slug))
        for change in tagged:
            d = by_change[change]
            refs = [t for _, t, _ in d.supersessions()] + [c for c, _ in (d.baseline() or [])]
            legacy.update(r.split("-")[0] for r in refs)
        legacy = {c for c in legacy if c in by_change and not by_change[c].capabilities}
        members = sorted(set(tagged) | legacy, reverse=True)

        current, history = [], []
        for change in members:
            d = by_change[change]
            for c in d.criteria():
                qid = f"{change}-{c.id}"
                if d.is_defect and c.id not in {n for n, _, _ in d.supersessions()}:
                    continue
                if qid in replaced:
                    for new, reason, by in replaced[qid]:
                        history.append((qid, new or f"Revoked — {reason or 'no reason given'}", by.folder,
                                        by.approval_date() or "—", by.change))
                else:
                    current.append((qid, c, d))
        history.sort(key=lambda h: (-int(h[4]), ac_sort_key(h[0])))
        if current or history:
            model[slug] = Capability(slug, [by_change[c] for c in members], sorted(legacy), current, history)
    return model


def replace_section(text, name, block):
    """Replace the body of the level-2 section `name`, keeping its leading comment; None when there is no such section."""
    out, found = [], False
    for title, body in split_sections(text):
        if title is not None and title.lower().startswith(name.lower()) and not found:
            found = True
            comment = re.search(r"<!--.*?-->", body, re.S)
            body = "\n" + (comment.group(0) + "\n\n" if comment else "") + block.rstrip("\n") + "\n\n"
        out.append((f"## {title}\n" if title is not None else "") + body)
    return "".join(out) if found else None


def git(root, *args):
    out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    return out.stdout.strip() if out.returncode == 0 else ""


def last_commit(root, rel):
    """Short SHA of the last commit that touched rel, '' when never committed."""
    return git(root, "log", "-1", "--format=%h", "--", rel)


def is_dirty(root, rel):
    return subprocess.run(["git", "-C", root, "diff", "--quiet", "HEAD", "--", rel]).returncode != 0


def main_branch(root):
    """The main branch named in docs/project.md Conventions, else origin's HEAD, else master or main."""
    path = os.path.join(root, "docs", "project.md")
    if os.path.isfile(path):
        m = re.search(r"\*\*Main branch:\*\*\s*`?([\w./-]+)`?", read(path))
        if m:
            return m.group(1)
    head = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    if head:
        return head.split("/", 1)[-1]
    for name in ("master", "main"):
        if git(root, "rev-parse", "--verify", "-q", name):
            return name
    return "master"
