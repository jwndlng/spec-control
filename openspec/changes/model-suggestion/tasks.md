# Tasks

## 1. Read and expose the recorded choice

- [x] 1.1 Add an optional implementation model to the neutral change record, parse `spec-control.implement-model` in the OpenSpec marker reader with the same validation as configured models, and verify valid, missing, malformed, and unrelated marker fields in marker tests.
- [x] 1.2 Pass the validated value through framework change data, repository snapshots, and the change detail artifact-list response; verify it survives scanning and invalid metadata leaves the change readable in scanner tests.

## 2. Recommend a model during Draft artifacts

- [x] 2.1 Resolve the effective Draft and Implement model candidates when opening Draft artifacts, and add a one-line instruction with both candidates that asks the agent to classify implementation complexity and record its choice without changing other marker fields; verify prompt composition for distinct, missing, and identical candidates.
- [x] 2.2 Verify the drafting instruction preserves existing profile prompts and branch metadata behavior, and that changes without two distinct candidates receive no model-choice instruction.

## 3. Use the per-change choice for Implement

- [x] 3.1 Apply a valid recorded choice ahead of the normal Implement phase model and pass it through the existing model argument handling; verify precedence, invalid-value fallback, and unchanged Draft, Validate, Archive, and console resolution in session tests.
- [x] 3.2 Verify a running session keeps its original model after the change metadata is updated, while a subsequently started Implement session uses the newly scanned choice.

## 4. Show the choice in change detail

- [x] 4.1 Display the recorded implementation model in the change detail view when present and no model-choice label when absent; verify both states in UI tests and provide representative demo data if the detail is demonstrated there.

## 5. Integration verification

- [x] 5.1 Run `bun run check` and `bun run build` to verify linting, types, tests, and the compiled application with the optional change metadata.
