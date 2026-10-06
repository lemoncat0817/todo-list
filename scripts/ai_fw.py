#!/usr/bin/env python3
"""Install, upgrade, and check the AI Engineering Framework in a project, tracked by .ai/manifest.json."""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True

MANIFEST = ".ai/manifest.json"
CORE_DIRS = ("agents", "workflows", "gates", "templates", "policies", "profiles")
COMPONENTS = ("core", "pr-template", "claude", "claude-agents", "cursor")
AGENTS_MARKER = re.compile(r"^## 17\. Project context", re.M)
CLAUDE_MARKER = "<!-- ai-framework: project notes below this line are kept on upgrade -->"
# A CLAUDE.md installed before 0.4.0 has no marker; its template ended with this line.
CLAUDE_LEGACY_END = re.compile(r"^Claude-specific notes may follow below\..*$", re.M)
FRAMEWORK_MARK = b"AI Engineering Framework"
MANAGED_ROOTS = (".ai", ".claude", ".cursor", "CLAUDE.md", "AGENTS.md", "scripts", "ai-fw.sh", "upgrade.sh",
                 ".github/pull_request_template.md")
OPTIONAL_WORKFLOWS = {"ai-review": "pr-reviewer.yml", "upgrade-workflow": "upgrade-framework.yml"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_bytes(path):
    with open(path, "rb") as fh:
        return fh.read()


def files_under(base):
    out = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        out += [os.path.relpath(os.path.join(dirpath, f), base) for f in filenames if not f.endswith(".pyc")]
    return sorted(out)


def upstream_version(up):
    path = os.path.join(up, "VERSION")
    return read_bytes(path).decode().strip() if os.path.isfile(path) else "unknown"


def version_key(v):
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)(-.+)?$", v or "")
    return (int(m[1]), int(m[2]), int(m[3]), 0 if m[4] else 1) if m else None


def changelog_delta(up, old, new):
    """The upstream CHANGELOG sections after version old, up to and including new."""
    path = os.path.join(up, "CHANGELOG.md")
    lo, hi = version_key(old), version_key(new)
    if not os.path.isfile(path) or lo is None or hi is None:
        return ""
    out, keep = [], False
    for line in read_bytes(path).decode("utf-8").splitlines(keepends=True):
        h = re.match(r"## (\S+)", line)
        if h:
            v = version_key(h[1])
            keep = (v is not None and lo < v <= hi) or (h[1] == "Unreleased" and hi[3] == 0)
        if keep:
            out.append(line)
    return "".join(out).rstrip() + "\n" if out else ""


def desired_files(up, components, version):
    """Managed file → content bytes, for the chosen components."""
    files = {}

    def add_tree(src, dest):
        base = os.path.join(up, src)
        if os.path.isdir(base):
            for rel in files_under(base):
                files[f"{dest}/{rel}"] = read_bytes(os.path.join(base, rel))

    for d in CORE_DIRS:
        add_tree(d, f".ai/{d}")
    files[".ai/VERSION"] = f"{version}\n".encode()
    add_tree("scripts", "scripts")
    for name in ("ai-fw.sh", "upgrade.sh"):
        if os.path.isfile(os.path.join(up, name)):
            files[name] = read_bytes(os.path.join(up, name))
    if "pr-template" in components:
        files[".github/pull_request_template.md"] = read_bytes(os.path.join(up, "templates", "pull-request.md"))
    if "claude" in components:
        add_tree("adapters/claude-code/skills", ".claude/skills")
    if "claude-agents" in components:
        add_tree("adapters/claude-code/agents", ".claude/agents")
    if "cursor" in components:
        for part in ("rules", "agents", "skills"):
            add_tree(f"adapters/cursor/{part}", f".cursor/{part}")
    return files


def is_executable(up, rel):
    if not (rel.startswith("scripts/") or rel in ("ai-fw.sh", "upgrade.sh")):
        return False
    path = os.path.join(up, rel)
    return os.path.isfile(path) and bool(os.stat(path).st_mode & 0o111)


# Files merged by section: the framework part above a marker is replaced, the project part below it is kept.
def split_agents(text):
    m = AGENTS_MARKER.search(text)
    return (text[:m.start()], text[m.start():]) if m else (None, text)


