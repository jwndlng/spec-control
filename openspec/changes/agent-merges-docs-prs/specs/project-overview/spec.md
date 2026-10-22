## MODIFIED Requirements

### Requirement: Each managed project carries its own settings on the overview
Each managed project on the projects overview, as a table row and as a tile, SHALL offer the settings that belong to that one project, each taking effect when changed: the configuration is persisted without a separate save and without a confirmation, and the overview reflects it at once, without waiting for a scan. Except for Rename, the settings SHALL be offered in the project's **settings dialog**, described below, and not on the row or the tile. The settings are:

- **Agent sessions**: a toggle whose state reads **Enabled** or **Disabled**, exposed to assistive technology as a switch with the project's name in its accessible name. A project without a saved agent-session setting SHALL show **Enabled**. While agent sessions are switched off globally, the toggle SHALL still show the project's own setting but SHALL be inactive, and SHALL say that agent sessions are off with a link to the Agent sessions section of Settings.
- **Agent**: a picker offering "default agent" and every configured agent profile by name, showing the project's current choice. It SHALL be shown only when more than one agent profile is configured and the project's agent sessions are enabled. Choosing "default agent" SHALL clear the project's own choice.
- **PR titles**: a picker offering **No convention** and **Conventional Commits**, showing the project's current choice, with an accessible name that includes the project's name and a tooltip saying that Ship asks the agent to title its pull requests this way. It SHALL be shown only for a project that is a git repository. Choosing **No convention** SHALL clear the project's convention. The setting is used by Ship, as the `agent-sessions` capability specifies; while agent sessions are switched off globally or for the project, the picker SHALL still show and change the project's own setting.
- **Auto-merge docs-only pull requests**: a toggle whose state reads **On** or **Off**, exposed to assistive technology as a switch with the project's name in its accessible name, and explained in a tooltip: when on, Ship and Archive ask the agent to open its pull request and not to merge it, and once a pull request whose changes GitHub reports as all under `openspec/` is open, mergeable and its checks pass, the dashboard asks that session's agent to merge it, and on no other; once such a pull request has merged the dashboard ends that session and removes its worktree when that is safe. The tooltip SHALL NOT say that GitHub's auto-merge is enabled, and SHALL say that a pull request without any checks is not merged this way. A project without a saved setting SHALL show **Off**. It SHALL be shown only while the project's agent sessions are enabled and the project is a git repository; while agent sessions are switched off globally it SHALL be shown inactive, like the agent-session toggle.
- **Auto fetch**: a drop-down offering **Off**, **Every 15 seconds**, **Every 30 seconds**, **Every minute**, **Every 5 minutes**, **Every 10 minutes**, **Every 15 minutes**, **Every 30 minutes** and **Every hour**, showing the project's current choice, with an accessible name that includes the project's name and a tooltip saying that the dashboard then fetches the project's remote on that interval so merged branches and conflicts stay current, that it only fetches and never updates the checkout — that stays the Pull action — that it uses git's own credentials without prompting, and that it is on, every minute, unless switched off. A project without a saved setting SHALL show **Every minute**, the default; choosing **Off** SHALL save that the project is not fetched automatically, and choosing **Every minute** SHALL clear the project's setting. It SHALL be shown only for a project that is a git repository, and SHALL be shown whether agent sessions are on or off: it describes the project, not its sessions. What the setting does is specified in the `repository-pull` capability.
- **Rename**: an action beside the project's name, on the row and the tile, that turns the project's name into a text field in place, prefilled with the current name. Pressing Enter or moving focus out of the field SHALL save the trimmed name; pressing Escape SHALL leave the name unchanged. A name that is empty after trimming MUST NOT be saved, and the field SHALL say why. An unchanged name SHALL be saved without a request. The new name SHALL be shown on the overview, on the repository's board and in the board's repository groups at once.
- **Labels**: an action that replaces the settings dialog with the project's labels dialog, as the `project-labels` capability specifies.

While a setting is being saved its control SHALL show that it is working and SHALL not be activatable again; when saving fails the reason SHALL be shown on that project, and in its settings dialog while that is open, and the setting SHALL show its previous value. Activating any of these controls, or typing in the rename field, MUST NOT open the repository's board. A pending `Scanning…` entry SHALL offer none of these settings and no settings button.

