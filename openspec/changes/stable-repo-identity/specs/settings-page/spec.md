## ADDED Requirements

### Requirement: Settings saves after a tracked folder's spelling changed
Saving Settings SHALL succeed when a tracked repository's folder was renamed by case only or replaced by a symbolic link to the same directory since Settings was opened, as long as the rest of the draft is valid: the repository SHALL keep its id, name, enabled state and every other setting, and after the save Settings SHALL show the path as the server saved it, in its new canonical spelling. Settings MUST NOT show the save as failed or ask the user to restart the dashboard for such a change.

#### Scenario: Renaming a project after its folder was respelled
- **WHEN** Settings shows `/w/acme/Acme`, the folder is renamed to `/w/acme/acme` on a case-insensitive file system, and the user changes that project's name and saves
- **THEN** the save succeeds, the project keeps its id and its sessions, and Settings shows the path `/w/acme/acme` with the new name
