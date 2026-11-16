import { useEffect, useRef } from "preact/hooks";
import type { ShipPreflight } from "../shared/types.ts";

export type ShipChoice = "finish" | "confirm" | "ship" | "cancel";
export function ShipPreflightDialog({ preview, answer }: { preview: ShipPreflight; answer: (choice: ShipChoice) => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      answer("cancel");
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [answer]);
  const { summary } = preview;
  return (
    <div class="overlay end-overlay">
      <div class="dialog end-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ship-title" aria-describedby="ship-body">
        <strong id="ship-title">Unfinished tasks before Ship</strong>
        <div id="ship-body" class="dialog-body">
          <p>
            {summary.done}/{summary.total} tasks marked complete in the session checkout.
          </p>
          {summary.reason && <p class="notice warn">{summary.reason}</p>}
          {summary.open.length > 0 && (
            <>
              <strong>Open tasks</strong>
              <ul>
                {summary.open.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {summary.awaiting.length > 0 && (
            <>
              <strong>Needs your review</strong>
              <ul>
                {summary.awaiting.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </>
          )}
          {summary.truncated && <p class="notice warn">This list is shortened. Review the full tasks file with the agent.</p>}
          <p>
            Finish tasks asks the agent to complete the remaining work without shipping. Ship anyway opens a PR with unresolved checks, including checks that
            need its CI. Tasks stay unresolved until verified; docs auto-merge is withheld.
          </p>
          {summary.verified && !summary.truncated && summary.done < summary.total && <p>Mark all complete and Ship records every remaining task as complete and proceeds to shipping. Choose it only when you have completed and verified all listed work.</p>}
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" ref={cancel} onClick={() => answer("cancel")}>
            Cancel
          </button>
          <button type="button" class="btn sm primary" onClick={() => answer("finish")}>
            Finish tasks
          </button>
          {summary.verified && !summary.truncated && summary.done < summary.total && <button type="button" class="btn sm" onClick={() => answer("confirm")}>
            Mark all complete and Ship
          </button>}
          <button type="button" class="btn sm" onClick={() => answer("ship")}>
            Ship anyway
          </button>
        </div>
      </div>
    </div>
  );
}
