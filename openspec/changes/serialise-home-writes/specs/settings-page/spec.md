## ADDED Requirements

### Requirement: Saving Settings keeps changes made elsewhere

Saving Settings MUST NOT undo a configuration change that was saved elsewhere after the Settings draft was seeded — a repository tracked, enabled, disabled or forgotten, an ignore path added from the overview, a label colour, the fast-forward warning, a project setting or a save from another tab. Settings SHALL send the revision of the configuration its draft was seeded from. When the server answers that the configuration has changed since, Settings SHALL apply the user's edits — each top-level setting where the draft differs from the copy it was seeded from — onto the current configuration, with the repositories as the current configuration has them. When none of the settings the user edited was changed elsewhere, Settings SHALL save the result without asking. Otherwise it SHALL show the result, with the user's edits over the newer values, say that settings were changed elsewhere while Settings was open, keep the save bar's "unsaved changes", and save only when the user saves again. The setup wizard SHALL likewise recompute a save that was refused this way from the current configuration and try once more.

#### Scenario: An ignore path added from the overview survives
- **WHEN** the user edits the poll interval in Settings without saving, in another tab ignores `/w/acme/mirror` on the overview, and then saves Settings
- **THEN** the saved configuration has the new poll interval and `/w/acme/mirror` among its ignore paths, without a second save

#### Scenario: The same setting changed in two tabs
- **WHEN** the user edits the poll interval to 120 seconds in one Settings tab, another tab saves it as 90 seconds, and the first tab saves
- **THEN** nothing is saved yet, the first tab shows 120 seconds with a notice that settings were changed elsewhere, and saving again saves 120 seconds
