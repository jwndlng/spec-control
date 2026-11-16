# Pull request summary

## Problem

On the combined board, repository groups identify which project owns each set of changes, but their headings do not link to that project's board. Reaching the project view requires navigating back to Projects and locating it there.

## Intended outcome

Add a clearly labeled, keyboard accessible project link to each repository group heading. It opens the corresponding `/repo/<repoId>` board while leaving the group's expand/collapse control independent.

## Planned verification

- Add focused UI coverage confirming the link destination and that activating it does not toggle the group.
- Add a What's new entry and verify it with the existing changelog validation.
