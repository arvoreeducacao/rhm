---
name: code-review
description: Code review knowledge. Use when reviewing an implementation against requirements, validating code quality, checking edge cases and security, or before opening a PR.
triggers: [review, code review, pr review, validate, quality, lint check]
---

# Code Review

Use this skill when reviewing code — whether a formal review pass, a self-check before delivery, or a "take a look at this" request. For an independent review, prefer running it in a fresh subagent context so the review is not biased by the implementation reasoning.

## Review Process

For each repository with changes:

1. Read the relevant skill to understand project conventions
2. Verify the implementation matches the stated requirements
3. Run build and lint commands
4. Check for edge cases, error handling, and security
5. Verify tests cover the important paths

## What to check

- Correctness against the requirement (not just "does it run")
- Error handling, timeouts, and invalid input
- Security: injection, auth, secret handling, unsafe deserialization
- Consistency with existing patterns in the codebase
- Test coverage for the important paths

## Documenting findings

Separate findings by repository:

```markdown
### Repository: api
- [x] Matches requirements
- [x] Build passes
- [ ] Missing error handling in X endpoint

### Repository: frontend
- [x] ...
```

Mark items resolved as corrections are made.