def split_claude(text):
    i = text.find(CLAUDE_MARKER)
    if i >= 0:
        end = i + len(CLAUDE_MARKER)
        return text[:end], text[end:].lstrip("\n")
    m = CLAUDE_LEGACY_END.search(text)
    if m:
        return text[:m.end()], text[m.end():].lstrip("\n")
    return None, text


SECTION_FILES = {
    "AGENTS.md": ("AGENTS.md", split_agents),
    "CLAUDE.md": ("adapters/claude-code/CLAUDE.template.md", split_claude),
}


def merged(name, upstream_text, local_text):
    split = SECTION_FILES[name][1]
    up_part, up_project = split(upstream_text)
    if name == "AGENTS.md":
        if local_text is None:
            return upstream_text
        part, project = split(local_text)
        return up_part + (project if part is not None else up_project.rstrip("\n") + "\n\n" + local_text)
    if local_text is None:
        return upstream_text
    part, notes = split(local_text)
    keep = notes if part is not None else local_text
    return upstream_text.rstrip("\n") + "\n" + ("\n" + keep if keep.strip() else "")


class Plan:
    def __init__(self):
        self.rows = []  # (action, path, note)

    def add(self, action, path, note=""):
        self.rows.append((action, path, note))

    def of(self, *actions):
        return [r for r in self.rows if r[0] in actions]


def make_plan(root, up, manifest, components, version, force, mode):
    plan, writes, deletes = Plan(), {}, []
    old_files = manifest.get("files", {}) if manifest else None
    old_sections = manifest.get("sections", {}) if manifest else {}
    new = desired_files(up, components, version)

    for rel, data in sorted(new.items()):
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            plan.add("add", rel)
            writes[rel] = data
            continue
        local = read_bytes(path)
        if local == data:
            continue
        recorded = old_files.get(rel) if old_files is not None else None
        if old_files is None or recorded == sha(local) or force:
            note = "no manifest: local edits cannot be detected" if old_files is None else (
                "local edits overwritten (--force)" if recorded != sha(local) else "")
            plan.add("update", rel, note)
            writes[rel] = data
        else:
            plan.add("conflict", rel, "changed locally since install" if recorded else "exists, not installed by the framework")

    stale = []
    if old_files is not None:
        stale = [r for r in old_files if r not in new]
    else:
        stale = legacy_stale(root, new)
    for rel in sorted(stale):
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            continue
        recorded = old_files.get(rel) if old_files is not None else None
        if old_files is None or recorded == sha(read_bytes(path)) or force:
            plan.add("delete", rel, "no longer shipped")
            deletes.append(rel)
        else:
            plan.add("conflict", rel, "no longer shipped, but changed locally; kept")

    sections = {}
    wanted = ["AGENTS.md"] + (["CLAUDE.md"] if "claude" in components else [])
    for name in wanted:
        up_text = read_bytes(os.path.join(up, SECTION_FILES[name][0])).decode("utf-8")
        path = os.path.join(root, name)
        local = read_bytes(path).decode("utf-8") if os.path.isfile(path) else None
        up_part = SECTION_FILES[name][1](up_text)[0]
        sections[name] = sha(up_part.encode())
        if local is None:
            plan.add("add", name)
            writes[name] = merged(name, up_text, None).encode()
            continue
        part = SECTION_FILES[name][1](local)[0]
        if part == up_part:
            continue
        if part is None and name == "AGENTS.md" and mode == "upgrade":
            plan.add("conflict", name, "no '## 17. Project context' heading; merge sections 1-16 by hand")
        elif part is None:
            plan.add("update", name, "framework text added; the existing content becomes the project part")
            writes[name] = merged(name, up_text, local).encode()
        elif manifest is None or old_sections.get(name) == sha(part.encode()) or force:
            plan.add("update", name, "framework part replaced; project part kept")
            writes[name] = merged(name, up_text, local).encode()
        else:
            plan.add("conflict", name, "framework part changed locally since install")
    return plan, writes, deletes, new, sections


