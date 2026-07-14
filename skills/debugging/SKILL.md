---
name: debugging
description: Systematic debugging knowledge. Use when diagnosing errors, investigating unexpected behavior, doing root cause analysis, or troubleshooting production issues.
triggers: [debug, bug, error, troubleshoot, root cause, investigate, incident]
---

# Debugging

Use this skill for systematic diagnosis of complex problems, root cause analysis, and resolution.

## Context collection

Before starting, collect:

| Information | Why it matters |
|-------------|---------------|
| Symptoms and error messages | Starting point for investigation |
| Environment (dev/staging/prod) | Determines available tools and access |
| Steps to reproduce | Allows hypothesis validation |
| Timeline of when it started | Correlates with deploys/changes |
| Recent changes | Primary candidates for root cause |

## Diagnostic approach

1. **Symptom analysis** — Understand exactly what's happening
2. **Hypothesis formation** — List possible causes ordered by probability
3. **Systematic elimination** — Test each hypothesis methodically
4. **Evidence collection** — Document logs, stack traces, data
5. **Root cause isolation** — Find the real cause, not just symptoms
6. **Solution validation** — Confirm the fix resolves the problem

## Tools

- database MCPs to check suspicious data states
- monitoring MCPs (Datadog, SigNoz, etc.) for metrics and logs
- infrastructure MCPs (AWS, Kubernetes) for production debugging
- the relevant tech skill to understand expected patterns

## Resolution checklist

- [ ] Issue reproduced consistently
- [ ] Hypotheses documented and tested
- [ ] Root cause identified with evidence
- [ ] Fix implemented
- [ ] Side effects verified
- [ ] Test added to prevent regression (if applicable)
