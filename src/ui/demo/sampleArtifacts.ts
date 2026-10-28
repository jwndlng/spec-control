// Made-up artifact text for the demo's changes, derived from the sample snapshot so the detail view and the board
// can never disagree (a change with 9/14 tasks gets a tasks.md with 9 of 14 boxes ticked). Nothing here is real.
import type { ChangeSnapshot } from "../../shared/types.ts";

const words = (name: string) => name.replaceAll("-", " ");
const title = (name: string) => words(name).replace(/^./, (c) => c.toUpperCase());

function proposal(c: ChangeSnapshot): string {
  return `## Why

Today ${words(c.name)} is handled by hand, which is slow and easy to get wrong. This change makes it a supported, tested part of the system.

## What Changes

- Introduce **${words(c.name)}** behind a configuration switch
- Document the behaviour in the \`${c.name}\` capability
- Non-goals: migrating existing data, changing public APIs

## Impact

| Area | Effect |
| --- | --- |
| Code | one new module, two call sites |
| Operations | one new setting, off by default |
| Docs | a new how-to page |
`;
}

function spec(c: ChangeSnapshot, capability: string): string {
  return `## ADDED Requirements

### Requirement: ${title(capability)}

The system SHALL support ${words(capability)} and MUST keep the previous behaviour when the feature is switched off.

#### Scenario: Switched on

- **WHEN** the feature is enabled and a request arrives
- **THEN** it is handled by the new path

#### Scenario: Switched off

- **WHEN** the feature is disabled
- **THEN** nothing changes for existing users

<!-- part of change ${c.name} -->
`;
}

function design(c: ChangeSnapshot): string {
  return `# Design

## Context

See \`proposal.md\`. The existing code has one natural seam for ${words(c.name)}.

## Decisions

### D1 — Keep it behind a switch

1. Ship dark, enable per environment
2. Remove the switch once it has been on for a release
   - the old path is deleted in the same change
   - the setting is kept as a no-op for one more release

\`\`\`yaml
features:
  ${c.name}: false   # default
\`\`\`

> Alternative considered: a long-lived branch. Rejected, it would drift.

## Risks

- *Rollout order matters* → documented in the runbook, see [the deployment guide](https://example.com/docs/deploy).
`;
}

function tasks(c: ChangeSnapshot): string {
  const { done, total, awaitingTasks = [] } = c.tasks ?? { done: 0, total: 0 };
  // The `- [~]` tasks follow the ticked ones, worded as the scan reports them, so the card and this file agree.
  const lines = Array.from({ length: total }, (_, i) => {
    const awaiting = awaitingTasks[i - done];
    if (i >= done && awaiting) return `- [~] ${awaiting}`;
    return `- [${i < done ? "x" : " "}] ${Math.floor(i / 5) + 1}.${(i % 5) + 1} Step ${i + 1} of ${words(c.name)}`;
  });
  const out: string[] = ["# Tasks", ""];
  lines.forEach((line, i) => {
    if (i % 5 === 0) out.push(`## ${i / 5 + 1}. Part ${i / 5 + 1}`, "");
    out.push(line);
    if (i % 5 === 4) out.push("");
  });
  return `${out.join("\n").trimEnd()}\n`;
}

/** Relative path → text for every artifact the sample says is written, keyed by artifact id in schema order. */
export function sampleArtifactFiles(c: ChangeSnapshot): Record<string, Record<string, string>> {
  const written = (id: string) => c.artifacts.some((a) => a.id === id && a.status === "done");
  const files: Record<string, Record<string, string>> = {};
  for (const { id } of c.artifacts) files[id] = {};
  if (written("proposal")) files.proposal = { "proposal.md": proposal(c) };
  if (written("specs")) {
    files.specs = { [`specs/${c.name}/spec.md`]: spec(c, c.name) };
    // Every other change touches a second capability, so the file list has something to show.
    if (c.name.length % 2 === 0) files.specs["specs/configuration/spec.md"] = spec(c, "configuration");
  }
  if (written("design")) files.design = { "design.md": design(c) };
  if (written("tasks")) files.tasks = { "tasks.md": tasks(c) };
  return files;
}