def legacy_stale(root, new):
    """Without a manifest: files in the framework's own directories, or adapter entries carrying its name."""
    stale = []
    for d in CORE_DIRS:
        base = os.path.join(root, ".ai", d)
        if os.path.isdir(base):
            stale += [f".ai/{d}/{r}" for r in files_under(base) if f".ai/{d}/{r}" not in new]
    for parent in (".claude/skills", ".claude/agents", ".cursor/rules", ".cursor/agents", ".cursor/skills"):
        base = os.path.join(root, parent)
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base)):
            entry_rel = f"{parent}/{entry}"
            if any(k == entry_rel or k.startswith(entry_rel + "/") for k in new):
                continue
            path = os.path.join(base, entry)
            members = [entry_rel] if os.path.isfile(path) else [f"{entry_rel}/{r}" for r in files_under(path)]
            if any(FRAMEWORK_MARK in read_bytes(os.path.join(root, m)) for m in members):
                stale += members
    return stale


def detect_components(root, manifest):
    if manifest:
        return list(manifest.get("components", ["core"]))
    found = ["core"]
    if os.path.isfile(os.path.join(root, ".github/pull_request_template.md")):
        found.append("pr-template")
    if os.path.isdir(os.path.join(root, ".claude/skills")) or os.path.isfile(os.path.join(root, "CLAUDE.md")):
        found.append("claude")
    if os.path.isdir(os.path.join(root, ".claude/agents")):
        found.append("claude-agents")
    if os.path.isdir(os.path.join(root, ".cursor")):
        found.append("cursor")
    return found


def load_manifest(root):
    path = os.path.join(root, MANIFEST)
    if not os.path.isfile(path):
        return None
    try:
        return json.loads(read_bytes(path).decode("utf-8"))
    except ValueError:
        sys.stderr.write(f"Warning: {MANIFEST} is unreadable; treating this as an install without a manifest.\n")
        return None


def git(root, *args, check=True):
    out = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise SystemExit(f"Error: git {' '.join(args)} failed: {out.stderr.strip()}")
    return out.stdout.strip()


def managed_dirty(root, extra=()):
    present = [p for p in (*MANAGED_ROOTS, *extra) if os.path.exists(os.path.join(root, p))]
    return git(root, "status", "--porcelain", "--", *present) if present else ""


def print_plan(plan, version, previous):
    label = f"{previous} → {version}" if previous else version
    print(f"Framework {label}")
    if not plan.rows:
        print("No file changes.")
        return
    for action, rel, note in plan.rows:
        print(f"  {action.ljust(8)}  {rel}" + (f"  ({note})" if note else ""))
    counts = {a: len(plan.of(a)) for a in ("add", "update", "delete", "conflict")}
    print("  " + " · ".join(f"{n} {a}" for a, n in counts.items() if n))


