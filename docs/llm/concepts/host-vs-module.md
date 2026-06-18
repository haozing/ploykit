# Host vs Module

A ploykit module fills product capability; the host owns the shell.

## Boundary

- Host owns routing shell, chrome, account menu, workspace switcher, sidebar, global layout, auth redirects, and runtime guards.
- Module owns product pages, loaders, actions, API handlers, jobs, data schema, surfaces, and module-local tests.
- A module may request navigation or surfaces through `module.ts`; it should not recreate host UI primitives as page content.

## Use

- Add navigation with `navigation` in `module.ts`.
- Contribute or replace host-owned areas with `surfaces`.
- Declare white-label replacement intent with `presentation`.
- Use `Permission.NavigationExtend`, `Permission.SurfaceContribute`, or `Permission.SurfaceOverride` as required.

## Do Not

- Do not draw a second dashboard shell inside a module page.
- Do not create account menus, workspace selectors, or host sidebars in module code.
- Do not change `apps/host-next/*` for a module-specific layout need.

Reference: `modules/white-label-site-demo/module.ts`.
