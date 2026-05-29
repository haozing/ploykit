# __MODULE_NAME__

Full product module generated from the PloyKit `product-app` template.

This template is for modules that need all three host shells:

- public site routes through `routes.site`
- workspace console routes through `routes.dashboard`
- platform operations routes through `routes.admin`

Keep host-owned concerns such as login, users, workspace membership, billing, files, secrets, and service connections in the host. Keep product-domain workflows inside the module.

Recommended checks:

```bash
npm run module:doctor -- modules/__MODULE_ID__
npm run module:test -- modules/__MODULE_ID__
npm run modules:scan
```
