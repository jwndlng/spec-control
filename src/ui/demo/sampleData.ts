// Sample data for the demo build. Everything here is made up: fictional repositories under /home/demo/, invented
// change names. Never paste real repository or change names into this file — the demo is published publicly, and
// test/demoData.test.ts fails on anything that looks like a real home directory.
//
// Ages are relative to `now`, so the published demo never looks abandoned. Column and stage are derived with the
// same rules the scanner uses, so the sample cannot disagree with the board.
import { DEFAULT_SHORTCUTS } from "../../shared/agentDefaults.ts";
import { deriveStage } from "../../shared/columns.ts";
import { resolveDependencies } from "../../shared/dependencies.ts";
import { detectLabels } from "../../shared/labels.ts";
import type { ActivityEvent, AgentProfile, ArtifactStatus, ChangeSnapshot, CheckoutStatus, Config, EnvironmentCheck, EnvironmentReport, EnvironmentView, GithubIssue, IntegratableRepo, PullRequest, PullRequestsResponse, RepoConfig, RepoIssues, RepoPullRequests, RepoSnapshot, SharedProfile, Shortcut, Snapshot, Worktree } from "../../shared/types.ts";
import { summarizeWorkInProgress } from "../../shared/workInProgress.ts";

/** Appears in the demo bundle only; test/demoBundle.test.ts uses it to tell the two bundles apart. */
export const DEMO_MARKER = "spec-control-demo-build";
export const DEMO_ROOT = "/home/demo/work";
/** The fictional user's home the sample paths sit under; test/demoData.test.ts allows /home/demo and nothing else. */
export const DEMO_HOME = "/home/demo";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SCHEMA = "spec-driven";
/** Schema order (specs before design); the board shows design first. */
const ARTIFACT_IDS = ["proposal", "specs", "design", "tasks"];

/** How far the artifacts are written. "planned" means all four exist; "no-design" skips the optional design. */
type Written = "none" | "proposal" | "design" | "specs" | "no-design" | "planned";
const WRITTEN: Record<Written, string[]> = {
  none: [],
  proposal: ["proposal"],
  design: ["proposal", "design"],
  specs: ["proposal", "design", "specs"],
  "no-design": ["proposal", "specs", "tasks"],
  planned: ARTIFACT_IDS,
};

interface SampleChange {
  name: string;
  written?: Written;
  /** [done, total]; implies every artifact is written unless `written` says otherwise. */
  tasks?: [number, number];
  /** Of `total`, how many are `- [~]`: finished by the agent, awaiting the user. Never part of `done`. */
  awaiting?: number;
  /** Age of the last activity in days. */
  age: number;
  synced?: boolean;
  /** When it is one of the repository's worktree branches, the change lives in that worktree. */
  branch?: string;
  /** The column of the main checkout's (older) copy, for a change whose work continues in a worktree. */
  onMain?: string;
  /** The changes of the same repository it declares in `depends-on.yaml`. */
  dependsOn?: string[];
  /** The sample GitHub issue (of `acme/<repository>`) it was imported from, as `issue.yaml` would record it. */
  issue?: { number: number; title: string };
  warnings?: string[];
}

/** The states a checkout chip can show; `detached` has no branch. */
export type CheckoutState = "clean" | "uncommitted" | "ahead" | "never-pushed" | "behind" | "detached" | "stale" | "locked" | "unknown";

interface SampleRepo {
  id: string;
  name: string;
  branch: string;
  /** State of the main checkout; clean when omitted. */
  main?: CheckoutState;
  /** Age of the last openspec/ update in hours. */
  updated: number;
  /** Linked worktrees as [branch, state]. */
  worktrees?: [string, CheckoutState][];
  error?: string;
  warnings?: string[];
  changes: SampleChange[];
  /**
   * [name, archived days ago, task total, worktree branch]. With a branch — one of `worktrees` — the archive exists only
   * in that worktree and the main checkout does not hold it yet: it still has to be pushed or merged.
   */
  archived: [string, number, number, string?][];
  /**
   * An archived change whose directory the default branch still holds next to its archive — a duplicate after archive —
   * with the paths the two copies differ in. The main checkout has pulled it, so its copy is folded into the archive.
   */
  duplicate?: { name: string; differing: string[] };
  /**
   * A git repository under the roots that does not use OpenSpec yet. It is not tracked and not a candidate; Settings
   * offers to set it up, and what is described here is what it looks like once that is done.
   */
  integratable?: true;
  /** Marker files at the top of the project folder; their labels come from the real rule table. */
  markers?: string[];
  /** Custom labels, as typed in Settings. */
  labels?: string[];
  /** Detected labels the user hid. */
  hiddenLabels?: string[];
}

const CLEAN: CheckoutStatus = { modified: 0, untracked: 0, conflicts: 0 };

