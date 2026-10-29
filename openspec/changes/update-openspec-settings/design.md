# Design

## Context

The project console already runs the project's configured agent in the project folder, including for projects without git, and enforces availability and one-console rules. OpenSpec's `init` configures tool integrations; `update` refreshes instruction files for configured tools. The dashboard itself must not run these commands or write project files.

## Goals / Non-Goals

**Goals:** Provide a discoverable path from project settings to interactive OpenSpec maintenance, including adding Codex, while retaining the existing console lifecycle.

**Non-Goals:** Build an OpenSpec tool selector, infer installed tools, execute CLI commands in the dashboard, or claim that an agent completed setup.

## Decisions

- Add an OpenSpec-only action in project settings that opens the existing console with a copyable request visible alongside it. Reuse console availability and errors. This works for an already running console without disrupting its current conversation; automatically injecting a prompt could interrupt unrelated work.
- The request asks the agent to inspect the current CLI and setup, ask which tools the user wants, retain existing tools and content, and choose the appropriate commands. Hard-coding `--tools codex` could replace or omit existing selections; relying on `openspec update` alone would only refresh existing integrations. The agent can adapt to the installed CLI version and ask for its normal permissions.
- Keep the request in UI code and use the existing console endpoint and clipboard conventions. No new session kind, API or config migration is needed. The console remains usable if the user chooses to type their own request.

## Risks / Trade-offs

- [Agent or CLI may not be installed or may fail] → Surface the existing console availability reason and leave command output and recovery to the interactive session.
- [Agent may misunderstand existing selections] → Request inspection and preservation explicitly, with user selection and agent permission prompts before changes.
- [Copying and sending is an extra step] → Present the request beside the console with a clear copy action and feedback.

## Migration Plan

No data migration is needed. Rollback removes the UI action and guidance; any files changed by the user's agent remain under the user's control.
