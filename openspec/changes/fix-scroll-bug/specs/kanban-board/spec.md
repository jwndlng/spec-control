# Spec Delta

## MODIFIED Requirements

### Requirement: The board fits half a screen
The board SHALL offer two layouts of the same columns and cards: **Lanes**, the columns side by side, and **Stack**, each column a full-width section whose repository groups (or, on a repository board, cards) flow in a grid, with the page scrolling vertically so the hero scrolls away. By default the layout SHALL follow the window: **Stack** below 1280px wide, **Lanes** otherwise, switching live as the window is resized. A **Lanes**/**Stack** switch in the filter bar SHALL mark the layout on screen and SHALL make an explicit choice that overrides the default and persists in the URL (`layout=lanes` or `layout=stack`); an unknown value SHALL mean the default. The layout SHALL NOT be a filter: it changes no card or count, and **Clear filters** keeps it. In **Lanes**, a column without cards SHALL shrink to a slim rail that still shows its name and count, and lanes SHALL be narrower on windows narrower than 1600px. Populated Lanes columns SHALL fill the available board height, and their card lists SHALL scroll within the columns when their contents exceed that height. Grouping, minimizing, counts, the archived bound and every card's content SHALL be the same in both layouts.

#### Scenario: Half a screen
- **WHEN** the combined board is opened in a window 960px wide
- **THEN** the columns are stacked sections, the cards of each column's repository groups sit side by side in a grid, nothing scrolls horizontally, and the switch marks **Stack**

#### Scenario: Explicit choice
- **WHEN** the user activates **Lanes** in a 960px window
- **THEN** the columns are shown side by side, the URL holds `layout=lanes`, and a reload keeps lanes

#### Scenario: Empty lane
- **WHEN** the `Drafts` column has no cards in the lanes layout
- **THEN** it is a slim rail showing `Drafts` and `0`, and the other lanes get the width

#### Scenario: Populated lanes keep to the board height
- **WHEN** the board is in Lanes layout and one or more columns contain enough cards to exceed the available board height
- **THEN** each populated column fills the available board height, its card list scrolls internally, and there is no unused gap below the lanes

#### Scenario: Clearing filters keeps the layout
- **WHEN** the board holds `layout=stack` and a text search and the user activates **Clear filters**
- **THEN** the search is cleared and the board stays stacked
