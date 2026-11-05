// The one warning before Fast-forward: the agent drafts, implements and opens a pull request without stopping, so the
// pull request is the change's only review. Shown by the session provider for every place a Fast-forward starts from,
// unless the user switched it off (`agentSessions.confirmFastForward`, agent-sessions spec).
import { useEffect, useRef, useState } from "preact/hooks";

export interface FastForwardChoice {
  /** "Don't show this warning again" was ticked when the user confirmed. */
  neverAgain: boolean;
}

export function FastForwardDialog({ change, agentName, onConfirm, onCancel }: { change: string; agentName?: string; onConfirm: (choice: FastForwardChoice) => void; onCancel: () => void }) {
  const [neverAgain, setNeverAgain] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Cancel takes focus: Enter on an unread warning must not be what starts the agent.
  useEffect(() => cancelRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the backdrop is a pointer shortcut; Escape and Cancel are its keyboard equivalents
    <div
      class="overlay end-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div class="dialog end-dialog ff-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ff-title" aria-describedby="ff-body">
        <strong id="ff-title">
          Fast-forward <span class="mono">{change}</span>?
        </strong>
        <div id="ff-body" class="dialog-body">
          <div class="notice warn">
            <strong>Are you sure? </strong>
            {agentName ?? "The agent"} will write this change's artifacts, implement it and open a pull request — without stopping for your review in between.
          </div>
          <div class="hint">The pull request will be the only review. It is never merged for you. Completion instructions are included. Automatic shipping waits until every task is marked complete; unresolved tasks need a separate Ship review.</div>
          <label class="check">
            <input type="checkbox" checked={neverAgain} onChange={(e) => setNeverAgain(e.currentTarget.checked)} /> Don't show this warning again
          </label>
        </div>
        <div class="row">
          <button type="button" class="btn sm ghost" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" class="btn sm primary" onClick={() => onConfirm({ neverAgain })}>
            Fast-forward
          </button>
        </div>
      </div>
    </div>
  );
}
