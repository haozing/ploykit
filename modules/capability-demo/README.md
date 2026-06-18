# Capability Demo

This module is the primary LLM golden sample for ploykit module authoring.

Use it when copying patterns for:

- workspace-scoped Data v2 tables
- dashboard and public routes
- permissions declared before `ctx.*` usage
- jobs, events, webhooks, files, notifications, AI/RAG, metering, and credits

Verification:

```bash
npm run module:doctor -- capability-demo
npm run module:test -- capability-demo --summary
```

For white-label surface replacement, use `modules/white-label-site-demo/module.ts`.
For signed service-backed modules, use `docs/llm/recipes/service-backed.md`.
