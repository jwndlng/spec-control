// The OpenSpec framework module (support-spec-frameworks design D4): `openspec/changes/<name>/` with a `.openspec.yaml`
// marker, archives under `openspec/changes/archive/YYYY-MM-DD-<name>/`, artifact status from the schema's artifact graph
// (only through `adapter.ts`), and delta specs checked against `openspec/specs/`.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { FRAMEWORK_INFO } from "../../../shared/types.ts";
import { boundedReadWarning, CHANGE_NAME, type ChangeDirEntry, MAX_REPO_FILE_BYTES, type RepoSource } from "../../source.ts";
import { type ChangeMetadata, type ChangeScaffold, type FrameworkChange, type FrameworkChangeOutputs, type FrameworkLayout, type FrameworkProject, SpecFramework, type SpecSyncResult } from "../framework.ts";
import { DEFAULT_SCHEMA, readChangeArtifacts } from "./adapter.ts";
import { isPlainSchemaName, parseMarker } from "./marker.ts";
import { changeSpecsSynced } from "./specSync.ts";

const ROOT = "openspec";
/** The marker that makes a directory an OpenSpec project — and, once it appears, an integration that worked. */
const PROJECT_MARKERS = ["openspec/config.yaml", "openspec/config.yml"];
const CONFIG_FILE = "openspec/config.yaml";
const CHANGE_MARKER = ".openspec.yaml";

export class OpenSpecFramework extends SpecFramework {
  readonly id = "openspec";
  readonly layout: FrameworkLayout = {
    root: ROOT,
    changesDir: FRAMEWORK_INFO.openspec.changesDir,
    archiveDir: `${FRAMEWORK_INFO.openspec.changesDir}/archive`,
    skipDirs: [ROOT],
  };
  override readonly sharedConfigFile = CONFIG_FILE;
  /** The marker, read on a git ref exactly as from a checkout; its warnings are the scan's to report, not stale detection's. */
  override readonly changeMetadata: ChangeMetadata = {
    file: CHANGE_MARKER,
    parse(text) {
      const { created, recorded } = parseMarker(text);
      return { ...(created ? { created } : {}), ...(recorded ? { recorded } : {}) };
    },
  };

  async isProject(dir: string): Promise<boolean> {
    for (const marker of PROJECT_MARKERS) {
      try {
        if ((await stat(join(dir, marker))).isFile()) return true;
      } catch {
        // not present
      }
    }
    return false;
  }

  /** The schema from `openspec/config.yaml`; a linked worktree without its own falls back to the main checkout's. */
  override async readProject(source: RepoSource, inherited?: FrameworkProject): Promise<FrameworkProject> {
    const read = await source.readBounded(join(source.path, CONFIG_FILE), { within: source.path, maxBytes: MAX_REPO_FILE_BYTES });
    const warning = boundedReadWarning(CONFIG_FILE, read, MAX_REPO_FILE_BYTES);
    const schema = parseMarker(read.ok ? read.text : undefined).schema ?? inherited?.schema;
    return { ...(schema ? { schema } : {}), ...(warning ? { warnings: [warning] } : {}) };
  }

  async readChange(source: RepoSource, project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChange> {
    const { outputs: _, ...change } = await this.readChangeOutputs(source, project, entry);
    return change;
  }

  async readChangeOutputs(source: RepoSource, project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChangeOutputs> {
    const read = await source.readBounded(join(entry.dir, CHANGE_MARKER), { within: entry.dir, maxBytes: MAX_REPO_FILE_BYTES });
    const readWarning = boundedReadWarning(CHANGE_MARKER, read, MAX_REPO_FILE_BYTES);
    // A marker that could not be read leaves the change with the project's schema and no created date.
    const marker = parseMarker(read.ok ? read.text : undefined);
    const created = marker.created;
    const recorded = marker.recorded ? { recorded: marker.recorded } : {};
    const warnings = [...(readWarning ? [readWarning] : []), ...marker.warnings];
    // An unknown schema, typically: there is no artifact list to offer.
    const unknown = (schema: string, warning: string): FrameworkChangeOutputs => ({ schema, artifacts: [], created, ...recorded, outputs: {}, warnings: [...warnings, warning] });

    const schemaName = marker.schema ?? project.schema ?? DEFAULT_SCHEMA;
    if (!isPlainSchemaName(schemaName)) return unknown("unknown", `schema name ${JSON.stringify(schemaName)} is not a plain name and is ignored`);
    const localFile = `${ROOT}/schemas/${schemaName}/schema.yaml`;
    const local = await source.readBounded(join(source.path, localFile), { within: source.path, maxBytes: MAX_REPO_FILE_BYTES });
    const localWarning = boundedReadWarning(localFile, local, MAX_REPO_FILE_BYTES);
    if (localWarning) return unknown(schemaName, localWarning);
    try {
      const info = readChangeArtifacts(source.path, entry.name, {
        changeDir: entry.dir,
        schemaName,
        skipSpecs: marker.skipSpecs,
        ...(local.ok ? { schemaYaml: local.text } : {}),
      });
      return { schema: info.schema, artifacts: info.artifacts, tasksPath: info.tasksPath, created, ...recorded, outputs: info.outputs, warnings };
    } catch (err) {
      return unknown(schemaName, `could not read artifacts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  override specsSynced(source: RepoSource, entry: ChangeDirEntry): Promise<SpecSyncResult> {
    return changeSpecsSynced(source, entry.dir);
  }

  /**
   * The record instruction (spec-frameworks: "OpenSpec changes record their pull request's branch in `.openspec.yaml`"):
   * the agent, not the dashboard, writes the head branch into the change's marker, in the commit with its work. One
   * line, because it may be typed into a terminal.
   */
  override recordInstruction({ change, archive }: { change: string; archive: boolean }): string {
    if (!CHANGE_NAME.test(change)) throw new Error("invalid change name");
    const key = archive ? "archive-branch" : "branch";
    return `Before you commit, set ${key}: <the branch you push> under the top-level key spec-control: in openspec/changes/${change}/${CHANGE_MARKER} (or openspec/changes/archive/<date>-${change}/${CHANGE_MARKER} if this branch archived it), indented two spaces, unless it already says so. Change nothing else in the file. Commit it with your work before you push; add no pull request number and no later commit.`;
  }

  /** `.openspec.yaml` naming the project's schema and today's date, as `openspec new change` writes it. */
  scaffold({ project, today }: { project: FrameworkProject; today: string }): ChangeScaffold {
    return { [CHANGE_MARKER]: `schema: ${project.schema ?? DEFAULT_SCHEMA}\ncreated: ${today}\n` };
  }
}

export const openSpec = new OpenSpecFramework();
