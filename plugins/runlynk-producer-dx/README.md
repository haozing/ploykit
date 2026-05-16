# RunLynk Producer DX

PloyKit plugin for Producer API integration snippets, Producer API keys, LLM prompts, and callback signing guidance.

## Scope

- List workspace-bound RunLynk projects and task types.
- Create producer API keys through the host-managed `runlynk-core` internal service.
- Generate TypeScript, Python, and curl Producer API snippets.
- Generate an integration prompt that includes task schema, endpoint shape, idempotency, and callback verification requirements.

This plugin does not call Producer API with a plaintext producer key itself. It only creates keys through the Admin API and gives the user the one-time plaintext key returned by Core.
