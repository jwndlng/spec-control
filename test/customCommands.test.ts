import { describe, expect, test } from "bun:test";
import { normalizeCustomCommands } from "../src/shared/customCommands.ts";

describe("project custom command prefixes", () => {
  test("normalizes spaces and removes duplicates in first-occurrence order", () => {
    expect(normalizeCustomCommands(["  bun   run lint  ", "bun run lint", "./scripts/check"])).toEqual({ commands: ["bun run lint", "./scripts/check"] });
  });

  test("accepts literal tokens and rejects shell syntax, controls, bypasses, wrappers and protected operations", () => {
    for (const prefix of ["", "bun run lint; echo x", "bun run lint && echo x", "bun run lint | cat", "bun run lint > out", "bun 'run' lint", "bun run *", "bun run $(id)", "bun run\nlint", "claude --dangerously-skip-permissions", "claude --permission-mode bypassPermissions", "sh -c echo", "python -c x", "node --eval x", "node -p x", "npx eslint", "npm exec eslint", "/usr/bin/git push origin main", "git", "gh", "gh pr", "git reset --hard", "git worktree remove x", "git branch", "rm -rf x", "sudo ls", "brew install x", "chmod +x x"]) {
      expect(normalizeCustomCommands([prefix]).error, prefix).toBeDefined();
    }
    expect(normalizeCustomCommands(["bun run lint", "./scripts/check", "git status --short"]).commands).toEqual(["bun run lint", "./scripts/check", "git status --short"]);
  });

  test("enforces list, entry, and raw-input bounds atomically", () => {
    expect(normalizeCustomCommands(Array.from({ length: 51 }, () => "bun run test")).error).toContain("at most 50");
    expect(normalizeCustomCommands([`bun ${"a".repeat(254)}`]).error).toContain("256 characters");
    expect(normalizeCustomCommands(["bun run test", " "]).error).toContain("cannot be empty");
    expect(normalizeCustomCommands(["bun run test\u0000"]).error).toContain("control characters");
    expect(normalizeCustomCommands(["a".repeat(50 * 1024 + 1)]).error).toContain("too large");
  });
});