/** One checkout the way the scanner would have recorded it. Every sample checkout comes from here, so states stay consistent. */
function checkout(path: string, branch: string, state: CheckoutState, isMain = false): Worktree {
  const base: Worktree = { path, head: "9f3c2ab", ...(isMain ? { isMain } : {}) };
  const upstream = `origin/${branch}`;
  const tracked = (extra: Partial<CheckoutStatus> = {}, unpushed = 0): Worktree => ({ ...base, branch, status: { ...CLEAN, upstream, ahead: unpushed, behind: 0, ...extra }, unpushed });
  switch (state) {
    case "clean":
      return tracked();
    case "uncommitted":
      return tracked({ modified: 4, untracked: 1 });
    case "ahead":
      return tracked({}, 2);
    case "behind":
      return tracked({ behind: 5 });
    case "never-pushed":
      return { ...base, branch, status: CLEAN, unpushed: 3 };
    case "detached":
      return { ...base, detached: true, status: CLEAN, unpushed: 1 };
    case "stale":
      return { ...base, branch, prunable: true };
    case "locked":
      return { ...tracked(), locked: true, lockReason: "agent session running" };
    case "unknown":
      return { ...base, branch, status: "unknown" };
  }
}

/** What each artifact waits for in the spec-driven schema. */
const REQUIRES: Record<string, string[]> = { proposal: [], specs: ["proposal"], design: ["proposal"], tasks: ["specs", "design"] };
/** The spec-driven schema's `apply.requires`: all a change needs to be implemented. */
const APPLY_REQUIRES = ["tasks"];

function artifacts(written: Written): ArtifactStatus[] {
  const done = WRITTEN[written];
  return ARTIFACT_IDS.map((id) => ({
    id,
    status: done.includes(id) ? "done" : REQUIRES[id].every((dep) => done.includes(dep)) ? "ready" : "blocked",
    required: APPLY_REQUIRES.includes(id),
  }));
}

const worktreePath = (r: SampleRepo, branch: string) => `${repoPath(r.name)}-worktrees/${branch.replace("/", "-")}`;

/** Where a sample change "lives": in the worktree that has its branch checked out, else in the main checkout. */
function checkouts(r: SampleRepo, c: SampleChange): Pick<ChangeSnapshot, "checkout" | "otherCheckouts"> {
  const main = { path: repoPath(r.name), branch: r.branch, isMain: true };
  const inWorktree = c.branch !== undefined && (r.worktrees ?? []).some(([branch]) => branch === c.branch);
  return {
    checkout: inWorktree ? { path: worktreePath(r, c.branch as string), branch: c.branch, isMain: false } : main,
    otherCheckouts: inWorktree && c.onMain ? [{ ...main, column: c.onMain }] : undefined,
  };
}

/** Shared OpenSpec config the demo starts with, so Projects shows carried profiles without any setup. */
export const DEMO_PROFILES: SharedProfile[] = [
  { id: "base", name: "Base", context: "We use conventional commits.\nSpecs use SHALL for requirements and one scenario per behaviour.", rules: { proposal: ["Always include a Non-goals section"], tasks: ["Keep tasks under two hours"] } },
  { id: "security", name: "Security", context: "Threat-model every new endpoint and state the data classification.", rules: { design: ["List trust boundaries"] } },
];
/** Repository name → profiles it carries; `stale` marks a profile applied before its last edit (shown as outdated). */
/**
 * Local branches for the cleanup dialog, per sample repository: which branches' work is in `main` (a worktree's branch
 * or one without a worktree), and branches with commits `main` lacks. Worktree branches not listed count as unmerged.
 */
export const DEMO_BRANCHES: Record<string, { merged: string[]; unmerged: [string, number][] }> = {
  "lantern-infra": { merged: ["chore/upgrade-terraform", "fix/state-lock-timeout", "chore/archive-pin-terraform-providers"], unmerged: [["experiment/plan-cache", 4]] },
  "harbor-web": { merged: ["fix/focus-ring-contrast"], unmerged: [] },
};

export const DEMO_CARRIED: Record<string, { id: string; stale?: boolean }[]> = {
  "atlas-api": [{ id: "base" }, { id: "security" }],
  "harbor-web": [{ id: "base", stale: true }],
  "lantern-infra": [{ id: "base" }, { id: "security" }],
  "quill-docs": [{ id: "base" }],
};

/** The demo's only agent: made up, vendor-neutral, and never executed. */
export const DEMO_AGENT: AgentProfile = {
  id: "demo-agent",
  name: "Demo Agent",
  command: ["demo-agent", "{prompt}"],
  prompts: {
    draft: "/opsx:ff {change}",
    implement: "/opsx:apply {change}",
    validate: "/opsx:apply {change} — walk me through the tasks left to validate",
    archive: "/opsx:archive {change}",
    integrate: "Set this project up for OpenSpec: run `openspec init` here and tell me what it created.",
  },
  resumeCommand: ["demo-agent", "--continue"],
};

