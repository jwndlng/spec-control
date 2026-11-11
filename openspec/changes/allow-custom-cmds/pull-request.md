# feat(agent-sessions): allow project custom command prefixes

Project settings now store validated literal command prefixes. Claude sessions apply them on the next start or resume for supported profiles; running processes are unchanged. Effective-permission previews show the normalized list and runtime limitations. Minimum and unsupported adapters report inactive or unsupported status. Protected operations remain gated. Help, demo data and What's new describe the feature.

Checks run:

- `bun run check` — passed: lint, typecheck and 2,342 tests (199 lint warnings).
- `bun run build` — passed.
- `bun run build:demo` — passed.
- Compiled-server smoke test — passed, including launch, resume and terminal relay.
- `openspec validate allow-custom-cmds --strict` — passed.
