# __MODULE_NAME__

This module is a template for privileged external services. Module code calls
`ctx.services.invoke(...)`; runtime resolves `secretRefs`, injects bearer auth, signs HMAC,
enforces egress, redacts request/response data, and records audit/provider invocation evidence.

Do not read `process.env`, do not implement HMAC in module code, and do not call the same service
through `ctx.http.fetch(...)`.
