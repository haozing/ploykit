# Service Contract First

External controlled services are part of the module contract, not ad hoc HTTP calls.

## Boundary

- `serviceRequirements` declares provider, egress, secrets, claims, operations, signing, redaction, and response policy.
- `ctx.services.invoke` executes the declared operation through host controls.
- Ordinary external HTTP can use `ctx.http.fetch`, but controlled/signed service calls should not.

## Use

- Start from a machine-readable contract when possible: OpenAPI, JSON schema, or a stable operation list.
- Put the service shape in `module.ts` under `serviceRequirements`.
- Call `ctx.services.invoke` from actions, loaders, API handlers, or jobs.
- Declare `Permission.ServicesInvoke`.
- Keep mock and live behavior behind the same operation names.

## Do Not

- Do not hand-build bearer or HMAC headers in module code.
- Do not call a controlled origin with global `fetch`.
- Do not skip error layering; preserve platform errors and map product errors explicitly.

Reference: `src/module-sdk/types.ts` fields `serviceRequirements` and `ModuleServiceRequirementDefinition`.
