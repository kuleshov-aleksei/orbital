---
name: orbital-retro
description: Use after implementation and verification pass, immediately before the final response, to review the current session and suggest improvements to README/AGENTS.md, skills, or developer infrastructure. Produces suggestions only; does not edit by default.
---

# Orbital Retro

## When to use

- Work is implemented and verification has passed.
- Skip for pure questions, read-only exploration, or trivial one-line changes.

## Review the session

Look for friction, not perfection:

- Where did the user have to repeat or correct you?
- What did you have to rediscover that should be documented?
- Which commands/tools failed or were slower than needed?
- Which docs, skills, or Makefile targets were missing or misleading?
- What was verified manually that could be automated?

## Classify findings

- **Docs**: `README.md` or `AGENTS.md` missing or incorrect guidance.
- **Skills**: a recurring workflow that deserves a new or updated skill.
- **Infra**: Makefile targets, scripts, lint/typecheck config, CI.
- **No action**: one-off or temporary work; do not create noise.

## Output

- Give 3–6 concise suggestions with concrete file paths.
- Prioritize recurring, high-impact issues; skip nitpicks.
- Recommend against changes that add over-engineering.
- Stop after suggesting. Implement only if the user explicitly asks.
- If nothing notable happened, say so.

## Guardrails

- Never include secrets, raw logs, credentials, or private data.
- Do not create skills for temporary features or one-off debugging.
- Do not modify docs/skills/infra as part of the retro unless asked.
