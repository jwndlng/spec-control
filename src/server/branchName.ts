// Which branch names the dashboard passes to git. A leaf module: the scan's stale-change checks and the cleanup both use
// it, and the scan must not import anything that writes.

/** A local branch name as git would create it; anything else never reaches git (and nothing option-like does). */
export function isBranchName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("/.") &&
    !/[./]$/.test(name) &&
    !name.endsWith(".lock")
  );
}
