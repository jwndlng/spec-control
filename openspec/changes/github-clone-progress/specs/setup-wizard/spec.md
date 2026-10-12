# Spec Delta

## MODIFIED Requirements

### Requirement: The Workspace step adds roots and tracks projects
The Workspace step SHALL ask the user to choose at least one workspace folder for their projects, or to create a new
one. It SHALL list the configured workspace roots and let the user add roots in three ways: with
**Choose folder…**, which opens the operating system's own folder dialog and adds the folder the user chose; by typing
a path, with `~` accepted; and with one-click suggestions of the folders the server reports as existing in the user's
home directory that are not configured yet; when no root is configured and none of those folders exists, it SHALL
propose creating `~/Workspace`. It SHALL let the user remove roots added in this step. **Choose folder…**
SHALL be offered only while the server reports a folder picker as available, SHALL show that it is waiting while the
dialog is open and SHALL not be activatable again until it closes; cancelling the dialog SHALL add nothing and show no
error, and a failure SHALL be shown in the step with the typed path still available. A chosen folder that is already a
configured or entered root SHALL not be added twice, and the step SHALL say that it is already listed. Whenever the entered roots change, discovery SHALL run against
the configured and entered roots and the configured ignore paths without saving anything, and the step SHALL list the
OpenSpec projects found that are not tracked yet, each with a checkbox, all checked by default, and say how many git
repositories without OpenSpec were found, adding that they can be integrated from the projects overview. A root that
discovery reports as missing SHALL be marked as not found and offered **Create folder**; a root marked to be created
SHALL be created on **Continue** as specified in "A new workspace folder can be created" and then saved, and a missing
root not marked to be created SHALL NOT be saved. Only the latest discovery result
SHALL be shown. The step SHALL also offer **Add from GitHub**, opening the dialog of the `github-repositories`
capability with the configured and entered roots to choose from, in which confirming adds the chosen repositories to a
**GitHub repositories** list in the step instead of cloning them at once; each listed repository SHALL show the path it
will be cloned into and can be removed again before **Continue**. **Continue** SHALL be unavailable, saying why, while no
workspace root is configured, entered or marked to be created. **Continue** SHALL create each root marked to be created,
save the configuration with the entered roots added, track each checked project, and then start the clone of each
listed GitHub repository under the rules of that capability, and SHALL move to the next step as soon as every clone has
been accepted, without waiting for any of them to finish; the clones go on in the background while the user completes
setup, as the Done step shows. A clone the server refuses to start — its folder exists, say — SHALL keep the step open
with the reason on that repository and nothing started for it, the folder name editable and a retry offered; activating
**Continue** again SHALL move on without starting again what was already accepted. **Continue** SHALL NOT remove any root, ignore path or repository, and
SHALL NOT change any repository's name or enabled state other than tracking the checked projects and the cloned
repositories that use OpenSpec. If saving fails, the step SHALL stay open, show the error and keep the
entries. Continuing with a configured root and nothing entered, checked or listed SHALL save nothing, create nothing and clone
nothing.

#### Scenario: Choosing a folder in Finder
- **WHEN** the server runs on macOS and the user activates **Choose folder…** and picks `/w/acme` in the dialog
- **THEN** `/w/acme` is listed as an entered root, discovery runs, and the projects found under it are listed with checkboxes

#### Scenario: Cancelling the folder dialog
- **WHEN** the user activates **Choose folder…** and cancels the dialog
- **THEN** no root is added, no error is shown and **Choose folder…** can be activated again

#### Scenario: No folder picker on this machine
- **WHEN** the server reports that no folder picker is available
- **THEN** the step offers no **Choose folder…**, and roots can still be typed and picked from the suggestions

#### Scenario: A suggested folder
- **WHEN** `~/Workspace` exists, is not a configured root, and the user opens the Workspace step
- **THEN** `~/Workspace` is offered as a suggestion, and activating it adds it to the entered roots and runs discovery

#### Scenario: Projects found are tracked
- **WHEN** the user adds `/w/acme`, discovery finds `/w/acme/alpha-infra` and `/w/acme/demo-ops` with OpenSpec and `/w/acme/chat-groups` without, the user unchecks `demo-ops` and continues
- **THEN** the saved configuration has `/w/acme` as a root, `alpha-infra` is tracked and enabled, `demo-ops` is not in the configuration, and the step had said that one repository without OpenSpec can be integrated from the overview

#### Scenario: Nothing is saved before Continue
- **WHEN** the user marks `~/Workspace` to be created, adds a root, discovery lists projects, the user lists `acme/beta-soc` under GitHub repositories, and then activates **Skip setup**
- **THEN** the saved configuration's roots and repositories are unchanged, `~/Workspace` does not exist and nothing was cloned

#### Scenario: A missing folder
- **WHEN** the user enters `~/does-not-exist` and does not activate **Create folder**
- **THEN** the root is marked as not found, **Create folder** is offered, and the root is not saved on **Continue**

#### Scenario: Existing roots are kept
- **WHEN** setup is run again with two configured roots and the user adds a third and continues
- **THEN** the saved configuration has all three roots

#### Scenario: Creating a workspace folder
- **WHEN** no root is configured, `~/Workspace` does not exist, and the user accepts the proposal to create it and continues
- **THEN** `~/Workspace` exists as an empty folder and is saved as a workspace root

#### Scenario: A root is required
- **WHEN** no root is configured and the user has entered none
- **THEN** **Continue** is inactive and says that a workspace folder is needed, and **Skip setup** is still available

