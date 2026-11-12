import { useEffect, useRef } from "preact/hooks";
import type { ShipResult } from "../shared/types.ts";

export function ShipResultDialog({ result, close, review }: { result: ShipResult; close(): void; review(): void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); close(); }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [close]);
  const summary = result.taskSummary;
  const hasPr = result.shipped && result.pullRequestUrl;
  return (
    <div class="overlay end-overlay">
      <div class="dialog end-dialog" role="dialog" aria-modal="true" aria-labelledby="ship-result-title">
        <strong id="ship-result-title">{hasPr ? "Pull request ready for review" : "Ship needs follow-up"}</strong>
        <div class="dialog-body">
          {hasPr && <p><a href={result.pullRequestUrl} target="_blank" rel="noopener noreferrer">{result.pullRequestState === "existing" ? "View existing pull request" : "View created pull request"}</a></p>}
          {result.shipWarning && <p class="notice warn">{result.shipWarning}</p>}
          {!hasPr && !result.shipWarning && <p class="notice warn">No valid pull request URL was returned. Review the branch before continuing.</p>}
          {summary && <>
            <p>{summary.done}/{summary.total} tasks marked complete in the session checkout.</p>
            {!summary.verified && <p class="notice warn">Task state is unknown. {summary.reason}</p>}
            {summary.open.length > 0 && <><strong>Open tasks</strong><ul>{summary.open.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
            {summary.awaiting.length > 0 && <><strong>Needs your review</strong><ul>{summary.awaiting.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
            {summary.truncated && <p class="notice warn">This list is shortened. Review the full tasks file with the agent.</p>}
          </>}
          <p>Ship does not verify checks, complete tasks or merge the pull request. Open the console to review feedback with the agent or use Resolve conflicts when available.</p>
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" ref={button} onClick={close}>Close</button>
          <button type="button" class="btn sm primary" onClick={review}>Review feedback or conflicts in console</button>
        </div>
      </div>
    </div>
  );
}
