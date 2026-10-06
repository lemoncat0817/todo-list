@AGENTS.md

# Claude Code

This project follows the AI Engineering Framework in `.ai/` (version: `.ai/VERSION`). `AGENTS.md`, imported above, and the files in `.ai/` take precedence over this file.

- Workflow commands: `/quick`, `/new-project`, `/new-feature`, `/bug-fix`, `/refactor`, `/implement`, `/release` — the skills in `.claude/skills/`.
- Stage commands: `/clarify <change>` — the Clarify round on a draft spec before G2; `/analyze <change>` — the consistency check on a draft plan: it runs `scripts/analyze.py`, which writes only the plan's *Consistency check* section (`RC-CONSISTENT`); `/status` — where each change waits and what comes next (`scripts/status.py`, read-only).
- Every request is sized C1–C4 first (`.ai/workflows/implementation.md` §7.6); C1 and C2 run the Quick track (`.ai/workflows/quick.md`).
- One session runs the whole workflow, wearing each stage's role; subagents only for parallel tasks and the independent C3/C4 review (`AGENTS.md` §3).
- Agent roles: `.ai/agents/`; the subagents in `.claude/agents/` serve the two subagent cases.

Project rules belong in the project section of `AGENTS.md` or in `docs/project.md`. Claude-specific notes go below the marker line; an upgrade replaces only the text above it.

<!-- ai-framework: project notes below this line are kept on upgrade -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md
