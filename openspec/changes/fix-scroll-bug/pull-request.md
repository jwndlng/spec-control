# Pull request summary

## Problem

On boards with many changes, the Lanes layout can leave unused space below the columns and make overflow behavior unclear.

## Intended outcome

Lanes fill the available board height, with overflowing cards scrolling inside their columns. Stack keeps its existing page-level vertical scrolling.

## Planned verification

- Add and run regression coverage for populated Lanes overflow and internal card scrolling.
- Check both Lanes and Stack at a constrained viewport to confirm the gap is gone and page scrolling still works in Stack.
- Validate the What's new entry and run the relevant UI tests.
