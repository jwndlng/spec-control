// `.openspec.yaml` and `openspec/config.yaml` are flat enough to read without a YAML parser.
import type { ChangeRecord } from "../../../shared/types.ts";

// The whole value, so that `../x` is seen as such and refused rather than cut down to `..`.
const SCHEMA_LINE = /^schema:\s*["']?([^\s"'#]+)/m;
/** A schema name the module looks up: one plain path segment, never `.`, `..` or anything with a separator. */
const SCHEMA_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const CREATED_LINE = /^created:\s*["']?(\d{4}-\d{2}-\d{2})/m;
const SKIP_SPECS_LINE = /^skip_specs:\s*true\b/m;

/** The one top-level key Spec Control reads its record from; nothing on its own line but an optional comment. */
const RECORD_KEY_LINE = /^spec-control:\s*(?:#.*)?$/;
/** An entry of the map: indented by spaces, `key: value`. */
const ENTRY_LINE = /^( +)([A-Za-z0-9_-]+):(?:\s+(.*))?$/;
/** The map's entries Spec Control reads, and the record field each one fills. Every other entry is ignored. */
const RECORD_KEYS: Record<string, keyof ChangeRecord> = { branch: "branch", "archive-branch": "archiveBranch" };

export type RecordedBranchKey = "branch" | "archive-branch";

/**
 * A pure transformation that sets `branch` or `archive-branch` under `spec-control:` in a
 * change's `.openspec.yaml` text to a validated branch name while preserving every other
 * top-level key, comment, and the other `spec-control` key in the file.
 * Returns the text byte-for-byte unchanged when that key already holds that branch name.
 */
export function setRecordedBranchInMarker(text: string, key: RecordedBranchKey, branch: string): string {
  if (key !== "branch" && key !== "archive-branch") {
    throw new Error(`invalid branch key: ${String(key)}`);
  }
  if (!validRecordedBranch(branch)) {
    throw new Error(`invalid branch name: ${JSON.stringify(branch)}`);
  }

  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length === 0 ? [] : text.split(/\r?\n/);
  const hasTrailingNewline = text.endsWith("\n");
  if (hasTrailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const start = lines.findIndex((line) => RECORD_KEY_LINE.test(line));
  if (start < 0) {
    const newLines = [...lines];
    newLines.push("spec-control:", `  ${key}: ${branch}`);
    return newLines.join(nl) + nl;
  }

  let indent = "  ";
  let existingKeyLineIndex = -1;
  let lastEntryLineIndex = start;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:#.*)?$/.test(line)) {
      continue;
    }
    if (!line.startsWith(" ")) {
      break;
    }
    const entry = ENTRY_LINE.exec(line);
    if (entry) {
      indent = entry[1];
      lastEntryLineIndex = i;
      if (entry[2] === key) {
        existingKeyLineIndex = i;
        const val = scalar(entry[3]);
        if (val === branch) {
          return text;
        }
      }
    }
  }

  if (existingKeyLineIndex >= 0) {
    lines[existingKeyLineIndex] = `${indent}${key}: ${branch}`;
  } else {
    lines.splice(lastEntryLineIndex + 1, 0, `${indent}${key}: ${branch}`);
  }

  return lines.join(nl) + nl;
}

export interface Marker {
  schema?: string;
  created?: string;
  skipSpecs: boolean;
  /** The `spec-control:` map's branches that passed validation; absent when none did. */
  recorded?: ChangeRecord;
  /** Values of the map that were dropped. */
  warnings: string[];
}

/** Whether `name` may name a directory under `openspec/schemas/` (contain-repository-reads design D5). */
export function isPlainSchemaName(name: string): boolean {
  return SCHEMA_NAME.test(name) && name !== "." && name !== "..";
}

export function parseMarker(text: string | undefined): Marker {
  if (!text) return { skipSpecs: false, warnings: [] };
  const { recorded, warnings } = parseRecord(text);
  return {
    schema: SCHEMA_LINE.exec(text)?.[1],
    created: CREATED_LINE.exec(text)?.[1],
    skipSpecs: SKIP_SPECS_LINE.test(text),
    ...(recorded ? { recorded } : {}),
    warnings,
  };
}

/**
 * A branch name git would accept and the dashboard can pass around safely (spec-frameworks: "OpenSpec changes record
 * their pull request's branch in `.openspec.yaml`").
 */
export function validRecordedBranch(value: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(value) &&
    !/^[-/.]/.test(value) &&
    !value.endsWith("/") &&
    !value.endsWith(".lock") &&
    !value.includes("..") &&
    !value.includes("//")
  );
}

/** A value without its quotes and trailing comment; undefined for YAML's empty or null value. */
function scalar(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  const quoted = /^(["'])(.*?)\1\s*(?:#.*)?$/.exec(text);
  if (quoted) return quoted[2];
  const plain = text.replace(/(?:^|\s+)#.*$/, "").trim();
  return plain === "" || plain === "~" || /^null$/i.test(plain) ? undefined : plain;
}

/**
 * The `spec-control:` map: the lines after the key that are indented by spaces, at the indentation of its first entry.
 * Blank and comment-only lines do not end it, as in YAML; the first other line that is not indented does.
 */
function parseRecord(text: string): { recorded?: ChangeRecord; warnings: string[] } {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => RECORD_KEY_LINE.test(line));
  if (start < 0) return { warnings: [] };
  const recorded: ChangeRecord = {};
  const warnings: string[] = [];
  let indent: number | undefined;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (!line.startsWith(" ")) break;
    const entry = ENTRY_LINE.exec(line);
    if (!entry) continue;
    indent ??= entry[1].length;
    if (entry[1].length !== indent) continue;
    const field = RECORD_KEYS[entry[2]];
    if (!field) continue;
    const value = scalar(entry[3]);
    if (value === undefined) {
      delete recorded[field];
    } else if (validRecordedBranch(value)) {
      recorded[field] = value;
    } else {
      delete recorded[field];
      warnings.push(`spec-control.${entry[2]} in .openspec.yaml is not a valid branch name and is ignored`);
    }
  }
  return { ...(Object.keys(recorded).length ? { recorded } : {}), warnings };
}