const REPOS: SampleRepo[] = [
  {
    id: "a71c02e9",
    name: "atlas-api",
    markers: ["go.mod", "Dockerfile"], labels: ["client"],
    branch: "main",
    updated: 2,
    worktrees: [
      ["feat/add-rate-limiting", "uncommitted"],
      ["fix/flaky-health-check", "never-pushed"],
      ["chore/archive-request-id-propagation", "ahead"],
    ],
    changes: [
      // proposed on main, being implemented in a worktree: one card, led by the worktree's copy
      { name: "add-rate-limiting", tasks: [9, 14], age: 0.1, branch: "feat/add-rate-limiting", onMain: "Drafts" },
      { name: "paginate-list-endpoints", tasks: [3, 22], age: 2 },
      { name: "migrate-to-postgres-16", tasks: [0, 31], age: 5 },
      { name: "structured-error-codes", written: "specs", age: 1, branch: "feat/structured-error-codes" },
      { name: "idempotency-keys", written: "proposal", age: 9, issue: { number: 214, title: "Support idempotency keys on POST endpoints" } },
      { name: "deprecate-v1-auth", tasks: [12, 12], age: 3, branch: "chore/deprecate-v1-auth" },
      // Code-complete, two checks only a person can make: `Done`, sub-state `validate`.
      { name: "verify-rate-limit-headers", tasks: [11, 13], awaiting: 2, age: 0.5 },
      { name: "openapi-examples", tasks: [8, 8], age: 6, synced: true },
      { name: "graphql-gateway-spike", written: "none", age: 0.3 },
    ],
    archived: [
      ["add-health-endpoint", 4, 6],
      // archived in its worktree, committed there but not pushed yet
      ["request-id-propagation", 8, 11, "chore/archive-request-id-propagation"],
      ["split-billing-module", 15, 27],
      ["cache-user-lookups", 22, 9],
      ["rotate-signing-keys", 31, 13],
      ["bulk-import-endpoint", 44, 18],
      ["drop-legacy-webhooks", 58, 7],
      ["audit-log-retention", 71, 15],
    ],
  },
  {
    id: "4be0d5a3",
    name: "harbor-web",
    markers: ["package.json", "tsconfig.json", "Dockerfile"], labels: ["client", "frontend"],
    branch: "feat/redesign-settings-page",
    main: "uncommitted",
    updated: 5,
    changes: [
      { name: "redesign-settings-page", tasks: [17, 24], age: 0.2, branch: "feat/redesign-settings-page" },
      { name: "dark-mode-tokens", tasks: [5, 9], age: 4 },
      { name: "keyboard-shortcuts", tasks: [0, 16], age: 11 },
      { name: "offline-drafts", written: "design", age: 7 },
      { name: "trim-bundle-size", written: "no-design", tasks: [0, 5], age: 3 },
      { name: "virtualize-long-tables", written: "proposal", age: 2 },
      { name: "replace-date-picker", tasks: [10, 10], age: 1 },
      { name: "onboarding-checklist", written: "planned", tasks: [0, 0], age: 13, warnings: ["tasks file has no tasks"] },
    ],
    archived: [
      ["accessible-modals", 3, 12],
      ["lazy-load-charts", 9, 8],
      ["unify-form-validation", 17, 21],
      ["remove-jquery-remnants", 26, 14],
      ["toast-notifications", 39, 6],
      ["csv-export-button", 52, 5],
      ["session-timeout-warning", 66, 9],
    ],
    // The archive commit added the archive and never removed the change's directory; it was ticked once more since.
    duplicate: { name: "lazy-load-charts", differing: ["tasks.md"] },
  },
  {
    id: "c9317f64",
    name: "lantern-infra",
    markers: ["main.tf", "Chart.yaml", "Dockerfile"], labels: ["platform"], hiddenLabels: ["docker"],
    branch: "main",
    worktrees: [
      ["chore/upgrade-terraform", "clean"],
      ["spike/bisect-slow-plan", "detached"],
      ["feat/abandoned-dns-module", "stale"],
      ["chore/archive-enable-vpc-flow-logs", "clean"],
    ],
    updated: 26,
    warnings: ["openspec/config.yaml: unknown key `defaults` ignored"],
    changes: [
      { name: "centralize-log-shipping", tasks: [21, 38], age: 1 },
      { name: "pin-terraform-providers", tasks: [6, 7], age: 19 },
      { name: "blue-green-deploys", tasks: [0, 26], age: 3, dependsOn: ["centralize-log-shipping"] },
      { name: "rotate-database-credentials", tasks: [0, 12], age: 24 },
      { name: "cost-allocation-tags", written: "specs", age: 8 },
      { name: "regional-failover-runbook", written: "design", age: 47 },
      { name: "adopt-policy-as-code", written: "proposal", age: 33, warnings: ["design.md: could not read artifact status"] },
      { name: "shrink-staging-cluster", tasks: [9, 9], age: 16, synced: true },
    ],
    archived: [
      // archived and pushed in its worktree, waiting for the pull request to be merged
      ["enable-vpc-flow-logs", 6, 10, "chore/archive-enable-vpc-flow-logs"],
      ["migrate-state-backend", 12, 19],
      ["harden-bastion-access", 20, 16],
      ["alerting-on-cert-expiry", 28, 7],
      ["retire-old-build-agents", 37, 11],
      ["backup-restore-drills", 49, 14],
      ["tag-untagged-resources", 63, 22],
      ["consolidate-dns-zones", 80, 9],
    ],
  },
  {
    id: "2f86b0cd",
    name: "quill-docs",
    markers: ["package.json"], labels: ["docs"],
    branch: "main",
    updated: 70,
    changes: [
      { name: "versioned-api-reference", tasks: [4, 15], age: 3 },
      { name: "search-synonyms", written: "planned", tasks: [0, 8], age: 6 },
      { name: "contributor-style-guide", written: "proposal", age: 21 },
      { name: "broken-link-checker", tasks: [6, 6], age: 10 },
    ],
    archived: [
      ["move-to-static-generator", 14, 25],
      ["glossary-page", 35, 5],
      ["code-sample-tabs", 55, 8],
      ["docs-feedback-widget", 90, 10],
    ],
  },
  {
    id: "e05a9b17",
    name: "ember-mobile",
    markers: ["Package.swift", "build.gradle.kts"], labels: ["client"],
    branch: "release/4.2",
    updated: 9,
    main: "behind",
    worktrees: [
      ["feat/biometric-login", "ahead"],
      ["fix/push-token-refresh", "locked"],
    ],
    changes: [
      { name: "biometric-login", tasks: [11, 19], age: 0.4, branch: "feat/biometric-login" },
      { name: "push-token-refresh", tasks: [2, 5], age: 1, branch: "fix/push-token-refresh" },
      { name: "offline-sync-queue", tasks: [0, 28], age: 4 },
      { name: "tablet-layouts", written: "design", age: 12 },
      { name: "in-app-review-prompt", written: "none", age: 2 },
      { name: "reduce-cold-start", written: "specs", age: 5 },
    ],
    archived: [
      ["migrate-navigation-library", 7, 23],
      ["deep-link-routing", 19, 12],
      ["crash-report-symbols", 33, 6],
      ["localize-onboarding", 47, 17],
      ["image-cache-eviction", 75, 9],
    ],
  },
  {
    id: "6d44c1f8",
    name: "orbit-data",
    markers: ["pyproject.toml", "Dockerfile"],
    branch: "main",
    worktrees: [["feat/backfill-events", "unknown"]],
    updated: 120,
    error: "openspec list failed: openspec/changes/backfill-events/.openspec.yaml: unexpected end of file",
    changes: [
      { name: "partition-events-table", tasks: [7, 20], age: 5 },
      { name: "backfill-events", written: "proposal", age: 5 },
      { name: "schema-registry", tasks: [0, 17], age: 18 },
    ],
    archived: [
      ["dedupe-ingest-pipeline", 25, 13],
      ["nightly-quality-report", 60, 8],
    ],
  },
];

