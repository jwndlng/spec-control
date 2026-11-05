# Prompt

## Why

Different OpenSpec phases have different model needs. Drafting benefits from strong reasoning and writing; implementation benefits from coding and tool use; routine archiving may need less capability. Using one model for every agent prevents users from balancing quality, speed, and cost by phase.

## What changes

- Let users choose a model for each Agent in settings.
- Allow an Agent to inherit the existing default model, so users only configure exceptions.
- Apply the selected model whenever that Agent runs, regardless of provider.

## Capabilities

### Modified capabilities

- Agent settings and execution: persist each Agent’s model selection and use it for that Agent’s jobs.

## Impact

Affects settings UI and persistence, Agent execution configuration, and validation of model choices. Model availability and credentials remain governed by the existing provider configuration. Existing installations should retain their current behavior by defaulting Agents to the current global model.

A key design detail to settle in the project: whether “Agent” maps directly to a phase (drafting, implementing, archiving), or whether users can define arbitrary Agents and assign models to each
