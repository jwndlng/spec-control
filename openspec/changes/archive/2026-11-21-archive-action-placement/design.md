# Design

The timeline currently attaches the generic phase action to `actionPhase`, which is absent once the change's current phase is Archived. In that case the component renders the controls in a centered fallback row. Assign the action to Archived when the change itself is archived. Preserve the existing behavior for a Done snapshot whose observed lifecycle progress already reached Archived; that case must not offer Archive again.

Add a render-level test that confirms the supplied action appears inside the Archived phase for an archived change, while retaining the existing no-repeat test for Done plus Archived progress.
