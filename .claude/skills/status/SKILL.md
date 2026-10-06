---
name: status
description: Show where each change of the AI Engineering Framework waits and what comes next.
disable-model-invocation: true
---

Report the project's state with the local script. It reads the artifacts and writes nothing.

1. Run `python3 scripts/status.py` (`--all` also lists merged and archived changes). If the script or `python3` is missing, say so and point to `./ai-fw.sh doctor`.
2. Show its output to the operator as it is, then name the single most useful next step, in the artifact language of `docs/project.md`.
3. Stop. Starting the next step is the operator's call: `/status` starts no workflow and changes no file.