#### Scenario: GitHub repositories into a new workspace
- **WHEN** no root is configured, the user marks `~/Workspace` to be created, lists `acme/beta-soc`, which uses OpenSpec, and `acme/chat-groups`, which does not, and continues
- **THEN** `~/Workspace` is created and saved as a root, both clones are started into it and the wizard moves to the Agents step at once; once they have finished, `beta-soc` is tracked and enabled and `chat-groups` is reported as cloned without OpenSpec

#### Scenario: Continue does not wait
- **WHEN** the user lists a repository whose clone takes five minutes and continues
- **THEN** the wizard shows the Agents step as soon as the clone has been accepted, and the clone goes on

#### Scenario: A clone fails
- **WHEN** the user lists `acme/beta-soc` and `acme/missing-repo`, continues, and the clone of `acme/missing-repo` later fails
- **THEN** the wizard had already moved to the Agents step, and the Done step lists `acme/missing-repo` with its reason and a retry, while `acme/beta-soc` was cloned once

#### Scenario: A clone is refused
- **WHEN** the user lists `acme/beta-soc` and `acme/chat-groups`, continues, and `/w/acme/chat-groups` already exists
- **THEN** the step stays open, `acme/beta-soc` is being cloned, and `acme/chat-groups` shows the reason with its folder name editable; after renaming it to `chat-groups-gh` and continuing, its clone starts, `acme/beta-soc` is not started a second time, and the wizard moves on

### Requirement: The Done step summarises and ends setup
The Done step SHALL summarise what setup saved: the roots added and which of them it created, the number of projects
tracked, the GitHub repositories whose clones setup started, whether agent
sessions are on, the agents added, the default agent, the console agent and the number of projects whose settings were
changed. It SHALL also say what is left, naming the checks of a setup-view report requested when the Done step is shown that are
still `problem` or `warning`, and each checked agent whose executable the Agents step last found missing. It SHALL present this
visually: a headline that setup is complete, with a large check mark — or, when checks still need attention, that setup
is complete with something left to fix — followed by one card per step from System check to Project settings, in the wizard's
order, each with that step's icon from the Welcome diagram, its name, its outcome in a word or a number and a line of
detail, and a mark in text and colour of whether it is **done**, **needs attention** or had **nothing changed**. A card
SHALL need attention only for the System check, when a check is `problem` or `warning`, and for Agents, when a checked
agent is not found. Below the cards it SHALL say
what comes next: the projects overview, and the tour on a first start. The cards SHALL be exposed to assistive
technology as a list, each read as its name, mark and outcome, and the headline's animation, if any, SHALL not play when
the user prefers reduced motion. Below the cards it SHALL list every clone setup started, each as the `github-repositories` capability shows a
clone — queued, cloning with its progress, tracked, cloned without OpenSpec, failed with its reason or cancelled — with
Cancel for a queued or running one and Retry for a failed or cancelled one, updating while the step is open; the
Workspace card SHALL count the clones started and say how many are still running. Clones still running SHALL NOT keep
the user from finishing: **Finish** SHALL say that they go on and can be followed under Unmanaged projects. It SHALL offer **Finish**. Finishing, and **Skip setup** at any step, SHALL mark setup as done on the server and close the wizard,
keeping everything earlier steps saved. If marking setup as done fails, the wizard SHALL close anyway and open by itself
again on the next page load. After the wizard closed on a first start, the onboarding tour SHALL start under its own
rules.

#### Scenario: Finish
- **WHEN** the user activates **Finish**
- **THEN** the wizard closes, the configuration no longer has `setup: "pending"`, and on reload the wizard does not open

#### Scenario: A visual ending
- **WHEN** the user added `/w/acme`, tracked two projects, added Codex, kept the console on the default agent, changed no project setting, and every check is `ok`
- **THEN** the Done step's headline says setup is complete beside a large check mark, and it shows five cards — System check "All in place" done, Workspace "2 projects" done, Agents "2 agents" done, Console "Claude Code" done, Project settings nothing changed — each with its step's icon

#### Scenario: Something left to fix
- **WHEN** the GitHub CLI check is `warning` on the Done step
- **THEN** the headline says something is left to fix, and the System check card is marked as needing attention and names the GitHub CLI

#### Scenario: Summary of agents and projects
- **WHEN** the user added Codex and Antigravity, kept the console on the default agent and changed the auto fetch of three projects
- **THEN** the Done step lists Codex and Antigravity as added, names the default agent as the console agent, and says that the settings of three projects were saved

#### Scenario: Skip keeps what was saved
- **WHEN** the user continues from the Workspace step, which tracked two projects, and activates **Skip setup** on the Agents step
- **THEN** the wizard closes, setup is marked done, and the two projects are still tracked

#### Scenario: The tour follows
- **WHEN** a first-time user finishes the wizard in a browser that has not seen the tour
- **THEN** the onboarding tour starts at its first step

#### Scenario: An agent still missing
- **WHEN** the user checked Antigravity, `agy` is still not found, and every check of the setup view is `ok`
- **THEN** the Agents card is marked as needing attention and names Antigravity, and the System check card is done

#### Scenario: Clones on the Done step
- **WHEN** setup started the clones of `acme/beta-soc`, which is at 40%, and `acme/chat-groups`, which failed
- **THEN** the Done step lists `acme/beta-soc` with its progress bar and Cancel, and `acme/chat-groups` with its reason and Retry, and the Workspace card says one clone is still running

#### Scenario: Finishing while cloning
- **WHEN** a clone is still running and the user activates **Finish**
- **THEN** the wizard closes, the clone goes on, and the projects overview lists it under Unmanaged projects with its progress
