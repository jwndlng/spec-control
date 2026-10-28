## ADDED Requirements

### Requirement: The System check step names the developer tools on a Mac without them

On a Mac where `git` does not count as found because only Apple's placeholder is on the PATH (`environment-check`
capability, "On macOS the git placeholder is not git"), the System check step SHALL show the `git` check as `problem`
with the `xcode-select --install` instruction, and showing the step or activating **Re-check** SHALL NOT run the
placeholder.

#### Scenario: First setup on a fresh Mac
- **WHEN** the wizard's System check step is shown on a Mac without the command line developer tools
- **THEN** the `git` card is `problem` and shows `xcode-select --install` to copy, the `git-identity` card says git was not found, and no dialog offering to install the developer tools was opened by the dashboard
