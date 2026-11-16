/** Shared exact-head path policy for documentation-only shipping and GitHub merge eligibility. */
const EXTENSIONS = new Set([".md", ".markdown", ".rst"]);
const EXECUTABLE = new Set([".sh", ".bash", ".zsh", ".fish", ".py", ".pyw", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".rb", ".pl", ".php", ".ps1", ".bat", ".cmd", ".exe", ".dll", ".so", ".dylib"]);
const MANIFESTS = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml",
  "Cargo.toml", "Cargo.lock", "go.mod", "go.sum", "pyproject.toml", "poetry.lock", "requirements.txt", "Pipfile", "Pipfile.lock",
  "Gemfile", "Gemfile.lock", "composer.json", "composer.lock", "Makefile", "justfile",
]);

export interface DocumentationDiff {
  paths: readonly string[];
  complete: boolean;
  /** The provider reported special file modes or a submodule entry. */
  containsLinkOrSubmodule?: boolean;
}

export function isDocumentationPath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) return false;
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? "";
  if (lower.startsWith(".github/workflows/") || lower === ".gitmodules" || MANIFESTS.has(base)) return false;
  const extension = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  if (EXECUTABLE.has(extension)) return false;
  if (lower.startsWith("openspec/") && lower.length > "openspec/".length) return true;
  if (lower.startsWith("docs/") && lower.length > "docs/".length) return true;
  return EXTENSIONS.has(extension);
}

/** Empty, incomplete, malformed, special-mode, or unknown-path diffs cannot be docs-only. */
export function documentationOnly(diff: DocumentationDiff): boolean {
  return diff.complete && !diff.containsLinkOrSubmodule && diff.paths.length > 0 && diff.paths.every(isDocumentationPath);
}
