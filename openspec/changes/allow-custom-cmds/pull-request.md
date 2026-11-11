# docs(openspec): add allow-custom-cmds

Adds the proposal, design, spec deltas and implementation checklist for project-scoped custom command allowances. This PR changes only OpenSpec artifacts; it delivers no runtime behavior. All 15 implementation tasks remain unchecked.

Checks run:

- `bun run check` passed outside the sandbox: lint, typecheck and 2,320 tests (0 failures). Lint reported warnings.
- `bun run build` passed; `dist/spec-control --version` returned `dev`.
- `openspec validate allow-custom-cmds --strict` failed (exit 1): the main `dashboard-api` spec has a misplaced `## ADDED Requirements` header at line 1700, blocking archive, and `.openspec.yaml` contains the unrecognized key `spec-control`.

Custom-command behavior and the compiled-server fake-agent launch/resume smoke check remain unverified because the feature is not implemented.