def apply(root, up, writes, deletes, new, sections, components, version, ref):
    for rel, data in writes.items():
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path) or root, exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)
        if is_executable(up, rel):
            os.chmod(path, 0o755)
    for rel in deletes:
        os.remove(os.path.join(root, rel))
        parent = os.path.dirname(os.path.join(root, rel))
        while parent != root and os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
            parent = os.path.dirname(parent)
    files = {rel: sha(data) for rel, data in new.items() if os.path.isfile(os.path.join(root, rel))}
    manifest = {
        "framework": "ai-engineering-framework",
        "version": version,
        "ref": ref or "",
        "installed": datetime.date.today().isoformat(),
        "components": [c for c in COMPONENTS if c in components],
        "sections": sections,
        "files": files,
    }
    os.makedirs(os.path.join(root, ".ai"), exist_ok=True)
    with open(os.path.join(root, MANIFEST), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")


def install_workflows(root, up, options):
    added = []
    for option, name in OPTIONAL_WORKFLOWS.items():
        if option in options:
            src = os.path.join(up, ".github", "workflows", name)
            dest = os.path.join(root, ".github", "workflows", name)
            if os.path.isfile(src) and not os.path.exists(dest):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copyfile(src, dest)
                added.append(f".github/workflows/{name}")
    return added


def commit(root, branch_prefix, version, message, extra=()):
    branch = f"{branch_prefix}-{version}-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    git(root, "checkout", "-q", "-b", branch)
    present = [p for p in (*MANAGED_ROOTS, *extra) if os.path.exists(os.path.join(root, p))]
    git(root, "add", "-A", "--", *present)
    git(root, "commit", "-q", "-m", message)
    return branch


def run_install(args, mode):
    root, up = args.root, args.upstream
    for required in ("AGENTS.md", "agents", "workflows"):
        if not os.path.exists(os.path.join(up, required)):
            raise SystemExit(f"Error: {up} is not an AI Engineering Framework checkout (no {required}).")
    manifest = load_manifest(root)
    installed = os.path.isfile(os.path.join(root, ".ai/VERSION")) or manifest is not None
    if mode == "init" and installed:
        raise SystemExit("Error: the framework is already installed here; run ai-fw.sh upgrade.")
    if mode == "upgrade" and not installed:
        raise SystemExit("Error: the framework is not installed here; run ai-fw.sh init.")

    version = upstream_version(up)
    previous = (read_bytes(os.path.join(root, ".ai/VERSION")).decode().strip()
                if os.path.isfile(os.path.join(root, ".ai/VERSION")) else None)
    components = ["core", "pr-template"] if mode == "init" else detect_components(root, manifest)
    for ai in args.ai or ([] if mode == "upgrade" else ["claude"]):
        components += ["claude"] if ai == "claude" else ["cursor"]
    if args.with_claude_agents:
        components += ["claude", "claude-agents"]
    components = [c for c in COMPONENTS if c in components]
    workflows = [w for w in OPTIONAL_WORKFLOWS if getattr(args, w.replace("-", "_"), False)]
    extra = [f".github/workflows/{OPTIONAL_WORKFLOWS[w]}" for w in workflows]

    if not args.dry_run and not args.no_commit and managed_dirty(root, extra):
        raise SystemExit("Error: framework-managed paths have uncommitted changes; commit or stash them first, "
                         "or rerun with --no-commit.\n" + managed_dirty(root, extra))

    plan, writes, deletes, new, sections = make_plan(root, up, manifest, components, version, args.force, mode)
    print_plan(plan, version, previous)
    delta = changelog_delta(up, previous, version) if previous else ""
    if args.notes:
        with open(args.notes, "w", encoding="utf-8") as fh:
            fh.write(delta or f"No CHANGELOG entries between {previous or 'a fresh install'} and {version}.\n")
    if delta:
        print(f"\n=== CHANGELOG since {previous} — read before merging ===\n{delta}=== end of CHANGELOG ===")
    if manifest is None and mode == "upgrade":
        print("\nNote: no .ai/manifest.json — this upgrade creates it; later upgrades detect local edits.")

    conflicts = plan.of("conflict")
    if conflicts and not args.force:
        print(f"\n{len(conflicts)} conflict(s): local edits to framework-managed files. Move project changes to "
              "docs/project.md or the project section of AGENTS.md, or rerun with --force to overwrite them. "
              "Nothing was written.")
        return 1
    if args.dry_run:
        print("\nDry run: nothing was written.")
        return 0
    if not plan.rows and manifest is not None and not workflows:
        print("Already up to date.")
        return 0

    apply(root, up, writes, deletes, new, sections, components, version, args.ref)
    added = install_workflows(root, up, workflows)
    for rel in added:
        print(f"  add  {rel}")
    if "ai-review" in workflows:
        print("The AI review sends pull request diffs to external model APIs. To enable it, set the repository "
              "variable AI_REVIEW_ENABLED=true and the NVIDIA_API_KEY or GEMINI_API_KEY secret, and record the "
              "service under External systems in docs/project.md (AGENTS.md section 14).")
    if args.no_commit:
        print("\nApplied, not committed (--no-commit). Review the diff, then commit.")
        return 0
    if mode == "init":
        branch = commit(root, "chore/install-ai-framework", version,
                        f"chore: install AI Engineering Framework {version}", extra)
        print(f"\nInstalled on branch '{branch}'. Next: open a pull request, then run /new-project; it adopts existing code or starts a new project.")
    else:
        branch = commit(root, "chore/upgrade-framework", version,
                        f"chore: upgrade AI Engineering Framework to {version}", extra)
        print(f"\nUpgraded on branch '{branch}'. Push it, open a pull request, and approve it through G5.")
    return 0


def run_doctor(args):
    root, problems, warnings = args.root, [], []

    def ok(msg):
        print(f"  ok    {msg}")

    print("Tools")
    if sys.version_info >= (3, 8):
        ok(f"python {sys.version.split()[0]}")
    else:
        problems.append("Python 3.8+ required")
    for tool, needed in (("git", True), ("gh", False)):
        if shutil.which(tool):
            ok(tool)
        else:
            (problems if needed else warnings).append(f"{tool} not found" + ("" if needed else
                                                      " — pull requests are opened by hand"))

    print("Install")
    manifest = load_manifest(root)
    version_path = os.path.join(root, ".ai/VERSION")
    if not os.path.isfile(version_path):
        problems.append("no .ai/VERSION — the framework is not installed; run ai-fw.sh init")
    else:
        version = read_bytes(version_path).decode().strip()
        ok(f"framework {version}")
        if args.latest and version_key(args.latest) and version_key(version) and \
                version_key(args.latest) > version_key(version):
            warnings.append(f"{args.latest} is available — run ai-fw.sh upgrade")
    if manifest is None:
        if os.path.isfile(version_path):
            warnings.append("no .ai/manifest.json — run ai-fw.sh upgrade once so later upgrades detect local edits")
    else:
        missing, edited = [], []
        for rel, digest in manifest.get("files", {}).items():
            path = os.path.join(root, rel)
            if not os.path.isfile(path):
                missing.append(rel)
            elif sha(read_bytes(path)) != digest:
                edited.append(rel)
        ok(f"{len(manifest.get('files', {})) - len(missing) - len(edited)} managed file(s) as installed")
        problems += [f"missing managed file: {rel}" for rel in missing]
        warnings += [f"edited managed file: {rel} — an upgrade stops on it" for rel in edited]

    print("Entry files")
    agents = os.path.join(root, "AGENTS.md")
    if not os.path.isfile(agents):
        problems.append("no AGENTS.md at the project root")
    elif split_agents(read_bytes(agents).decode("utf-8"))[0] is None:
        problems.append("AGENTS.md has no '## 17. Project context' heading; upgrades cannot keep project notes")
    else:
        ok("AGENTS.md with its project section")
    components = detect_components(root, manifest)
    if "claude" in components:
        claude = os.path.join(root, "CLAUDE.md")
        text = read_bytes(claude).decode("utf-8") if os.path.isfile(claude) else ""
        if "@AGENTS.md" not in text:
            problems.append("CLAUDE.md does not import @AGENTS.md")
        elif CLAUDE_MARKER not in text:
            warnings.append("CLAUDE.md has no project-notes marker — run ai-fw.sh upgrade")
        else:
            ok("CLAUDE.md imports AGENTS.md")
    if os.path.isfile(os.path.join(root, "docs/project.md")):
        ok("docs/project.md")
    else:
        warnings.append("no docs/project.md — run /new-project")

    print()
    for w in warnings:
        print(f"  warn  {w}")
    for p in problems:
        print(f"  FAIL  {p}")
    print(f"{len(problems)} problem(s), {len(warnings)} warning(s)")
    return 1 if problems else 0


def main():
    parser = argparse.ArgumentParser(description="AI Engineering Framework installer. Run it through ai-fw.sh, "
                                                 "which fetches the upstream checkout.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "upgrade"):
        p = sub.add_parser(name)
        p.add_argument("--upstream", required=True, help="framework checkout to install from")
        p.add_argument("--root", default=".", help="project repository (default: current directory)")
        p.add_argument("--ref", help="upstream ref, recorded in the manifest")
        p.add_argument("--ai", action="append", choices=("claude", "cursor"),
                       help="adapter to install; repeat for both (init default: claude)")
        p.add_argument("--with-claude-agents", action="store_true", help="also install the eight Claude subagents")
        p.add_argument("--with-ai-review", dest="ai_review", action="store_true",
                       help="also add .github/workflows/pr-reviewer.yml (sends diffs to external model APIs)")
        p.add_argument("--with-upgrade-workflow", dest="upgrade_workflow", action="store_true",
                       help="also add .github/workflows/upgrade-framework.yml")
        p.add_argument("--dry-run", action="store_true", help="show the plan and the CHANGELOG; write nothing")
        p.add_argument("--force", action="store_true", help="overwrite or delete locally edited managed files")
        p.add_argument("--no-commit", action="store_true", help="leave the result uncommitted")
        p.add_argument("--notes", metavar="FILE", help="also write the CHANGELOG entries to FILE")
    d = sub.add_parser("doctor")
    d.add_argument("--root", default=".")
    d.add_argument("--latest", help="latest release tag, to report an available upgrade")
    args = parser.parse_args()
    args.root = os.path.abspath(args.root)
    if args.command == "doctor":
        return run_doctor(args)
    args.upstream = os.path.abspath(args.upstream)
    return run_install(args, args.command)


if __name__ == "__main__":
    sys.exit(main())
