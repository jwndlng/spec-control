// The only module that touches @fission-ai/openspec internals (kanban-dashboard-mvp design D1); part of the OpenSpec
// framework module (support-spec-frameworks design D4).
//
// The package's `exports` map exposes just its root, which does not re-export
// the artifact graph, so we reach `dist/core` through the `@openspec-core/*`
// tsconfig path alias. We deliberately avoid the library's `resolveSchema` /
// `loadChangeContext`: they locate the bundled schema YAML relative to
// `import.meta.url`, which does not exist inside a compiled binary. Instead
// the package's schema is embedded at build time and the status is computed
// from the same pure primitives the CLI uses.
import {
  ArtifactGraph,
  detectCompleted,
  parseSchema,
  resolveArtifactOutputs,
  type SchemaYaml,
} from "@openspec-core/artifact-graph/index.js";
import { isSpecsArtifactPath } from "@openspec-core/artifact-graph/outputs.js";
// Pure string parsers (no file or module-path access), so they are safe inside the compiled binary.
export { extractRequirementsSection, normalizeRequirementName, parseDeltaSpec } from "@openspec-core/parsers/requirement-blocks.js";
// The CLI's own task counting, for the test that keeps `tasksParser.ts` counting what `openspec status` counts. Importing
// it only defines functions; the scanner never calls it.
export { countTasksFromContent } from "../../../../node_modules/@fission-ai/openspec/dist/utils/task-progress.js";
import specDrivenYaml from "../../../../node_modules/@fission-ai/openspec/schemas/spec-driven/schema.yaml" with { type: "text" };
import { join } from "node:path";
import type { ArtifactStatus } from "../../../shared/types.ts";

export const DEFAULT_SCHEMA = "spec-driven";

const BUNDLED_SCHEMAS: Record<string, string> = { "spec-driven": specDrivenYaml as unknown as string };
const schemaCache = new Map<string, SchemaYaml>();

/**
 * The project-local schema's text first (as the CLI does), then the bundled copy. The caller reads the local file with
 * the bounded read; the library's `loadSchema` would read it with a plain `readFileSync`.
 */
function loadSchemaFor(name: string, localYaml: string | undefined): SchemaYaml {
  if (localYaml !== undefined) return parseSchema(localYaml);
  const cached = schemaCache.get(name);
  if (cached) return cached;
  const yaml = BUNDLED_SCHEMAS[name];
  if (!yaml) throw new Error(`unknown schema '${name}': not bundled with the dashboard and no openspec/schemas/${name}/schema.yaml`);
  const parsed = parseSchema(yaml);
  schemaCache.set(name, parsed);
  return parsed;
}

export interface ChangeArtifactInfo {
  schema: string;
  /** In build order. */
  artifacts: ArtifactStatus[];
  /** Artifact id → absolute paths of the files it resolves to right now; empty when nothing is written yet. */
  outputs: Record<string, string[]>;
  /** Absolute path of the file that tracks task progress, if the schema has one. */
  tasksPath?: string;
}

export interface ReadChangeOptions {
  /** Absolute change directory; defaults to `openspec/changes/<name>`. */
  changeDir?: string;
  /** From `.openspec.yaml` or the project config; defaults to spec-driven. */
  schemaName?: string;
  /** `.openspec.yaml` `skip_specs: true` — spec artifacts count as complete. */
  skipSpecs?: boolean;
  /** The text of the project's `openspec/schemas/<schemaName>/schema.yaml`, when it has one. */
  schemaYaml?: string;
}

export function readChangeArtifacts(projectRoot: string, changeName: string, options: ReadChangeOptions = {}): ChangeArtifactInfo {
  const changeDir = options.changeDir ?? join(projectRoot, "openspec", "changes", changeName);
  const schemaName = options.schemaName || DEFAULT_SCHEMA;
  const schema = loadSchemaFor(schemaName, options.schemaYaml);
  const graph = ArtifactGraph.fromSchema(schema);

  const completed = detectCompleted(graph, changeDir);
  if (options.skipSpecs) {
    for (const artifact of graph.getAllArtifacts()) {
      if (isSpecsArtifactPath(artifact.generates)) completed.add(artifact.id);
    }
  }
  const ready = new Set(graph.getNextArtifacts(completed));
  // What `openspec apply` needs before implementing; without `apply.requires`, everything.
  const requires = schema.apply?.requires;
  const artifacts: ArtifactStatus[] = graph.getBuildOrder().map((id) => ({
    id,
    status: completed.has(id) ? "done" : ready.has(id) ? "ready" : "blocked",
    required: requires ? requires.includes(id) : true,
  }));

  const outputs: Record<string, string[]> = {};
  for (const artifact of graph.getAllArtifacts()) outputs[artifact.id] = resolveArtifactOutputs(changeDir, artifact.generates);

  let tasksPath: string | undefined;
  if (schema.apply?.tracks) {
    tasksPath = join(changeDir, schema.apply.tracks);
  } else {
    for (const id of schema.apply?.requires ?? artifacts.map((a) => a.id)) {
      const artifact = graph.getArtifact(id);
      if (!artifact) continue;
      tasksPath = outputs[id]?.[0] ?? join(changeDir, artifact.generates);
      break;
    }
  }
  return { schema: schemaName, artifacts, outputs, tasksPath: tasksPath ?? join(changeDir, "tasks.md") };
}
