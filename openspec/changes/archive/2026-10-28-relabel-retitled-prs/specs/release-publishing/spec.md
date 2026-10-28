## MODIFIED Requirements

### Requirement: Pull requests are labelled from their title
Every pull request SHALL be labelled from the Conventional Commit type in its title whenever it is opened, edited, reopened or updated: `feat` with `feat`, `fix` with `fix`, `docs` with `docs`, and `chore`, `refactor`, `test`, `style`, `ci`, `build` and `perf` each with a label of the same name. A pull request SHALL carry only the type label its current title names: any other of these type labels, whether added for an earlier title or by hand, SHALL be removed when it is labelled. Labels that are not type labels, including `major` added by hand, SHALL be left in place. The labelling job MUST NOT check out or run code from the pull request.

#### Scenario: Feature title gets the feature label
- **WHEN** a pull request titled `feat(board): group by owner` is opened
- **THEN** it carries the label `feat`

#### Scenario: Scoped maintenance title
- **WHEN** a pull request titled `chore(openspec): archive demo-change` is opened
- **THEN** it carries the label `chore`

#### Scenario: Retitled pull request
- **WHEN** a pull request's title is edited from `chore: tweak` to `fix: tweak`
- **THEN** it carries the label `fix` after the edit and no longer carries `chore`

#### Scenario: Hand-added labels survive a retitle
- **WHEN** a pull request opened as `feat: new export` carries `major` added by hand and is retitled `fix: new export`
- **THEN** it carries `fix` and `major`, and not `feat`

#### Scenario: Fork pull request
- **WHEN** a pull request is opened from a fork
- **THEN** it is labelled the same way and no code from the fork is executed