/** Found by discovery, a git repository, but with no OpenSpec yet: Settings offers to set it up. */
const CANDIDATES: [string, string][] = [
  ["9a20e6b1", "pebble-cli"],
  ["b7f3108c", "tide-notifications"],
  ["53cd9e70", "playground/spec-experiments"],
];

/** The repository Settings offers to integrate, and the small board it brings once it has been set up. */
const INTEGRATABLE: SampleRepo = {
  id: "c4e70f52",
  name: "sparrow-gateway",
  branch: "main",
  updated: 0,
  integratable: true,
  changes: [
    { name: "retry-budget-per-route", written: "proposal", age: 0 },
    { name: "drop-legacy-tls-ciphers", written: "none", age: 0 },
  ],
  archived: [],
};

function repoPath(name: string): string {
  return `${DEMO_ROOT}/${name}`;
}

export interface Sample {
  snapshot: Snapshot;
  config: Config;
  candidates: RepoConfig[];
  /** Repositories without OpenSpec, offered for integration; not tracked and not candidates. */
  integratable: IntegratableRepo[];
  /** What each of those looks like once it has been set up — the board it brings with it. */
  integrated: RepoSnapshot[];
}

export function buildSample(now: number): Sample {
  const iso = (ageMs: number) => new Date(now - ageMs).toISOString();
  const day = (ageDays: number) => iso(ageDays * DAY).slice(0, 10);

  const repos: RepoSnapshot[] = [...REPOS, INTEGRATABLE].map((r) => {
    const open: ChangeSnapshot[] = r.changes.map((c) => {
      const written = c.written ?? "planned";
      const input = {
        archived: false,
        artifacts: artifacts(written),
        tasks: c.tasks ? { done: c.tasks[0], awaiting: c.awaiting ?? 0, total: c.tasks[1] } : null,
      };
      return {
        repoId: r.id,
        name: c.name,
        schema: SCHEMA,
        artifacts: input.artifacts,
        tasks: input.tasks,
        created: day(c.age + 6),
        lastActivityAt: iso(c.age * DAY),
        branchMatch: c.branch,
        ...checkouts(r, c),
        specsSynced: c.synced,
        warnings: c.warnings,
        // Provisional, as the scanner records it; resolved against the whole repository below.
        ...(c.dependsOn ? { dependsOn: c.dependsOn.map((name) => ({ name, state: "waiting" as const })) } : {}),
        ...(c.issue ? { sourceIssue: { github: `acme/${r.name}`, ...c.issue } } : {}),
        ...deriveStage(input),
      };
    });
    const archived: ChangeSnapshot[] = r.archived.map(([name, age, total, branch]) => {
      const input = { archived: true, artifacts: artifacts("planned"), tasks: { done: total, awaiting: 0, total } };
      return {
        repoId: r.id,
        name,
        schema: SCHEMA,
        artifacts: input.artifacts,
        tasks: input.tasks,
        created: day(age + 20),
        archived: day(age),
        lastActivityAt: iso(age * DAY),
        ...(branch ? { checkout: { path: worktreePath(r, branch), branch, isMain: false } } : {}),
        ...(r.duplicate?.name === name
          ? {
              checkout: { path: repoPath(r.name), branch: r.branch, isMain: true },
              otherCheckouts: [{ path: repoPath(r.name), branch: r.branch, isMain: true, column: "Done" }],
              duplicate: { archive: `${day(age)}-${name}`, differing: r.duplicate.differing, differingCount: r.duplicate.differing.length, pulled: true },
            }
          : {}),
        ...deriveStage(input),
      };
    });
    const worktrees = [
      checkout(repoPath(r.name), r.branch, r.main ?? "clean", true),
      ...(r.worktrees ?? []).map(([branch, state]) => checkout(worktreePath(r, branch), branch, state)),
    ];
    return {
      id: r.id,
      name: r.name,
      path: repoPath(r.name),
      framework: "openspec",
      ok: r.error === undefined,
      error: r.error,
      warnings: r.warnings,
      scannedAt: iso(r.error ? 3 * HOUR : 0),
      isGit: true,
      currentBranch: r.branch,
      // every sample repository's default branch is main; two of them sit on another branch and show the notice
      defaultBranch: "main",
      onDefaultBranch: r.branch === "main",
      // Every sample repository has a remote; the demo never fetches, so "last fetched" is as fictional as the rest.
      hasRemote: true,
      lastFetchedAt: iso(Math.min(r.updated, 6) * HOUR),
      worktrees,
      workInProgress: summarizeWorkInProgress(worktrees),
      lastUpdatedAt: iso(r.updated * HOUR),
      // A failed scan has no detected labels, exactly as on the server.
      detectedLabels: r.error === undefined ? detectLabels((r.markers ?? []).map((name) => ({ name, kind: "file" }))) : undefined,
      changes: resolveDependencies([...open, ...archived]),
    } satisfies RepoSnapshot;
  });

  const config = {
    version: 1,
    scanRoots: [DEMO_ROOT],
    ignorePaths: [],
    repos: REPOS.map((r) => ({ id: r.id, path: repoPath(r.name), name: r.name, enabled: true, ...(r.labels && { labels: r.labels }), ...(r.hiddenLabels && { hiddenLabels: r.hiddenLabels }) })),
    pollIntervalSeconds: 60,
    port: 4711,
    // On by default, so the session features show without setup. The agent is fictional; nothing is ever started.
    agentSessions: { enabled: true, agents: [structuredClone(DEMO_AGENT)], defaultAgent: DEMO_AGENT.id, shortcuts: structuredClone(DEFAULT_SHORTCUTS) as Shortcut[] },
  } satisfies Config;

  const candidates = CANDIDATES.map(([id, name]) => ({ id, path: repoPath(name), name: name.split("/").pop() ?? name, enabled: false })) satisfies RepoConfig[];
  // Kept out of the board and out of the activity log until the visitor integrates it: it is not an OpenSpec project yet.
  const integrated = repos.filter((r) => r.id === INTEGRATABLE.id);
  const integratable: IntegratableRepo[] = [{ id: INTEGRATABLE.id, path: repoPath(INTEGRATABLE.name), name: INTEGRATABLE.name }];

  return { snapshot: { generatedAt: iso(0), repos: repos.filter((r) => r.id !== INTEGRATABLE.id) }, config, candidates, integratable, integrated };
}

