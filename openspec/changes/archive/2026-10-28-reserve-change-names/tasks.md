# Tasks

## 1. Shared rules

- [x] 1.1 Add `src/shared/changeNames.ts` with `isChangeDirName`, `isNewChangeName` and `newChangeNameProblem` (design D1, D2); verify with `test/changeNames.test.ts` covering `archive`, `Archive`, `.`, `..`, `.git`, `-wip`, `a..b`, `x.`, `x.lock`, a 129-character name, and accepted names such as `add-audit-trail`, `v1.2-notes` and `archive-12`
- [x] 1.2 Return `<name>-<number>` from `issueChangeName` when the name is reserved (design D3); verify with `test/sharedIssues.test.ts`: issue `#12` titled `Archive` suggests `archive-12`, and the existing title cases are unchanged

## 2. Server

- [x] 2.1 Use `isNewChangeName` in `createChange` and `stageChangeDir`, answering `400` with the reason; verify with `test/createChange.test.ts` and `test/createChangeApi.test.ts`: `archive` in a repository with no archived change yet gets `400`, the repository is byte-for-byte unchanged, its index included, and no git process ran
- [x] 2.2 Replace `isDismissableName` (`src/server/dismissChange.ts`, `src/server/api.ts`) and the inline check in `isChangeLeftoverPath` (`src/server/pull.ts`) with `isChangeDirName`; verify with the existing `test/dismissChange.test.ts`, `test/dismissChangeApi.test.ts` and `test/pullResolve.test.ts` passing unchanged, plus a dismissal of an existing `.draft` change still succeeding

## 3. UI

- [x] 3.1 Show `newChangeNameProblem` in the New change form (one project and by label) and in `nameProblem` of Import from issues; verify with `test/importIssuesState.test.ts` and `test/newChangeByLabel.test.ts`: `archive` and `-wip` disable submission with their reason as text
- [x] 3.2 Describe the naming rule in `src/ui/helpContent.tsx` where New change is explained; verify with `bun run check`

## 4. Verification

- [x] 4.1 Run `bun run check` and `bun run build`
