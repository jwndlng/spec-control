# Pull request summary

## Problem

Change detail currently displays the change prompt in the header, where it competes with status and lifecycle information and sits apart from the artifact navigation.

## Intended outcome

Show non-empty prompt text in a dedicated **Prompt** tab alongside the change artifacts, rendered as plain text with the generated heading omitted. Keep it out of the header, preserve URL navigation and refresh behavior, and leave schema artifact progress and Console behavior unchanged.

## Planned verification

- Cover prompt present, absent, and heading-only states in `test/changeDetail.test.ts`.
- Verify Prompt tab URL selection, navigation history, absent-prompt fallback, and refresh retention/content updates.
- Add a What's new entry and verify it with the changelog tests.
