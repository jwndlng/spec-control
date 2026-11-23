## Why

Fix checks can open a console without asking its agent to repair the failing pull request.

## What changes

Send a repair prompt when the user activates Fix checks. Use the linked pull request's branch and show any failure.

## Impact

Change actions, session API, and agent launch and prompt submission.