Each managed row and tile SHALL show a **settings button**: an icon button whose accessible name and tooltip say that it opens the project's settings and include the project's name. On a row it SHALL sit in the row's actions, after **Console** and **Pull**, at the right edge of the row, so that the settings buttons of all rows line up in one column whichever of the other actions each row shows; on a tile, at the end of the footer, at its right edge (see "Tiles have one size and one layout"). The table SHALL have no column for agent sessions or any other setting, and a row SHALL show none of the settings above except Rename, and neither Labels nor Disable.

Activating the settings button SHALL open the project's settings dialog over the dimmed page, titled with the word Settings and the project's name, with an accessible name that includes the project's name. Rows and tiles SHALL open the same dialog. It SHALL hold one labelled line per setting, in this order: **Agent sessions**, **Agent**, **PR titles**, **Docs auto-merge** and **Auto fetch**. Then **Labels**, and then **Disable**, which SHALL be set apart after the settings as the "Repositories are enabled, disabled and ignored from the overview" requirement describes. Each control SHALL keep the behaviour, wording, accessible name, switch role, tooltip and visibility rules described above. A setting that does not apply to the project SHALL leave no line. The Docs auto-merge switch's visible text MAY read just **On** or **Off**, because its line names the setting. A change in the dialog SHALL be reflected in the dialog at once, without closing it. At most one dialog SHALL be open at a time.

The dialog SHALL close when the user presses Escape, activates its close control or clicks the backdrop, and when the project leaves Managed projects. When it closes, keyboard focus SHALL return to the settings button that opened it, if that button is still on the page. Opening, using or closing the dialog MUST NOT open the repository's board or change the route.

#### Scenario: Switching a project off for agent sessions
- **WHEN** agent sessions are on and the user switches the Agent sessions toggle in the settings dialog of `alpha-infra` to Disabled
- **THEN** the configuration has agent sessions switched off for `alpha-infra` without any Save, the toggle reads Disabled, the cards of `alpha-infra` show no session starter, and the board is not opened

#### Scenario: Projects are enabled by default
- **WHEN** agent sessions are on and a project was enabled on the overview a moment ago
- **THEN** its toggle reads Enabled and its cards offer session starters

#### Scenario: Sessions are off globally
- **WHEN** agent sessions are switched off in Settings
- **THEN** in every project's settings dialog the toggle shows the project's own setting, is inactive, says that agent sessions are off and links to the Agent sessions section of Settings

#### Scenario: Allowing docs-only pull requests to merge
- **WHEN** agent sessions are on and the user switches **Docs auto-merge** in the settings dialog of `demo-ops`, opened from its tile, to On
- **THEN** the configuration has `autoMergeDocs: true` for `demo-ops` without any Save, the toggle reads On, its other agent settings are unchanged, and the board is not opened

#### Scenario: The tooltip names Ship and Archive
- **WHEN** the user hovers over the **Docs auto-merge** switch in the settings dialog of `demo-ops`
- **THEN** the tooltip says that Ship and Archive leave the pull request open and that the dashboard asks the agent to merge a pull request whose changes are all under `openspec/` once its checks pass and it is mergeable, that one without checks is not merged this way, and that once it has merged the session is ended and its worktree removed when that is safe; it does not mention enabling GitHub's auto-merge

#### Scenario: Auto-merge is off by default
- **WHEN** agent sessions are on and a project has no saved auto-merge setting
- **THEN** its auto-merge toggle reads Off

#### Scenario: No auto-merge toggle without agent sessions or git
- **WHEN** a project's agent sessions are switched to Disabled, or the project is a folder without git
- **THEN** its settings dialog shows no Docs auto-merge line

#### Scenario: Choosing an agent
- **WHEN** two agent profiles are configured and the user picks `my-agent` in the settings dialog of `demo-ops`
- **THEN** the configuration has `my-agent` for `demo-ops` without any Save, and Implement on a `demo-ops` card starts `my-agent`

#### Scenario: One agent configured
- **WHEN** only one agent profile is configured
- **THEN** no project's settings dialog shows an Agent line

#### Scenario: Choosing Conventional Commits for pull request titles
- **WHEN** the user picks **Conventional Commits** under PR titles in the settings dialog of `demo-ops`
- **THEN** the configuration has `prTitleConvention: conventional-commits` for `demo-ops` without any Save, the picker shows Conventional Commits, no scan is started, and the board is not opened

#### Scenario: Clearing the convention
- **WHEN** the user picks **No convention** for a project that has Conventional Commits
- **THEN** the project's entry no longer carries `prTitleConvention`

#### Scenario: A folder without git
- **WHEN** a managed project is a folder that is not a git repository
- **THEN** its settings dialog shows no PR titles line

