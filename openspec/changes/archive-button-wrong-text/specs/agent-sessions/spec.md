## MODIFIED Requirements

### Requirement: Text sent on the user's behalf is submitted only after the agent showed it
Whenever the dashboard sends text to an agent's terminal on the user's behalf and is meant to submit it — a default response, the Ship prompt, or an opening prompt that is typed after start-up — it SHALL first write the text without Enter, then wait until the terminal's output produced after that write shows the text, and only then press Enter, as a separate key press after a short pause. The text SHALL be written in consecutive pieces of a bounded size, each small enough to reach the agent as one whole read through any terminal's input queue (at most 1024 bytes on any supported platform), never splitting a character across two pieces, in order, with a short pause after each piece; the wait for the text to show SHALL begin once the last piece is written. A text longer than a terminal's input queue MUST NOT be written in one burst, so that the agent never receives it cut at a point the terminal chose. If the text does not appear within a bounded time, the dashboard MUST NOT press Enter or send any other key; the text SHALL be left as typed. Whether the text appeared SHALL be decided independently of how the agent draws it: escape sequences and whitespace, including line wrapping, MUST be disregarded, and for long text a leading portion SHALL be sufficient. Submissions to one session SHALL be processed one after another. When a text was typed but not submitted, the dashboard SHALL tell the user so, stating that nothing was confirmed; it MUST NOT fail silently. The mechanism MUST NOT depend on any particular agent.

#### Scenario: Text prompt
- **WHEN** the agent waits at a text prompt that shows typed characters, and the dashboard submits `Yes, go ahead`
- **THEN** the text is typed, the terminal shows it, Enter is pressed as a separate key press, and the agent receives the answer

#### Scenario: Selection menu
- **WHEN** the agent shows a selection menu with an option highlighted, and the dashboard submits any text
- **THEN** the typed text does not appear, no Enter is pressed, the highlighted option is not confirmed, the session keeps running, and the user is told that the text was typed but not sent

#### Scenario: Long prompt
- **WHEN** the dashboard submits a prompt of several hundred characters that the agent wraps over several lines of its input box
- **THEN** the prompt is recognised as shown, Enter is pressed separately, and the agent starts working on it instead of leaving it in the input box

#### Scenario: Prompt longer than the terminal's input queue
- **WHEN** the user presses **Archive** for a change whose agent is running, and the composed Archive prompt — with the docs auto-merge and record instructions — is longer than 1024 bytes
- **THEN** the agent receives the whole prompt in order, in pieces none of which is larger than the bound, its input box shows the prompt's text rather than a paste placeholder followed by a fragment, and the prompt is submitted with a separate Enter

#### Scenario: Multi-byte characters at a piece boundary
- **WHEN** the dashboard submits a text containing multi-byte characters such as `—` where a piece boundary would fall inside one
- **THEN** every character reaches the agent intact and the text the agent receives equals the text submitted

#### Scenario: Agent that redraws with escape sequences
- **WHEN** the agent renders the typed text interleaved with cursor movement and colour sequences
- **THEN** the text is still recognised as shown

#### Scenario: Two submissions at once
- **WHEN** two texts are submitted to the same session within the same moment
- **THEN** the second is typed only after the first has been submitted or given up, and their characters never interleave

#### Scenario: A line-based agent
- **WHEN** the agent is a line-based program whose terminal echoes input
- **THEN** the echoed text counts as shown and the line is submitted
