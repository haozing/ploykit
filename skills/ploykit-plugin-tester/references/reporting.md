# Test Reporting

## Summary Shape

Keep the final answer concise but evidence-backed:

```text
Status: passed | failed | partial

Code-level:
- commands run and results

API:
- endpoints tested, auth states, failures

Browser:
- routes/locales/viewports tested
- screenshot artifact directory
- visual issues found

Skipped:
- any layer or route not tested, with reason
```

## Artifact Standards

Prefer a machine-readable summary under `test-results/<test-name>/summary.json`
when writing custom real tests. Include:

- started/finished time
- app URL
- masked database URL
- commands and log paths
- API cases and response summaries
- screenshots and observation notes
- final pass/fail status

## Pass/Fail Rules

Use `passed` only when:

- plugin doctor/check/test/build or equivalent code-level checks pass
- relevant real API requests pass and negative cases behave correctly
- relevant pages were opened in a browser
- screenshots were captured and inspected
- no unexpected console/page/network failures remain

Use `partial` when a layer was skipped for a valid reason. Name the residual
risk.

Use `failed` when any required layer has an unresolved issue. Lead with the
issue and point to logs, screenshots, or files.

## Final Answer Discipline

- Report concrete commands, not vague "tested thoroughly".
- Mention artifact paths.
- Do not expose secrets, cookies, API keys, signed URLs, or full database URLs.
- Distinguish "not tested" from "passed".
- Suggest the next most valuable follow-up only when it builds directly on the
  requested validation.
