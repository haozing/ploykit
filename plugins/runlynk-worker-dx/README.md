# RunLynk Worker DX

PloyKit plugin for RunLynk worker contracts, starter code, LLM prompts, mock jobs, and validator flows.

This plugin does not execute user code. It calls RunLynk Core through PloyKit internal services and uses Core jobs to validate user-owned workers.

## Scope

- View Worker Contract for a task type.
- Generate Python, TypeScript, and raw HTTP starter code.
- Generate Worker Prompt and Fix Prompt.
- Create mock validator jobs.
- Poll Job Detail, Timeline, and Logs to determine validator status.

## Runtime Requirements

The PloyKit host must configure the same `runlynk-core` internal service binding used by `runlynk-core-console`.

Required local secrets:

```env
RUNLYNK_CORE_SERVICE_TOKEN=dev_admin_token
RUNLYNK_CORE_ACTOR_CLAIMS_SECRET=dev_actor_claims_secret
```
