#!/usr/bin/env python3
"""Describe an existing codebase for /new-project Adopt mode: stack, candidate commands, layout, CI."""

import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import framework_artifacts as fa  # noqa: E402

FRAMEWORK_PATHS = ("AGENTS.md", "CLAUDE.md", "ai-fw.sh", "upgrade.sh", ".gitignore", ".github/pull_request_template.md")
FRAMEWORK_DIRS = (".ai/", ".claude/", ".cursor/", "docs/")
NOT_CODE = re.compile(r"^(README|LICENSE|CHANGELOG|CONTRIBUTING)(\.\w+)?$", re.I)
SKIP_DIRS = ("node_modules/", "vendor/", "dist/", "build/", "target/", ".venv/")

JS_FRAMEWORKS = (("@angular/core", "Angular", "angular"), ("next", "Next.js", None), ("react", "React", None),
                 ("vue", "Vue", None), ("svelte", "Svelte", None), ("@nestjs/core", "NestJS", None),
                 ("express", "Express", None), ("fastify", "Fastify", None))


def tracked(root):
    return [f for f in fa.git(root, "ls-files").splitlines() if f and not f.startswith(SKIP_DIRS)
            and "/node_modules/" not in f]


def framework_files(root):
    path = os.path.join(root, ".ai", "manifest.json")
    managed = set(FRAMEWORK_PATHS)
    if os.path.isfile(path):
        try:
            managed |= set(json.loads(fa.read(path)).get("files", {}))
        except ValueError:
            pass
    return managed


def code_files(root, files):
    managed = framework_files(root)
    return [f for f in files if f not in managed and not f.startswith(FRAMEWORK_DIRS)
            and not NOT_CODE.match(os.path.basename(f)) and not is_framework_workflow(root, f)]


def is_framework_workflow(root, rel):
    if not rel.startswith(".github/workflows/"):
        return False
    path = os.path.join(root, rel)
    return os.path.isfile(path) and "ai-engineering-framework" in fa.read(path)


def version_of(spec):
    m = re.search(r"\d+(\.\d+){0,2}", spec or "")
    return m.group(0) if m else "unknown"


def node_app(root, rel):
    folder = os.path.dirname(rel)
    try:
        pkg = json.loads(fa.read(os.path.join(root, rel)))
    except ValueError:
        return None
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    tech, profile = "Node.js", None
    for dep, name, prof in JS_FRAMEWORKS:
        if dep in deps:
            tech, profile = f"{name} {version_of(deps[dep])}", prof
            break
    if "typescript" in deps:
        tech += f" · TypeScript {version_of(deps['typescript'])}"
    lock = {"pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn"}
    runner = next((tool for f, tool in lock.items() if os.path.isfile(os.path.join(root, folder, f))), "npm")
    flag = {"npm": "--prefix", "pnpm": "--dir", "yarn": "--cwd"}[runner]
    prefix = f"{runner} {flag} {folder} run" if folder else f"{runner} run"
    scripts = pkg.get("scripts", {})
    commands = {k: f"{prefix} {s}" for k, s in (("build", "build"), ("lint", "lint"), ("unit", "test"),
                                                ("e2e", "e2e")) if s in scripts}
    return {"application": folder or pkg.get("name", "."), "manifest": rel, "technology": tech,
            "profile": profile, "commands": commands}


def maven_app(root, rel):
    folder = os.path.dirname(rel)
    text = fa.read(os.path.join(root, rel))
    tech = "Java (Maven)"
    boot = re.search(r"spring-boot-starter-parent</artifactId>\s*<version>([^<]+)", text)
    java = re.search(r"<java\.version>([^<]+)", text)
    if boot:
        tech = f"Spring Boot {boot.group(1)}"
    if java:
        tech += f" · Java {java.group(1)}"
    mvn = "./mvnw" if os.path.isfile(os.path.join(root, folder, "mvnw")) else "mvn"
    cmd = f"(cd {folder} && {mvn} -q {{}})" if folder else f"{mvn} -q {{}}"
    return {"application": folder or ".", "manifest": rel, "technology": tech,
            "profile": "spring-boot" if boot else None,
            "commands": {"build": cmd.format("-DskipTests package"), "unit": cmd.format("test"),
                         "integration": cmd.format("verify")},
            "migrations": "Liquibase" if "liquibase" in text else ("Flyway" if "flyway" in text else None)}


def gradle_app(root, rel):
    folder = os.path.dirname(rel)
    text = fa.read(os.path.join(root, rel))
    boot = re.search(r"org\.springframework\.boot['\"]?\)?\s*version\s*['\"]([^'\"]+)", text)
    gw = f"{folder}/gradlew" if folder else "./gradlew"
    return {"application": folder or ".", "manifest": rel,
            "technology": f"Spring Boot {boot.group(1)} (Gradle)" if boot else "JVM (Gradle)",
            "profile": "spring-boot" if boot else None,
            "commands": {"build": f"{gw} assemble", "unit": f"{gw} test", "integration": f"{gw} check"}}


def python_app(root, rel):
    folder = os.path.dirname(rel)
    text = fa.read(os.path.join(root, rel))
    tech = "Python"
    for name in ("django", "fastapi", "flask"):
        if re.search(rf"\b{name}\b", text, re.I):
            tech = f"Python · {name.capitalize() if name != 'fastapi' else 'FastAPI'}"
            break
    commands = {}
    if "pytest" in text:
        commands["unit"] = f"python3 -m pytest{' ' + folder if folder else ''}"
    if "ruff" in text:
        commands["lint"] = f"ruff check{' ' + folder if folder else ''}"
    return {"application": folder or ".", "manifest": rel, "technology": tech, "profile": None, "commands": commands}