#### Scenario: Renaming a project
- **WHEN** the user activates Rename on the row of `beta-soc`, types `Beta SOC` and presses Enter
- **THEN** the configuration has the name `Beta SOC` without any Save, the row and the repository's board show `Beta SOC`, and no scan was needed for it

#### Scenario: Cancelling a rename
- **WHEN** the user activates Rename, types `x` and presses Escape
- **THEN** the name is unchanged and no request is made

#### Scenario: An empty name
- **WHEN** the user clears the rename field and presses Enter
- **THEN** nothing is saved, the field stays open and says that a name is required

#### Scenario: The update is refused
- **WHEN** the user switches a project's agent sessions to Disabled and the server refuses the request
- **THEN** the settings dialog and the project show the reason, and the toggle reads Enabled again

#### Scenario: Settings on a tile
- **WHEN** agent sessions are on, two agent profiles are configured, and the user activates the settings button on the tile of `demo-ops`, a git repository
- **THEN** the settings dialog of `demo-ops` lists Agent sessions, Agent, PR titles, Docs auto-merge, Auto fetch and Labels as labelled lines, followed by Disable set apart, and the board is not opened

#### Scenario: The same dialog from a row
- **WHEN** the user activates the settings button on the row of `demo-ops`
- **THEN** the same settings dialog of `demo-ops` opens, with the same lines as from its tile, and the route is unchanged

#### Scenario: A row without inline settings
- **WHEN** agent sessions are on and the overview shows the table
- **THEN** the table has no Agent sessions column, and the row of `alpha-infra` shows its name with Rename, its figures, and Console, Pull and the settings button as its actions, with no switch, picker, Labels or Disable

#### Scenario: The settings button names the project
- **WHEN** a screen reader user reaches the settings button on the row of `alpha-infra`
- **THEN** its accessible name includes `alpha-infra`, and the dialog it opens has an accessible name that includes `alpha-infra`

#### Scenario: Escape returns focus
- **WHEN** the user opens the settings dialog of `alpha-infra` from its row with the keyboard, switches Docs auto-merge, and presses Escape
- **THEN** the dialog closes, the change stays saved, focus is on the settings button of `alpha-infra`, and the board is not opened

#### Scenario: Off globally inside the dialog
- **WHEN** agent sessions are switched off in Settings and the user opens the settings dialog of `alpha-infra`
- **THEN** the Agent sessions line shows the project's own setting as an inactive link to the Agent sessions section of Settings, and following it leaves the overview for Settings

#### Scenario: Nothing to set while scanning
- **WHEN** `beta-soc` was enabled a moment ago and is shown as `Scanning…`
- **THEN** its row and tile show no settings button

#### Scenario: Switching auto fetch on
- **WHEN** the user picks **Every 15 seconds** under Auto fetch in the settings dialog of `demo-ops`, which has it Off
- **THEN** the configuration has `autoFetchSeconds: 15` for `demo-ops` without any Save, the drop-down shows Every 15 seconds, its other settings are unchanged, no scan is started by the setting itself, and the board is not opened

#### Scenario: Switching auto fetch off
- **WHEN** the user picks **Off** under Auto fetch for a project that fetches every minute
- **THEN** the project's entry carries `autoFetchSeconds: 0`, the drop-down shows Off, and the project is no longer fetched automatically

#### Scenario: Back to the default
- **WHEN** the user picks **Every minute** under Auto fetch for a project that has it Off
- **THEN** the project's entry no longer carries `autoFetchSeconds`

#### Scenario: Auto fetch is on by default
- **WHEN** a project has no saved auto-fetch setting
- **THEN** its Auto fetch drop-down shows Every minute

#### Scenario: Auto fetch is off by default
- **WHEN** the user switched the Auto fetch of `demo-ops` Off and the dashboard is restarted
- **THEN** its drop-down still shows Off, because Off is a saved choice and not the absence of one, and `demo-ops` is not fetched automatically

#### Scenario: Auto fetch with agent sessions off
- **WHEN** agent sessions are switched off in Settings
- **THEN** every git project's settings dialog still shows its Auto fetch line, and it can be changed

#### Scenario: No auto fetch without git
- **WHEN** a managed project is a folder that is not a git repository
- **THEN** its settings dialog shows no Auto fetch line

#### Scenario: The settings buttons line up at the right edge of the table
- **WHEN** the projects table lists `alpha-infra`, whose row shows Console, Pull and the settings button, and `demo-ops`, whose last scan failed so that its row shows Console and the settings button but no Pull
- **THEN** both settings buttons sit at the right edge of their rows, one above the other, and the actions before them in each row end just before them
