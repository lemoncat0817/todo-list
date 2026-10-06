# Profile: docker

## 1. Scope

This profile details `AGENTS.md` §9 (Implementation rules) for Docker: how it is used to package and deliver applications. `AGENTS.md` sets the precedence: the constitution, policies, gates, workflows, and agents take precedence over this file. The project's code, configuration, and `docs/project.md` take precedence over the defaults in this profile (`AGENTS.md` §2, principle 10).

| Field | Value |
|-------|-------|
| Technology | Docker — packaging and delivery |
| Area in `docs/project.md` | Infrastructure |

A statement that ends with the note *verify against the official release notes* in parentheses is not confirmed by the framework's sources: it needs checking against the technology's official release notes.

## 2. Applicability and detection

- Applies when `docs/project.md` lists `docker` among the active profiles.
- Detected by a `Dockerfile` in the repository.
- Compose files in the repository also indicate Docker (verify against the official release notes).

## 3. Version policy

- This profile states no version. The versions of Docker and of the base images come from `docs/project.md` and the build files, which here are the Dockerfiles.

## 4. Structure

N/A — the framework's sources define no layout for Dockerfiles or images; `docs/project.md` records the repository layout.

## 5. Conventions

- Applications are packaged as Docker images, and delivery is Docker-based.
- Delivery runs through the project's CI pipeline. The CI tool is the one `docs/project.md` records, for example Jenkins; this profile sets no default CI tool.
- Configuration is environment-specific, and environments are explicitly separated.
- Deployment steps include health checks and are rollback-aware.

## 6. Testing

N/A — Docker adds no test level of its own.

## 7. Verification commands

Defaults; `docs/project.md` overrides them.

| Check | Default command |
|-------|-----------------|
| Image build | `docker build -f <dockerfile> <context>`, for each Dockerfile (verify against the official release notes) |
| Compose files | `docker compose -f <compose-file> config`, for each Compose file (verify against the official release notes) |

## 8. Risk triggers

N/A — the framework's sources name no Docker-specific action; `.ai/policies/autonomy.md` §6 applies as written.

## 9. Review additions

Checks for a diff that touches this stack:

- Health checks are defined.
- Deployment steps are rollback-aware.
