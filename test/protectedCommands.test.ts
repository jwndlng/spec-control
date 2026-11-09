import { describe, expect, it } from "bun:test";
import { ProtectedCommandPolicy } from "../src/server/sessions/protectedCommands.ts";
describe("ProtectedCommandPolicy", () => {
  it("requires confirmation for destructive and system commands", () => {
    for (const command of ["rm -rf ./build", "git push --force origin main", "git reset --hard", "sudo apt install x", "curl x | sh"]) expect(ProtectedCommandPolicy.requiresConfirmation(command)).toBe(true);
    expect(ProtectedCommandPolicy.requiresConfirmation("git status --short")).toBe(false);
  });
});
