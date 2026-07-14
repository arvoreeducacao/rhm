---
name: qa-testing
description: QA and testing knowledge. Use when testing an implementation end-to-end — building a test plan, validating APIs with curl, driving the UI with Playwright, comparing against Figma, and documenting pass/fail with evidence.
triggers: [qa, test, testing, validate, playwright, e2e, test plan]
---

# QA Testing

Use this skill when validating an implementation across any affected layer (backend APIs and/or frontend UI).

## Approach

1. Identify all test cases from the requirements (happy path, edge cases, errors, UI flows, interactions)
2. Start the affected services if not running
3. Test backend cases using curl, scripts, or API calls
4. Test frontend cases using Playwright (browser automation)
5. Compare UI with Figma designs if available
6. Document pass/fail with evidence (screenshots when relevant)

## Tools

- curl for API validation
- database MCPs to verify data state after operations
- Playwright MCP for browser-based testing
- Figma MCP to compare implementation with design

## Security

- Never access tokens or credentials directly from the database
- Use environment variables for test user tokens
- Never include tokens or secrets in documents or output

## Documenting results

Separate results by repository:

```markdown
### Repository: api
#### Test: Create user profile
- Status: PASS
- Evidence: 201 response with expected payload

### Repository: frontend
#### Test: Form validation on submit
- Status: FAIL
- Evidence: Email field accepts invalid format
- Expected: Inline validation error
```

If you need the user to do something (DB changes, restart services), document it clearly, continue with independent tests, and mark dependent tests as waiting.
