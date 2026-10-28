// The contract every spec-driven framework module implements (spec-frameworks spec; support-spec-frameworks design D1).
//
// A module tells the framework-neutral server where a framework keeps its files and how one change reads in the one
// shape the board uses (`FrameworkChange`); `shared/columns.ts` derives stage and column from that shape alone. A module
// only reads: it lists, reads and resolves paths through a `RepoSource`, and for writes it supplies paths and file
// contents that the enumerated writers (`createChange.ts`, `dismissChange.ts`, …) use — never a write of its own.
import { FRAMEWORK_INFO, type ArtifactStatus, type ChangeRecord, type FrameworkId, type TaskProgress } from "../../shared/types.ts";
import type { ChangeDirEntry, ChangeListing, ChangesLayout, RepoSource } from "../source.ts";
import { parseTaskProgress } from "../tasksParser.ts";

/** Where a framework keeps its files, relative to the project folder. Pure data. */
export interface FrameworkLayout extends ChangesLayout {
  /** The framework's own tree: its presence claims a tracked folder, and its edits count as repository activity. */
  root: string;
  /** Directory names discovery does not descend into: a project's own tree never holds another project. */
  skipDirs: readonly string[];
}

/** Settings a module reads once per checkout and hands back to every change of it. */
export interface FrameworkProject {
  /** The project's default schema or workflow, when the framework has such a notion. */
  schema?: string;
}

/** One change as the board needs it. Problems are warnings, never a throw. */
export interface FrameworkChange {
  /** Schema or workflow name; `unknown` when it cannot be told. */
  schema: string;
  /** In build order. Empty when the change could not be read. */
  artifacts: ArtifactStatus[];
  /** Absolute path of the file that tracks task progress, if any. */
  tasksPath?: string;
  /** ISO date the change was created, when the framework records it. */
  created?: string;
  /** The branches the change's pull requests were opened from, when the agent recorded them. */
  recorded?: ChangeRecord;
  warnings: string[];
}

/** A change together with the absolute files each artifact resolves to right now, for the detail view. */
export interface FrameworkChangeOutputs extends FrameworkChange {
  /** Artifact id → absolute paths; empty when the change could not be read. */
  outputs: Record<string, string[]>;
}

export interface SpecSyncResult {
  synced: boolean;
  warnings: string[];
}

/**
 * A change's metadata file and how to read it, for stale-change detection, which reads it from a git ref rather than a
 * checkout (spec-frameworks: "Framework file names and formats stay in the framework module").
 */
export interface ChangeMetadata {
  /** Path of the file relative to a change directory. */
  file: string;
  /** The created date and recorded branches in its text, by the rules the module reads a checkout with. */
  parse(text: string): { created?: string; recorded?: ChangeRecord };
}

/** Files a new change starts with: path relative to the change directory → content, written in this order. */
export type ChangeScaffold = Record<string, string>;

export abstract class SpecFramework {
  abstract readonly id: FrameworkId;
  abstract readonly layout: FrameworkLayout;

  /** The display name, from `FRAMEWORK_INFO` so the UI shows the same one. */
  get label(): string {
    return FRAMEWORK_INFO[this.id]?.label ?? this.id;
  }

  /** Discovery: whether `dir` is a project of this framework (its marker is there). Never throws. */
  abstract isProject(dir: string): Promise<boolean>;

  /** Scan: whether a tracked folder still holds this framework's tree. May reject: a failing source fails the scan. */
  claims(source: RepoSource): Promise<boolean> {
    return source.exists(this.layout.root);
  }

  /** The scan error of a tracked folder this framework would read but no module claims. */
  missingMessage(): string {
    return `repository path or its ${this.layout.root}/ directory does not exist`;
  }

  /** Active and archived change directories, names validated by the source. */
  listChanges(source: RepoSource, options?: { archived?: boolean }): Promise<ChangeListing> {
    return source.listChanges(this.layout, options);
  }

  /** Settings of the checkout `source` reads; `inherited` is the main checkout's, for a linked worktree. */
  async readProject(_source: RepoSource, inherited?: FrameworkProject): Promise<FrameworkProject> {
    return { ...inherited };
  }

  /** Artifact statuses, tasks file, schema and created date of one change. */
  abstract readChange(source: RepoSource, project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChange>;

  /** `readChange` plus the files each artifact resolves to. */
  abstract readChangeOutputs(source: RepoSource, project: FrameworkProject, entry: ChangeDirEntry): Promise<FrameworkChangeOutputs>;

  /** Task progress of the tasks file's text: the dashboard's three checkbox states by default. */
  parseTasks(markdown: string): TaskProgress {
    return parseTaskProgress(markdown);
  }

  /** Whether a finished change's spec deltas are reflected in the main specs; undefined when the framework cannot tell. */
  specsSynced(_source: RepoSource, _entry: ChangeDirEntry): Promise<SpecSyncResult | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * The project file the dashboard's shared config profiles are merged into, relative to the project folder; undefined
   * when the framework has none, and then shared config is not offered for its repositories.
   */
  readonly sharedConfigFile?: string;

  /**
   * The fixed text that asks an agent about to push a change's pull request to record its head branch in the change's
   * own files, in the same commit as its work — `archive` for the pull request that archives it. Undefined when the
   * framework has nowhere to record it; then nothing is asked and the link keeps guessing from branch names.
   */
  recordInstruction?(input: { change: string; archive: boolean }): string;

  /** The change metadata stale-change detection reads on a git ref; undefined when the framework records none. */
  readonly changeMetadata?: ChangeMetadata;

  /** The files a new change starts with. The writer decides whether and how to write them. */
  abstract scaffold(input: { project: FrameworkProject; today: string }): ChangeScaffold;
}
