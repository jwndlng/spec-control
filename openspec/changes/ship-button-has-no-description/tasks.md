# Tasks

## 1. Prompt and artifact lifecycle

- [ ] 1.1 Update the Draft artifacts prompt to create `openspec/changes/{change}/pull-request.md` with a concise
  reviewer-facing summary, intended outcome and planned verification.
- [ ] 1.2 Update the Implement prompt to keep the artifact current with delivered behavior and checks actually run,
  removing planned or unverified statements; verify prompt composition for both Draft and Implement.
- [ ] 1.3 Update the relevant Help text if it describes these prompts or the Ship flow.

## 2. Ship pull request body

- [ ] 2.1 Read the description from the validated change path in the session's own worktree, trim it, and use it as the
  `gh pr create --body` value; never consult another checkout.
- [ ] 2.2 Use a fixed, non-empty fallback when the file is absent, blank, unreadable, or not a regular file; preserve the
  existing behavior for an already-open pull request and its body.
- [ ] 2.3 Add focused tests for populated, blank, absent, and unsafe description files and for leaving an existing pull
  request unchanged.

## 3. Documentation and verification

- [ ] 3.1 Add an independent What's new JSON entry under `src/ui/changelog/entries/` describing that Ship includes a
  prepared pull request description.
- [ ] 3.2 Run `bun run check` and `bun run build`; verify Ship opens a pull request with the prepared body and uses the
  fallback for a legacy change without the artifact.