def go_app(root, rel):
    folder = os.path.dirname(rel) or "."
    m = re.search(r"^go\s+(\S+)", fa.read(os.path.join(root, rel)), re.M)
    pkgs = "./..." if folder == "." else f"./{folder}/..."
    return {"application": folder, "manifest": rel, "technology": f"Go {m.group(1) if m else ''}".strip(),
            "profile": None, "commands": {"build": f"go build {pkgs}", "lint": f"go vet {pkgs}",
                                          "unit": f"go test {pkgs}"}}


def cargo_app(root, rel):
    folder = os.path.dirname(rel)
    path = f" --manifest-path {rel}" if folder else ""
    return {"application": folder or ".", "manifest": rel, "technology": "Rust", "profile": None,
            "commands": {"build": f"cargo build{path}", "lint": f"cargo clippy{path}", "unit": f"cargo test{path}"}}


DETECTORS = {"package.json": node_app, "pom.xml": maven_app, "build.gradle": gradle_app,
             "build.gradle.kts": gradle_app, "pyproject.toml": python_app, "requirements.txt": python_app,
             "go.mod": go_app, "Cargo.toml": cargo_app}


def applications(root, files):
    apps, seen = [], set()
    for rel in sorted(files, key=lambda f: (f.count("/"), f)):
        detector = DETECTORS.get(os.path.basename(rel))
        folder = os.path.dirname(rel)
        if not detector or (folder, detector) in seen:
            continue
        app = detector(root, rel)
        if app:
            seen.add((folder, detector))
            apps.append(app)
    return apps


def infrastructure(root, files):
    found = {"ci": [], "containers": [], "databases": set()}
    for rel in files:
        base = os.path.basename(rel)
        if rel.startswith(".github/workflows/") or base in ("Jenkinsfile", ".gitlab-ci.yml") or \
                rel.startswith(".circleci/"):
            found["ci"].append(rel)
        if base == "Dockerfile" or re.match(r"(docker-)?compose[\w.-]*\.ya?ml$", base):
            found["containers"].append(rel)
            text = fa.read(os.path.join(root, rel)).lower()
            for db in ("postgres", "mysql", "mariadb", "mongo", "redis"):
                if db in text:
                    found["databases"].add(db)
    found["databases"] = sorted(found["databases"])
    return found


def layout(files):
    counts = {}
    for rel in files:
        top = rel.split("/", 1)[0] + ("/" if "/" in rel else "")
        counts[top] = counts.get(top, 0) + 1
    return sorted(counts.items())


def report(root, files, code):
    apps = applications(root, code)
    infra = infrastructure(root, code)
    profiles_dir = os.path.join(root, ".ai", "profiles")
    profiles = sorted(p[:-3] for p in os.listdir(profiles_dir)) if os.path.isdir(profiles_dir) else []
    lines = [f"# Adopt scan — {len(code)} code file(s) outside the framework", ""]
    lines += ["## Applications", "", "| Application | Manifest | Technology | Profile |", "|---|---|---|---|"]
    for a in apps:
        prof = a["profile"] if a["profile"] in profiles else (f"none (`{a['profile']}` not installed)"
                                                             if a["profile"] else "none")
        lines.append(f"| `{a['application']}` | `{a['manifest']}` | {a['technology']} | {prof} |")
    if not apps:
        lines.append("| — | no build manifest found | `TODO(Technical Owner)` | — |")
    lines += ["", "## Candidate verification commands", "",
              "Run each once, non-interactively under `timeout`; record a command that fails or cannot run as "
              "`TODO`, with the reason.", "", "| Application | Kind | Command |", "|---|---|---|"]
    for a in apps:
        for kind, cmd in a["commands"].items():
            lines.append(f"| `{a['application']}` | {kind} | `{cmd}` |")
    lines += ["", "## Infrastructure", ""]
    lines.append(f"- CI: {', '.join(f'`{c}`' for c in infra['ci']) or 'none found'}")
    lines.append(f"- Containers: {', '.join(f'`{c}`' for c in infra['containers']) or 'none found'}")
    migrations = sorted({a.get('migrations') for a in apps if a.get('migrations')})
    lines.append(f"- Databases: {', '.join(infra['databases']) or 'none found'}"
                 + (f" · migrations: {', '.join(migrations)}" if migrations else ""))
    lines.append(f"- Main branch: `{fa.main_branch(root)}`")
    lines += ["", "## Layout", "", "| Path | Tracked files |", "|---|---|"]
    lines += [f"| `{top}` | {n} |" for top, n in layout(code)]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(
        description="Scan an existing codebase for /new-project Adopt mode (.ai/workflows/new-project-adopt.md).",
        epilog="Exit codes: 0 code found (Adopt) · 1 no code outside the framework (new project) · 2 usage error")
    parser.add_argument("--check", action="store_true", help="only report whether the repository has code")
    args = parser.parse_args()

    root = fa.repo_root()
    files = tracked(root)
    code = code_files(root, files)
    if args.check:
        print(f"{'Adopt' if code else 'New project'}: {len(code)} code file(s) outside the framework")
        return 0 if code else 1
    if not code:
        print("No code outside the framework: run /new-project as a new project.")
        return 1
    sys.stdout.write(report(root, files, code))
    return 0


if __name__ == "__main__":
    sys.exit(main())
