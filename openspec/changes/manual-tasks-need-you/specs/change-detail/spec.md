## MODIFIED Requirements

### Requirement: Tasks are shown as a read-only checklist
When the tasks artifact is selected, its task list SHALL be rendered as checkboxes reflecting each task's state, together with the same progress the card shows. A task SHALL be drawn in one of three states: **done**, ticked; **needs you** (`- [~]`), a third state that is neither ticked nor empty and is announced as mixed rather than as done or not done; and **open**, empty. Where any task needs the user, the view SHALL say in words how many do — `N tasks need you` (`1 task needs you`) — and that each is something to check or do that only the user can, confirmed with **Validate** or when archiving; and it SHALL list those tasks' text above the checklist, in file order, so what the user has to do is the first thing the view shows. The checkboxes MUST NOT be operable in any state: the dashboard MUST NOT write a change to the repository from this view.

#### Scenario: Checklist
- **WHEN** the tasks artifact has 12 tasks of which 4 are ticked
- **THEN** 12 checkboxes are shown with the first-ticked 4 checked and `4/12` is shown

#### Scenario: Awaiting validation
- **WHEN** the tasks artifact has 15 tasks of which 13 are ticked and 2 are `- [~]`
- **THEN** 15 checkboxes are shown, the 2 awaiting ones are drawn in the third state and announced as mixed, and the view says that 2 tasks need you and lists their text above the checklist

#### Scenario: Not editable
- **WHEN** the user clicks a checkbox in the tasks view, in any of the three states
- **THEN** nothing is sent to the server and the repository is unchanged

