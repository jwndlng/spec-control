# Spec Delta

## ADDED Requirements

### Requirement: Draft artifacts records an implementation model choice
When Draft and Implement resolve to different models, Draft artifacts SHALL assess implementation complexity and record the resolved Draft model for complex work or the resolved Implement model for straightforward work. If either model is missing or both resolve to the same model, it SHALL make no choice.

#### Scenario: Complex implementation selects the Draft model
- **WHEN** a change's Draft model is `reasoning-model`, its Implement model is `fast-model`, and Draft artifacts determines the implementation needs deeper reasoning
- **THEN** the change records `reasoning-model` as its implementation model and a later Implement session uses it

#### Scenario: Straightforward implementation selects the Implement model
- **WHEN** a change's Draft model is `reasoning-model`, its Implement model is `fast-model`, and Draft artifacts determines the implementation is straightforward
- **THEN** the change records `fast-model` as its implementation model and a later Implement session uses it

#### Scenario: No distinct configured candidates
- **WHEN** the Draft and Implement models are unset or resolve to the same model
- **THEN** Draft artifacts records no implementation model choice, and Implement follows the normal model resolution rules

### Requirement: Implement uses a change's recorded model choice
A recorded implementation model choice SHALL override the normal Implement model resolution only for that change's Implement sessions. Other actions and changes SHALL keep their configured model resolution.

#### Scenario: A change choice affects only Implement
- **WHEN** a change records `reasoning-model` as its implementation model while its profile has `fast-model` configured for Implement
- **THEN** Implement uses `reasoning-model`, while Draft, Validate, Archive, and other changes keep their configured model resolution
