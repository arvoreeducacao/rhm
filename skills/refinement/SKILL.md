---
name: refinement
description: Requirements refinement knowledge. Use when turning a vague request into a clear spec, defining API contracts, identifying affected repositories, or capturing scope and edge cases before coding.
triggers: [refine, refinement, requirements, spec, contract, scope]
---

# Refinement

Use this skill when a task needs to be clarified before implementation — defining the problem, the contracts, and the scope.

## Questions to answer

- What specific problem are we solving, in one clear and measurable sentence?
- What evidence exists that this problem is real (data, examples, complaints, incidents)?
- What happens if we do nothing?
- Who is directly impacted (user type, team, system)?
- What must this solution cover now?
- What will this solution NOT do (to avoid misinterpretation)?

## Enrichment

- Are there explicit alternatives we're discarding? Why?
- Minimum expected behavior for input, processing, and output?
- Happy path for each main flow?
- Behavior on errors, network failures, timeouts, invalid input?
- Variations by user type, permission, plan, or context?
- Expected volume now and maximum to support?
- What UX, code, architecture, and accessibility standards apply?

## Technical refinement

- Which repositories will be modified
- What changes are needed in each
- API contracts (endpoints, payloads, responses)
- Database changes (if any)
- Integration points between repositories

## Notes

- Use database MCPs to understand current schema and data
- Ask for a Figma link if UI changes are involved
- Define contracts and high-level architecture — not code patterns
