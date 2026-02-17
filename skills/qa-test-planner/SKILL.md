---
name: qa-test-planner
description: QA test planning patterns. Use when creating test plans, writing test cases, building regression suites, validating designs against Figma, or documenting bugs.
triggers: [qa, test plan, test cases, regression, bug report, testing, quality assurance]
---

# QA Test Planner

## Quick Reference

| Task | What You Get | Time |
|------|-------------|------|
| Test Plan | Strategy, scope, schedule, risks | 10-15 min |
| Test Cases | Step-by-step instructions, expected results | 5-10 min each |
| Regression Suite | Smoke tests, critical paths, execution order | 15-20 min |
| Figma Validation | Design-implementation comparison | 10-15 min |
| Bug Report | Reproducible steps, environment, evidence | 5 min |

## Test Case Format

```markdown
## TC-001: [Test Case Title]

**Priority:** High | Medium | Low
**Type:** Functional | UI | Integration | Regression

### Preconditions
- [Setup requirement]

### Test Steps
1. [Action]
   **Expected:** [Result]

2. [Action]
   **Expected:** [Result]
```

## Bug Report Template

```markdown
# BUG-[ID]: [Clear, specific title]

**Severity:** Critical | High | Medium | Low

## Environment
- OS, Browser, Build, URL

## Steps to Reproduce
1. [Step]
2. [Step]

## Expected Behavior
[What should happen]

## Actual Behavior
[What happens]

## Evidence
- Screenshot, console errors
```

## Severity Definitions

| Level | Criteria | Examples |
|-------|----------|----------|
| Critical (P0) | System crash, data loss, security | Payment fails, login broken |
| High (P1) | Major feature broken, no workaround | Search not working |
| Medium (P2) | Feature partial, workaround exists | Filter missing option |
| Low (P3) | Cosmetic, rare edge cases | Typo, minor alignment |

## Regression Suite Types

| Suite | Duration | When |
|-------|----------|------|
| Smoke | 15-30 min | Daily |
| Targeted | 30-60 min | Per change |
| Full | 2-4 hours | Weekly/Release |
| Sanity | 10-15 min | After hotfix |

## Pass/Fail Criteria

**PASS:** All P0 pass, 90%+ P1 pass, no critical bugs open
**FAIL:** Any P0 fails, critical bug, security vulnerability

## Best Practices

- Be specific and unambiguous in test steps
- Include expected results for each step
- Test one thing per test case
- Provide clear reproduction steps in bug reports
- Include screenshots/videos as evidence
