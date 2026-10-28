## MODIFIED Requirements

### Requirement: Repository content is treated as untrusted
Artifact content comes from tracked repositories and MUST be treated as untrusted input. The renderer MUST NOT interpret raw HTML in the Markdown source: HTML tags SHALL either be shown as text or be dropped, and MUST NOT become elements, attributes, scripts, styles or event handlers in the page. The renderer MUST NOT load any remote resource — images, scripts, stylesheets, fonts or frames — from artifact content, whatever the source says.

A link in artifact content SHALL be rendered as a link to another page only when its target uses `http:`, `https:` or `mailto:`; such links SHALL open in a new tab and SHALL NOT send a referrer or expose the opener. A relative target SHALL be resolved against the directory of the file shown, within the change's directory: when it names, without a fragment or query mattering, a file the detail view lists for this change, it SHALL be rendered as a link to that file in this same detail view — the URL's selected file — opened in place, without a new tab or window; any other relative target — one leaving the change's directory, naming a file the view does not list, or only a fragment — SHALL be rendered as plain text. A relative target SHALL NOT become a link anywhere else Markdown is rendered (What's new). Any other target (including `javascript:` and `data:`) SHALL be rendered as plain text. No rendered link SHALL point at a dashboard URL the source chose.

#### Scenario: Script tag in an artifact
- **WHEN** a proposal contains `<script>alert(1)</script>` or `<img src=x onerror=alert(1)>`
- **THEN** no script runs, no request is made, and no element with an event handler is created

#### Scenario: Markdown image
- **WHEN** an artifact contains `![diagram](https://example.com/a.png)`
- **THEN** no request to `example.com` is made and the image is not embedded

#### Scenario: Dangerous link target
- **WHEN** an artifact contains `[click](javascript:alert(1))`
- **THEN** the text is shown without a link

#### Scenario: External link
- **WHEN** an artifact contains `[docs](https://example.com/docs)`
- **THEN** the link opens in a new tab without sending a referrer and without giving the opened page access to the dashboard window

#### Scenario: Link to another artifact of the change
- **WHEN** `proposal.md` of `rotate-keys` contains `[the design](./design.md)` and the change has a `design.md`
- **THEN** the text links to the detail view of `rotate-keys` with `design.md` selected, and activating it shows that file in the same view, without opening a tab or window

#### Scenario: Link to a delta spec
- **WHEN** `proposal.md` contains `[spec](specs/auth/spec.md)` and the view lists `specs/auth/spec.md` for the change
- **THEN** activating it selects that file in the same view

#### Scenario: Relative link outside the change
- **WHEN** an artifact contains `[main spec](../../specs/auth/spec.md)` or `[notes](./missing.md)` for a file the view does not list
- **THEN** the text is shown without a link
