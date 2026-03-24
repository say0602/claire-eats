Great — now reconcile the plan with what we actually shipped for `$task`.

Instructions:
- Review the plan doc and update it so it reflects reality (remove outdated assumptions, adjust steps, document decisions).
- Update YAML frontmatter:
  - `status: implemented` if finished, or `status: active` if still in progress, or `status: abandoned` if dropped.
- If the plan is finished (implemented/abandoned), archive it by month using `git mv`:
  - **Platform plan** → `docs/plans/archive/YYYY-MM/`
  - **App plan** → `apps/<slug>/docs/plans/archive/YYYY-MM/`

Keep the plan implementation-focused; long-term documentation belongs in `docs/features/` or `apps/<slug>/docs/`.
