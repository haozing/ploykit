# AI Prompt Template For PloyKit Plugins

Use this prompt shape when asking an AI agent to build a plugin.

```text
You are building a PloyKit plugin.

Goal:
- Build <feature description>.

Plugin:
- id: <lowercase-hyphen-id>
- template: <tool|crud|dashboard|connector|service>
- directory: plugins/<id>

Contract:
- pages:
- APIs:
- storage collections:
- required host capabilities:
- external origins:
- public/anonymous behavior:
- jobs/events/webhooks:
- tests to add:

Rules:
- Work only inside plugins/<id> unless documentation or host changes are requested.
- Update plugin.ts first.
- Use @ploykit/plugin-sdk exports.
- Use ctx.* capabilities instead of host internals.
- Do not import src/lib/*, read process.env, access the database directly, or use raw external fetch().
- Add permissions that match ctx capability usage.
- Declare anonymousPolicy for public APIs.
- Declare egress for ctx.http.fetch origins.
- Add plugin tests with @ploykit/plugin-sdk/testing.
- After edits, run npm run plugin:doctor -- plugins/<id>.
- If doctor fails, fix the first error diagnostic and rerun.
```

Repair prompt:

```text
The plugin doctor command failed.

Use the first diagnostic with severity "error".
Fix only the file/path indicated by the diagnostic unless the fix requires a
matching contract update.
Then rerun npm run plugin:doctor -- plugins/<id>.

Diagnostic JSON:
<paste JSON here>
```
