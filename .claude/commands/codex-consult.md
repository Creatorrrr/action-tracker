---
description: Ask Codex CLI for a second engineering opinion
argument-hint: [--model MODEL] [--effort EFFORT] [question or task]
allowed-tools: Bash(./scripts/claude-codex-consult.sh *), Bash(scripts/claude-codex-consult.sh *)
---

Use Codex CLI as a second-opinion engineering agent for this request:

`$ARGUMENTS`

Run `./scripts/claude-codex-consult.sh` through the Bash tool and pass the request to it. If the request is short, pass it as normal command arguments. If it is detailed, multi-line, or contains shell-sensitive text, pass it through stdin with a single-quoted heredoc.

Set a generous Bash timeout because Codex may use the latest model with `xhigh` reasoning and can take a long time. Use at least `3600000` ms unless the user explicitly asks for a shorter limit.

The wrapper defaults are part of the contract:

- No explicit `--model`: use the latest configured default model, currently `gpt-5.5`.
- No explicit `--effort`: use `xhigh`.
- Do not add budget, token, or reasoning caps to the Codex request.
- Use Codex's automatic permission judgment path: `approval_policy=on-request` with workspace-write sandboxing.

After Codex responds, compare its answer with your own assessment. If Codex disagrees or surfaces a concrete gap, either run one focused follow-up Codex round or state the disagreement explicitly. Do not claim consensus unless the reasoning actually converges.
