#!/usr/bin/env bun
// A stand-in for the GitHub CLI. Tests never run the real `gh` and never touch the network: this answers
// `pr list`, `api user`, `issue list` and `repo list` from a JSON scenario file named by FAKE_GH_SCENARIO, and appends one JSON line per
// invocation (argv and cwd) to FAKE_GH_LOG so a test can prove which calls ran, and from where.
//
// Scenario shape (every key optional):
//   {
//     "login": "demo-user",                       // what `api user --jq .login` prints
//     "mode": "ok" | "not-logged-in" | "hang" | "fail",   // applies to every call
//     "stderr": "…",                              // stderr for "fail"
//     "exitCode": 1,
//     "repos": { "acme/alpha-infra": { "open": [ … ], "closed": [ … ] } },   // entries may carry "mergeable",
//                                                                         // "headRefOid", "files" and "changedFiles"
//     "issues": { "acme/alpha-infra": [ … ] },      // open issues, newest first, as `issue list` prints them
//     "owners": { "jdoe": [ … ] },                  // `repo list <owner>` entries, as `gh` prints them
//     "perRepo": { "acme": { "mode": "fail" } },    // also keyed by owner for `repo list`
//     "perRepo": { "acme/beta-soc": { "mode": "fail", "stderr": "…" } },
//     "userMode": "fail"                          // only for `api user`
//   }
// A repository missing from `repos` answers with empty lists, which is what `gh` does for one without pull requests.
// Like the real `gh`, `pr list` answers only the fields named in `--json`, so a field the caller does not ask for —
// `mergeable` or `files`, say — is not in the answer even when the scenario has it. The log keeps the whole argv, so a
// test reads the fields each call asked for from its `--json` argument.
import { appendFileSync, readFileSync } from "node:fs";

interface Mode {
  mode?: "ok" | "not-logged-in" | "hang" | "fail";
  stderr?: string;
  exitCode?: number;
}

interface Scenario extends Mode {
  login?: string;
  repos?: Record<string, { open?: unknown[]; closed?: unknown[] }>;
  issues?: Record<string, unknown[]>;
  owners?: Record<string, unknown[]>;
  perRepo?: Record<string, Mode>;
  userMode?: Mode["mode"];
}

const argv = process.argv.slice(2);
const log = process.env.FAKE_GH_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);

let scenario: Scenario = {};
try {
  scenario = JSON.parse(readFileSync(process.env.FAKE_GH_SCENARIO ?? "", "utf8")) as Scenario;
} catch {
  // No scenario: empty lists and a default login, which is enough for the calls that only need to be counted.
}

const NOT_LOGGED_IN = "gh: To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.";

function finish(mode: Mode, body: () => string): never {
  switch (mode.mode) {
    case "hang":
      // Never answers; the caller's timeout has to stop it. Keeps the process alive without burning CPU.
      setInterval(() => {}, 1000);
      // biome-ignore lint/suspicious/noConfusingVoidType: unreachable, but the signature promises never to return
      return undefined as never;
    case "not-logged-in":
      process.stderr.write(`${NOT_LOGGED_IN}\n`);
      process.exit(1);
      break;
    case "fail":
      process.stderr.write(`${mode.stderr ?? "gh: something went wrong"}\n`);
      process.exit(mode.exitCode ?? 1);
      break;
    default:
      process.stdout.write(body());
      process.exit(0);
  }
}

const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

if (argv[0] === "api" && argv[1] === "user") {
  finish({ ...scenario, mode: scenario.userMode ?? scenario.mode }, () => `${scenario.login ?? "demo-user"}\n`);
} else if (argv[0] === "pr" && argv[1] === "list") {
  const repo = flag("repo") ?? "";
  const limit = Number(flag("limit") ?? 30);
  const closed = argv.includes("--search");
  const mode: Mode = { ...scenario, ...(scenario.perRepo?.[repo] ?? {}) };
  finish(mode, () => {
    const lists = scenario.repos?.[repo] ?? {};
    const items = (closed ? lists.closed : lists.open) ?? [];
    const fields = flag("json")?.split(",");
    const project = (item: unknown) =>
      fields && item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key))) : item;
    return `${JSON.stringify(items.slice(0, limit).map(project))}\n`;
  });
} else if (argv[0] === "issue" && argv[1] === "list") {
  const repo = flag("repo") ?? "";
  const limit = Number(flag("limit") ?? 30);
  const mode: Mode = { ...scenario, ...(scenario.perRepo?.[repo] ?? {}) };
  finish(mode, () => {
    const fields = flag("json")?.split(",");
    const project = (item: unknown) =>
      fields && item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key))) : item;
    return `${JSON.stringify((scenario.issues?.[repo] ?? []).slice(0, limit).map(project))}\n`;
  });
} else if (argv[0] === "repo" && argv[1] === "list") {
  const owner = argv[2] && !argv[2].startsWith("--") ? argv[2] : (scenario.login ?? "demo-user");
  const limit = Number(flag("limit") ?? 30);
  const mode: Mode = { ...scenario, ...(scenario.perRepo?.[owner] ?? {}) };
  finish(mode, () => {
    const fields = flag("json")?.split(",");
    const project = (item: unknown) =>
      fields && item && typeof item === "object" ? Object.fromEntries(Object.entries(item).filter(([key]) => fields.includes(key))) : item;
    return `${JSON.stringify((scenario.owners?.[owner] ?? []).slice(0, limit).map(project))}\n`;
  });
} else {
  // Every other subcommand is a bug in the caller: the dashboard runs only these four.
  process.stderr.write(`fake-gh: unexpected invocation ${JSON.stringify(argv)}\n`);
  process.exit(64);
}

export {};