/** Made-up locations: the demo never looks at the visitor's machine, so nothing here is found, it is written down. */
const DEMO_TOOL_PATHS: Record<string, string> = {
  git: "/usr/bin/git",
  openspec: `${DEMO_HOME}/.bun/bin/openspec`,
  gh: "/usr/local/bin/gh",
};

/**
 * The demo's environment report: every check passes, and the checks the configuration makes unnecessary read as
 * `not-needed`, exactly as in the dashboard. Derived from the config the visitor is looking at, so switching agent
 * sessions off in the demo's Settings changes it the same way. The setup view leaves the agents out and judges nothing
 * `not-needed`, as the server's does. Nothing is started, looked up or read for it.
 */
export function demoEnvironment(config: Config, now: number, view: EnvironmentView = "settings"): EnvironmentReport {
  const setup = view === "setup";
  const sessions = setup || config.agentSessions.enabled;
  const off = "not needed while agent sessions are off";
  const needed = (check: EnvironmentCheck): EnvironmentCheck => (sessions ? check : { id: check.id, label: check.label, status: "not-needed", found: off });
  const checks: EnvironmentCheck[] = [
    { id: "dashboard-home", label: "Dashboard home", status: "ok", found: `writable: ${DEMO_HOME}/.spec-control` },
    { id: "git", label: "git", status: "ok", found: DEMO_TOOL_PATHS.git },
    needed({ id: "git-identity", label: "Git committer identity", status: "ok", found: "Demo User, configured for this user" }),
    { id: "openspec-cli", label: "OpenSpec CLI", status: "ok", found: DEMO_TOOL_PATHS.openspec },
    ...(setup ? [] : config.agentSessions.agents).map((agent) =>
      needed({
        id: `agent:${agent.id}`,
        label: `Agent: ${agent.name}${agent.id === config.agentSessions.defaultAgent ? " (default)" : ""}`,
        status: "ok",
        found: `${DEMO_HOME}/.local/bin/${agent.command[0]}`,
      }),
    ),
    needed({ id: "github-cli", label: "GitHub CLI", status: "ok", found: `${DEMO_TOOL_PATHS.gh}, credentials configured in ${DEMO_HOME}/.config/gh/hosts.yml` }),
  ];
  return {
    checkedAt: new Date(now).toISOString(),
    status: "ok",
    checks,
    ...(sessions ? { caveat: "GitHub credentials are only checked for being configured — whether they are still valid is known when the agent uses them." } : {}),
  };
}

