// `.openspec.yaml` and `openspec/config.yaml` are flat enough to read without a YAML parser.
import type { ChangeRecord } from "../../../shared/types.ts";

const SCHEMA_LINE = /^schema:\s*["']?([A-Za-z0-9._-]+)/m;
const CREATED_LINE = /^created:\s*["']?(\d{4}-\d{2}-\d{2})/m;
const SKIP_SPECS_LINE = /^skip_specs:\s*true\b/m;

/** The one top-level key Spec Control reads its record from; nothing on its own line but an optional comment. */
const RECORD_KEY_LINE = /^spec-control:\s*(?:#.*)?$/;
/** An entry of the map: indented by spaces, `key: value`. */
const ENTRY_LINE = /^( +)([A-Za-z0-9_-]+):(?:\s+(.*))?$/;
/** The map's entries Spec Control reads, and the record field each one fills. Every other entry is ignored. */
const RECORD_KEYS: Record<string, keyof ChangeRecord> = { branch: "branch", "archive-branch": "archiveBranch" };

export interface Marker {
  schema?: string;
  created?: string;
  skipSpecs: boolean;
  /** The `spec-control:` map's branches that passed validation; absent when none did. */
  recorded?: ChangeRecord;
  /** Values of the map that were dropped. */
  warnings: string[];
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
