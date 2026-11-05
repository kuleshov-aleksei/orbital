---
name: orbital-verify
description: Use before declaring any Orbital code change complete. Selects the correct lint/test/build checks, warns about Makefile scope limits, and keeps verification honest.
---

# Orbital Verify

## When to use

- After any implementation or fix, before the final response.
- When unsure which checks are relevant or whether a failure is pre-existing.

## Orient

- Read `Makefile` and the relevant `package.json` scripts first.
- Check whether the change touches frontend, backend, Electron, tests, or CI.
- Ask whether the user wants to run heavy or manual verification themselves.

## Workflow

1. Run `make lint` and `make build`.
2. For backend-only changes, run `make test-backend` (Go unit/integration tests). `make test` is the Docker/Playwright e2e suite; run it only when the change needs browser/e2e coverage or the user asks.
3. For frontend changes, `make lint` covers changed and untracked files; use `make lint-full` to lint all sources.
4. For frontend changes, run `cd frontend && pnpm typecheck` and determine whether errors are new or part of the known baseline.
5. Report exactly what ran, what passed, and what was skipped.

## Guardrails

- Never build frontend/backend manually; use the Makefile.
- Do not fix unrelated pre-existing failures.
- Do not leave temporary configs or scripts behind.
- Do not run e2e or destructive tests against user data/services without permission.

## References

- `Makefile`, `frontend/package.json`, `frontend/playwright.config.ts`
- `frontend/tests/e2e/`, `backend/**/*_test.go`
