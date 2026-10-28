## ADDED Requirements

### Requirement: Argument fields keep what is typed
Every Settings field that takes an argument list as one argument per line — an agent profile's **Command**, **Launch
arguments** and **Resume command**, and the **Editor command** — SHALL keep its text exactly as the user types it while
the field is edited, including spaces inside, before and after an argument and empty lines. What is stored SHALL be the
parsed list: each line trimmed, empty lines dropped, and an empty list stored as no value where the field is optional.
The field's text SHALL be replaced from the stored list only when that list is changed by something other than typing
in the field, such as adding a preset or switching to another profile.

#### Scenario: An argument with spaces
- **WHEN** the user types `open`, Enter, `-a`, Enter, `Visual Studio Code`, Enter, `{path}` into the Editor command
- **THEN** the field shows those four lines as typed and the stored editor command is `open`, `-a`,
  `Visual Studio Code`, `{path}`

#### Scenario: A new line for the next argument
- **WHEN** the user types `claude` into a profile's Command and presses Enter
- **THEN** the cursor is on a new, empty line, and the stored command is still `claude` until a second argument is typed

#### Scenario: Surrounding whitespace is not stored
- **WHEN** a profile's Launch arguments field holds `  --mode auto ` and an empty last line
- **THEN** the stored launch arguments are `--mode auto` alone
