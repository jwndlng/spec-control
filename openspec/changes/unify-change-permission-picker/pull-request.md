# Unify the change permission picker

## Problem

Change detail and its embedded Console each show a selector for the same per-change permission override.
Different labels suggest different scopes, and saving a new profile does not explain a running session's
existing permissions.

## Intended outcome

Keep one "Permission profile for this change" control across artifact and Console tabs. Show the
resolved "Inherit from project" option, support setting/clearing only the change override, and provide
saving, success and error feedback. When a running session uses a different profile, name both profiles
and explain that the saved choice applies on the next session start. Reuse the existing API and policy;
update Help, demo coverage and What's new.

## Planned verification

- UI tests: one selector across tabs; inheritance fallbacks and explicit overrides; scoped writes and
  clearing; pending/success/error/retry behavior; navigation during a save; archived/missing/disabled cases.
- Session tests: running versus saved profile, inherited updates, ended history and legacy records;
  saving leaves the running session unchanged.
- Run affected UI, permission and demo tests, `bun run check`, `bun run build:demo`, and the What's new
  validation. Inspect the demo at narrow/wide widths with keyboard and accessible feedback checks.

This change contains planning artifacts; implementation and the checks above remain planned.