const FLOW = ["Backlog", "Drafts", "Ready", "Implementing", "Done"];

/**
 * A feed that fits the sample: what would have been observed on the way to the snapshot's state. Derived from the
 * sample itself, so it only ever contains the made-up names above.
 */
export function buildActivity(snapshot: Snapshot, now: number): ActivityEvent[] {
  type Draft = { at: number; repo: RepoSnapshot; rest: Record<string, unknown> };
  const drafts: Draft[] = [];
  const HOUR = DAY / 24;
  for (const repo of snapshot.repos) {
    drafts.push({ at: now - 6 * DAY, repo, rest: { kind: "repo-tracked", openChanges: repo.changes.filter((c) => !c.archived).length } });
    for (const change of repo.changes) {
      const last = change.lastActivityAt ? Date.parse(change.lastActivityAt) : now - 3 * DAY;
      if (change.archived) {
        const at = Date.parse(`${change.archived}T16:30:00`);
        if (now - at < 6 * DAY) drafts.push({ at, repo, rest: { kind: "change-archived", change: change.name, from: "Done" } });
        continue;
      }
      const step = FLOW.indexOf(change.column);
      if (step <= 1) drafts.push({ at: last, repo, rest: { kind: "change-created", change: change.name, to: change.column } });
      else drafts.push({ at: last - (change.column === "Implementing" ? 2 * HOUR : 0), repo, rest: { kind: "change-moved", change: change.name, from: FLOW[step - 1], to: change.column, ...(change.tasks ? { tasks: change.column === "Implementing" ? { done: 0, total: change.tasks.total } : change.tasks } : {}) } });
      if (change.column === "Implementing" && change.tasks && change.tasks.done > 0) {
        const { done, total } = change.tasks;
        const mid = Math.max(0, done - 2);
        drafts.push({ at: last - HOUR, repo, rest: { kind: "session-started", change: change.name, action: "implement", agentName: "Claude Code" } });
        if (mid > 0) drafts.push({ at: last - 40 * 60_000, repo, rest: { kind: "tasks-progress", change: change.name, column: "Implementing", from: { done: 0, total }, to: { done: mid, total } } });
        drafts.push({ at: last - 15 * 60_000, repo, rest: { kind: "tasks-progress", change: change.name, column: "Implementing", from: { done: mid, total }, to: { done, total } } });
        drafts.push({ at: last, repo, rest: { kind: "session-ended", change: change.name, exitCode: 0 } });
      }
    }
  }
  // A busy day two days ago, so the feed collapses it and every summary figure is non-zero: every change that was
  // already implementing by then had an agent session started and resumed through the day; one crashed, and one
  // repository's scan failed for a while. No task is ticked, so each change's progress above stays as it is.
  const busy = new Date(now - 2 * DAY);
  busy.setHours(8, 0, 0, 0);
  const morning = busy.getTime();
  const implementing = snapshot.repos.flatMap((repo) =>
    repo.changes
      .filter((c) => c.column === "Implementing" && !c.archived && c.lastActivityAt && Date.parse(c.lastActivityAt) - 2 * HOUR < morning)
      .map((change) => ({ repo, change })),
  );
  implementing.forEach(({ repo, change }, i) => {
    for (let round = 0; round < 4; round++) {
      const at = morning + round * 2 * HOUR + i * 20 * 60_000;
      drafts.push({ at, repo, rest: { kind: "session-started", change: change.name, action: "implement", agentName: "Claude Code", ...(round > 0 ? { resumed: true } : {}) } });
      drafts.push({ at: at + 45 * 60_000, repo, rest: { kind: "session-ended", change: change.name, exitCode: i === 1 && round === 0 ? 1 : 0 } });
    }
  });
  const flaky = snapshot.repos.find((r) => r.ok) ?? snapshot.repos[0];
  if (flaky) {
    drafts.push({ at: morning + 3 * HOUR, repo: flaky, rest: { kind: "repo-failing", error: "git status timed out" } });
    drafts.push({ at: morning + 4 * HOUR, repo: flaky, rest: { kind: "repo-recovered" } });
  }
  return drafts
    .filter((d) => d.at <= now)
    .sort((a, b) => a.at - b.at)
    .map((d, i) => {
      const at = new Date(d.at).toISOString();
      return { v: 1, id: `demo${String(i).padStart(6, "0")}`, at, detectedAt: at, repoId: d.repo.id, repoName: d.repo.name, ...d.rest } as ActivityEvent;
    });
}

