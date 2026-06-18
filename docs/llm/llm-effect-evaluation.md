# LLM Effect Evaluation

Use this protocol before and after changing the wiki. Keep the model, prompt, branch state, and time budget fixed.

## Fixed Prompts

| Task | Prompt |
| --- | --- |
| Multi-tenant CRUD | Build a notes module with workspace-scoped CRUD, a dashboard page, and tests. |
| Metered charge or credit reserve | Add a paid action that reserves one credit, performs work, commits on success, and releases on failure. |
| Controlled external service | Connect a signed external admin API with one operation and call it from an action. |
| White-label or host page | Replace the public home page and add a dashboard navigation entry. |
| Self-repair loop | After implementing a module, run the expected checks and fix the first failure. |

## Score

Score each task as 0/1 for: stayed inside `modules/<id>/`, used correct `ctx.*`, declared `Permission.*`, avoided fake state, passed doctor/test, and explained the recipe used.

Pass means the wiki-after run improves total score and removes the target failure mode: self-drawn shell, fake tenant/session, fake commercial authority, direct controlled-service fetch, or skipped validation.

Record results in [evaluation-runs.md](evaluation-runs.md). Do not mark the experiment complete without actual baseline and post-wiki outputs.
