# docs(openspec): add allow-custom-cmds

Projects currently inherit a fixed command permission list, so their own build, test and tooling commands cannot be added through Spec Control.

This change plans a project-level Custom commands editor and validated command prefixes stored in Spec Control's home configuration. Supported adapters will include them in the next agent launch and its permission preview. The design preserves `minimum`, protected-command restrictions and merge/cleanup gates, and explicitly reports runtimes that cannot apply custom allowances. It covers change sessions and project consoles without changing repository or global agent settings.

Planned verification covers configuration round trips and atomic validation failures, project isolation, prefix matching and adapter precedence, preview/launch agreement, fresh starts and resume with fake agents, accessible settings behavior and demo parity. Implementation will run `bun run check`, `bun run build`, a compiled-server fake-agent smoke check and strict OpenSpec validation.

This PR contains planning artifacts only; implementation tasks remain unchecked.

Planning validation passes (`openspec validate allow-custom-cmds --strict`). It reports a pre-existing misplaced delta header in the main `dashboard-api` spec that must be repaired before archive.