// ---- pull requests ----

interface SamplePr {
  number: number;
  title: string;
  author: string;
  head: string;
  /** Hours since it was opened, or — for a closed one — since it was merged or closed. */
  age: number;
  draft?: boolean;
  state?: PullRequest["state"];
  review?: PullRequest["review"];
  checks?: PullRequest["checks"];
  /** Defaults to `mergeable`, so most open ones read as ready once their checks are green. */
  mergeable?: PullRequest["mergeable"];
  /** Review is requested from the demo's simulated viewer. */
  mine?: boolean;
}

/** The demo's signed-in GitHub user; fictional, like everything else here. */
export const DEMO_VIEWER = "demo-user";

/**
 * Made-up pull requests per sample repository, under an invented `acme` organisation. `quill-docs` has no entry: it
 * stands for a tracked repository whose `origin` is not on GitHub. Some head branches are sample changes' branches, so
 * those cards link to their pull request (open, draft and merged); `push-token-refresh` has a branch and none. Their
 * readiness (ready, checks running or failing, a conflict, a draft) shows on the cards, which the demo never watches.
 */
const SAMPLE_PRS: Record<string, SamplePr[]> = {
  "atlas-api": [
    { number: 482, title: "Add rate limiting to the public API", author: "demo-rae", head: "feat/add-rate-limiting", age: 3, review: "review_required", checks: "pending" },
    { number: 479, title: "Paginate the list endpoints", author: "demo-kit", head: "feat/paginate-list-endpoints", age: 26, review: "approved", checks: "passing" },
    { number: 474, title: "Structured error codes", author: "demo-user", head: "feat/structured-error-codes", age: 50, draft: true },
    { number: 471, title: "Deprecate v1 auth", author: "demo-kit", head: "chore/deprecate-v1-auth", age: 40, state: "merged", checks: "passing" },
  ],
  "harbor-web": [
    { number: 311, title: "Redesign the settings page", author: "demo-nils", head: "feat/redesign-settings-page", age: 5, review: "review_required", checks: "failing", mine: true },
    { number: 305, title: "Dark mode tokens", author: "demo-user", head: "feat/dark-mode-tokens", age: 70, review: "approved", checks: "passing", mergeable: "conflicting" },
  ],
  "lantern-infra": [
    { number: 128, title: "Centralize log shipping", author: "demo-rae", head: "feat/centralize-log-shipping", age: 22, review: "changes_requested", checks: "passing" },
    { number: 124, title: "Pin the terraform providers", author: "demo-user", head: "chore/pin-terraform-providers", age: 140, state: "merged", checks: "passing" },
  ],
  "ember-mobile": [{ number: 57, title: "Biometric login", author: "demo-nils", head: "feat/biometric-login", age: 9, review: "review_required", checks: "pending", mine: true }],
  "orbit-data": [
    { number: 93, title: "Partition the events table", author: "demo-kit", head: "feat/partition-events-table", age: 96 },
    { number: 90, title: "Nightly quality report", author: "demo-rae", head: "feat/nightly-quality-report", age: 30, state: "closed" },
  ],
};

