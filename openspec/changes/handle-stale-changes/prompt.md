# Prompt

Detect stale changes and offer to resolve them. A change is stale when its work is merged but the board still shows it
as active, or a session/worktree for it lingers. Two real cases from family-planner on 2026-10-22:

1. `update-routines`: the implement session was running when the dashboard restarted. It was marked `exited` with
   "the dashboard was restarted while this session was running" and `resumable: true`, so it was never auto-ended.
   Its worktree stayed on disk with an uncommitted deletion of the change's `tasks.md`, so Clean up would not remove
   it, although the branch head was exactly the merged PR's head (#48) and the archive PR (#53) was merged too.
2. `fix-release-pipeline`: PR #67 merged the implementation while the change was still active. The agent then
   committed the archive (`chore(openspec): archive fix-release-pipeline`) on the same, already-merged branch and
   pushed it, but never opened a PR. When the session ended and its worktree was removed, the board fell back to the
   main checkout and moved the change from Archived back to Implementing.

Mark such changes on the board with the reason, and offer a fitting action: end the interrupted session and remove
its worktree when everything that would be lost is already merged or archived on main; or carry an archive commit
that never reached main over to a new branch and PR (or start an archive session for it).