/**
 * The demo's pull-request lists, in the shape the API answers with. Ages are relative to `now`, so the sample stays
 * recent; `fetchedAt` is when the demo last "queried GitHub" — nothing leaves the page either way.
 */
export function buildPullRequests(snapshot: Snapshot, now: number, fetchedAt: number): PullRequestsResponse {
  const iso = (ageMs: number) => new Date(now - ageMs).toISOString();
  const repos: RepoPullRequests[] = snapshot.repos.map((repo) => {
    const sample = SAMPLE_PRS[repo.name];
    if (!sample) return { repoId: repo.id, status: "unavailable", reason: "not on GitHub", pullRequests: [] };
    const pullRequests: PullRequest[] = sample.map((pr) => {
      const at = iso(pr.age * HOUR);
      const state = pr.state ?? "open";
      return {
        number: pr.number,
        title: pr.title,
        url: `https://github.com/acme/${repo.name}/pull/${pr.number}`,
        author: pr.author,
        head: pr.head,
        base: "main",
        draft: pr.draft === true,
        state,
        createdAt: state === "open" ? at : iso((pr.age + 60) * HOUR),
        mergedAt: state === "merged" ? at : undefined,
        closedAt: state === "open" ? undefined : at,
        review: pr.review ?? "none",
        reviewRequestedFromViewer: pr.mine === true,
        checks: pr.checks ?? "none",
        mergeable: pr.mergeable ?? "mergeable",
      };
    });
    return { repoId: repo.id, github: `acme/${repo.name}`, status: "ok", fetchedAt: new Date(fetchedAt).toISOString(), truncated: { open: false, closed: false }, pullRequests };
  });
  return { viewer: DEMO_VIEWER, repos };
}

/** Open issues per sample repository, newest first; `age` in hours. Invented, like everything else here. */
const SAMPLE_ISSUES: Record<string, { number: number; title: string; body: string; author: string; labels: string[]; age: number }[]> = {
  "atlas-api": [
    { number: 231, title: "Rate limit responses lack a Retry-After header", body: "Clients back off blindly when they get a 429.\n\nExpected: a `Retry-After` header with the seconds until the window resets.", author: "demo-rae", labels: ["bug", "api"], age: 5 },
    { number: 228, title: "Timeouts on the export endpoint for large accounts", body: "Exports over ~50k rows time out after 30 s. Stream the response or move it to a background job.", author: "demo-kit", labels: ["bug", "performance"], age: 30 },
    { number: 220, title: "Document pagination cursors in the API reference", body: "The reference shows `page` and `per_page`, but list endpoints return cursors now.", author: "demo-sam", labels: ["docs"], age: 80 },
    { number: 214, title: "Support idempotency keys on POST endpoints", body: "Retries after a network error create duplicate orders. Accept an `Idempotency-Key` header.", author: "demo-rae", labels: ["enhancement", "api"], age: 260 },
  ],
  "harbor-web": [
    { number: 77, title: "Settings page forgets the selected tab on reload", body: "Open Settings, pick Notifications, reload: it is back on General.", author: "demo-kit", labels: ["bug", "ui"], age: 12 },
    { number: 74, title: "Add a compact density option for tables", body: "Power users want more rows on screen.", author: "demo-sam", labels: ["enhancement"], age: 140 },
  ],
};

/** The demo's answer to listing a repository's issues: made up, and nothing leaves the page. */
export function buildIssues(snapshot: Snapshot, repoId: string, now: number): RepoIssues {
  const repo = snapshot.repos.find((r) => r.id === repoId);
  const sample = repo ? SAMPLE_ISSUES[repo.name] : undefined;
  if (!repo || !sample) return { repoId, status: "unavailable", reason: "not on GitHub", issues: [] };
  const issues: GithubIssue[] = sample.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: `https://github.com/acme/${repo.name}/issues/${issue.number}`,
    author: issue.author,
    labels: issue.labels,
    createdAt: new Date(now - issue.age * HOUR).toISOString(),
  }));
  return { repoId, github: `acme/${repo.name}`, status: "ok", fetchedAt: new Date(now).toISOString(), truncated: false, issues };
}
